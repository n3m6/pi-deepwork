/**
 * SynthesizeReviewGateWorkflow
 *
 * Encapsulates the shared loop used by design and structure stages:
 * synthesize → review (up to N rounds) → human gate → feedback → repeat.
 */

// eslint-disable-next-line no-restricted-imports -- known tech debt: createAskHumanTool should be behind a GateManager port method
import { createAskHumanTool } from "../../infrastructure/pi/human-gate.js";
import { artifactRelPath, dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "../stage/utils.js";
import type { ArtifactId, GateRoundDetail, StageOutcome, StageRuntime } from "../port/index.js";

export interface SynthesizeReviewGateConfig {
  /** Stage name used in gate labels and filenames (e.g. "design" | "structure") */
  stageName: string;
  /** Agent that produces the artifact */
  synthesizerAgent: string;
  /** Agent that reviews the artifact */
  reviewerAgent: string;
  /** ArtifactId where the synthesized artifact is stored */
  artifactId: ArtifactId;
  /** Short display name used in filesWritten (e.g. "design.md") */
  artifactDisplayName: string;
  /** Build the synthesizer prompt from context + optional feedback history */
  buildSynthesizerPrompt: (ctx: SynthesisContext, feedbackHistory: string[]) => string;
  /** Build the reviewer prompt from context + current artifact text */
  buildReviewerPrompt: (ctx: SynthesisContext, artifactText: string) => string;
  /** Gate label for approval prompt */
  approveLabel: string;
  /** Gate label for feedback option */
  feedbackLabel: string;
  /** Feedback question text */
  feedbackQuestion: string;
  /** Max review rounds before declaring FAIL */
  maxReviewRounds?: number;
}

export interface SynthesisContext {
  runtime: StageRuntime;
  [key: string]: string | StageRuntime;
}

export async function runSynthesizeReviewGate(
  runtime: StageRuntime,
  cfg: SynthesizeReviewGateConfig,
  ctx: SynthesisContext,
): Promise<StageOutcome> {
  const maxReviewRounds = cfg.maxReviewRounds ?? 5;
  let feedbackHistory: string[] = [];
  let gateRounds = 0;
  let gateWaitTimeSeconds = 0;
  const gateRoundDetails: GateRoundDetail[] = [];
  const artifactId = cfg.artifactId;
  const artifactDisplayName = cfg.artifactDisplayName;

  while (true) {
    const designDiscussion =
      cfg.stageName === "design" && runtime.services.gates.interactionMode === "interactive"
        ? (await runtime.services.gates.askText(
            "Design discussion",
            "Share any preferred architecture, patterns, or trade-offs before design synthesis.",
          )) ?? "No additional design discussion."
        : undefined;

    const synthesis = await dispatchLeaf(
      runtime,
      cfg.synthesizerAgent,
      cfg.buildSynthesizerPrompt({ ...ctx, runtime, ...(designDiscussion ? { designDiscussion } : {}) }, feedbackHistory),
      { customTools: [createAskHumanTool(runtime.services.gates)] },
    );
    await writeArtifact(runtime, artifactId, synthesis.text);

    const review = await runReviewLoop(runtime, cfg, ctx, maxReviewRounds);
    if (review.status === "FAIL") {
      return {
        status: "FAIL",
        filesWritten: [artifactDisplayName, ...review.filesWritten],
        summary: `${capitalise(cfg.stageName)} review loop reached the unresolved review cap.`,
        telemetry: {
          review_rounds: review.reviewRounds,
          terminal_review_state: "unclean-cap",
          gate_status: "none",
          gate_rounds: 0,
          gate_wait_time_s: 0,
          gate_round_details: [],
        },
      };
    }

    if (runtime.services.gates.interactionMode === "automated") {
      return {
        status: "PASS",
        filesWritten: [artifactDisplayName, ...review.filesWritten],
        summary: `${capitalise(cfg.stageName)} synthesized and auto-approved.`,
        telemetry: {
          review_rounds: review.reviewRounds,
          terminal_review_state: "clean",
          gate_status: "approved",
          gate_mode: "automated",
          gate_rounds: 0,
          gate_wait_time_s: 0,
          gate_round_details: [],
        },
      };
    }

    const presentedAt = new Date().toISOString();
    const decision = await runtime.services.gates.choose(
      `${capitalise(cfg.stageName)} approval`,
      [
        { value: "approve", label: cfg.approveLabel },
        { value: "feedback", label: cfg.feedbackLabel },
      ],
      `Review the ${cfg.stageName} artifact at ${artifactRelPath(runtime, artifactId)} and choose how to proceed.`,
    );
    const respondedAt = new Date().toISOString();
    gateRounds += 1;
    gateWaitTimeSeconds += secondsBetween(presentedAt, respondedAt);

    if (!decision || decision.value === "approve") {
      gateRoundDetails.push({ round: gateRounds, decision: "approved", presented_at: presentedAt, responded_at: respondedAt });
      return {
        status: "PASS",
        filesWritten: [artifactDisplayName, ...review.filesWritten],
        summary: `${capitalise(cfg.stageName)} synthesized and approved.`,
        telemetry: {
          review_rounds: review.reviewRounds,
          terminal_review_state: "clean",
          gate_status: "approved",
          gate_mode: "interactive",
          gate_rounds: gateRounds - 1,
          gate_wait_time_s: gateWaitTimeSeconds,
          gate_round_details: gateRoundDetails,
        },
      };
    }

    gateRoundDetails.push({ round: gateRounds, decision: "rejected", presented_at: presentedAt, responded_at: respondedAt });
    const feedback = await runtime.services.gates.askText(`${capitalise(cfg.stageName)} feedback`, cfg.feedbackQuestion);
    const latestArtifact = await readArtifact(runtime, artifactId);
    feedbackHistory.push([
      `## Round ${gateRounds} Feedback`,
      "",
      "### User Feedback",
      feedback?.trim() || "No additional feedback supplied.",
      "",
      "### Rejected Artifact",
      latestArtifact.trim(),
    ].join("\n"));

    if (!feedback && runtime.services.gates.failurePolicy === "fail-closed") {
      return {
        status: "FAIL",
        filesWritten: [artifactDisplayName, ...review.filesWritten],
        summary: `${capitalise(cfg.stageName)} approval was rejected without actionable feedback.`,
        telemetry: {
          review_rounds: review.reviewRounds,
          terminal_review_state: "clean",
          gate_status: "rejected",
          gate_mode: "interactive",
          gate_rounds: gateRounds,
          gate_wait_time_s: gateWaitTimeSeconds,
          gate_round_details: gateRoundDetails,
        },
      };
    }
  }
}

async function runReviewLoop(
  runtime: StageRuntime,
  cfg: SynthesizeReviewGateConfig,
  ctx: SynthesisContext,
  maxRounds: number,
): Promise<{ status: "PASS" | "FAIL"; reviewRounds: number; filesWritten: string[] }> {
  const filesWritten: string[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    const artifactText = await readArtifact(runtime, cfg.artifactId);
    const review = await dispatchLeaf(
      runtime,
      cfg.reviewerAgent,
      cfg.buildReviewerPrompt({ ...ctx, runtime }, artifactText),
      { customTools: [createAskHumanTool(runtime.services.gates)] },
    );

    const reviewId: ArtifactId = { kind: "reviewFile", name: `${cfg.stageName}-review-round-${String(round).padStart(2, "0")}.md` };
    await writeArtifact(runtime, reviewId, review.text);
    filesWritten.push(artifactRelPath(runtime, reviewId));

    if (parseReviewStatus(review.text) === "PASS") {
      return { status: "PASS", reviewRounds: round, filesWritten };
    }

    if (round === maxRounds) {
      return { status: "FAIL", reviewRounds: round, filesWritten };
    }

    const rewritten = await dispatchLeaf(
      runtime,
      cfg.synthesizerAgent,
      cfg.buildSynthesizerPrompt({ ...ctx, runtime }, [`Review feedback:\n${review.text}`]),
    );
    await writeArtifact(runtime, cfg.artifactId, rewritten.text);
  }

  return { status: "FAIL", reviewRounds: maxRounds, filesWritten };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function secondsBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
