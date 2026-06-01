import path from "node:path";

import { createAskHumanTool } from "../gates.js";
import { dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";
import type { GateRoundDetail, StageModule, StageOutcome, StageRuntime } from "../types.js";

export const structureStage: StageModule = {
  stage: "structure",
  async run(runtime): Promise<StageOutcome> {
    const goals = await readArtifact(runtime.artifacts.goalsFile);
    const requirements = await readArtifact(runtime.artifacts.requirementsFile);
    const research = await readArtifact(runtime.artifacts.researchSummaryFile);
    const design = await readArtifact(runtime.artifacts.designFile);
    let feedbackHistory: string[] = [];
    let gateRounds = 0;
    let gateWaitTimeSeconds = 0;
    const gateRoundDetails: GateRoundDetail[] = [];

    while (true) {
      const mapping = await dispatchLeaf(
        runtime,
        "qrspi-structure-mapper",
        [
          "=== GOALS ===",
          goals,
          "",
          "=== REQUIREMENTS ===",
          requirements,
          "",
          "=== RESEARCH SUMMARY ===",
          research,
          "",
          "=== DESIGN ===",
          design,
          feedbackHistory.length > 0 ? "\n=== FEEDBACK HISTORY ===" : "",
          feedbackHistory.length > 0 ? feedbackHistory.join("\n\n") : "",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          customTools: [createAskHumanTool(runtime.services.gates)],
        },
      );
      await writeArtifact(runtime.artifacts.structureFile, mapping.text);

      const review = await runStructureReview(runtime, goals, requirements, research, design);
      if (review.status === "FAIL") {
        return {
          status: "FAIL",
          filesWritten: ["structure.md", ...review.filesWritten],
          summary: "Structure review loop reached the unresolved review cap.",
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
          filesWritten: ["structure.md", ...review.filesWritten],
          summary: "Structure synthesized and auto-approved.",
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
        "Structure approval",
        [
          { value: "approve", label: "Approve structure" },
          { value: "feedback", label: "Provide structure feedback" },
        ],
        `Review the structure artifact at ${path.relative(runtime.artifacts.runDir, runtime.artifacts.structureFile)} and choose how to proceed.`,
      );
      const respondedAt = new Date().toISOString();
      gateRounds += 1;
      gateWaitTimeSeconds += secondsBetween(presentedAt, respondedAt);

      if (!decision || decision.value === "approve") {
        gateRoundDetails.push({
          round: gateRounds,
          decision: "approved",
          presented_at: presentedAt,
          responded_at: respondedAt,
        });
        return {
          status: "PASS",
          filesWritten: ["structure.md", ...review.filesWritten],
          summary: "Structure synthesized and approved.",
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

      gateRoundDetails.push({
        round: gateRounds,
        decision: "rejected",
        presented_at: presentedAt,
        responded_at: respondedAt,
      });
      const feedback = await runtime.services.gates.askText(
        "Structure feedback",
        "Describe the required structure revisions.",
      );
      feedbackHistory.push([
        `## Round ${gateRounds} Feedback`,
        "",
        "### User Feedback",
        feedback?.trim() || "No additional feedback supplied.",
        "",
        "### Rejected Artifact",
        mapping.text.trim(),
      ].join("\n"));
      if (!feedback && runtime.services.gates.failurePolicy === "fail-closed") {
        return {
          status: "FAIL",
          filesWritten: ["structure.md", ...review.filesWritten],
          summary: "Structure approval was rejected without actionable feedback.",
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
  },
};

async function runStructureReview(
  runtime: StageRuntime,
  goals: string,
  requirements: string,
  research: string,
  design: string,
) {
  let reviewRound = 1;
  const filesWritten: string[] = [];

  while (reviewRound <= 5) {
    const structure = await readArtifact(runtime.artifacts.structureFile);
    const review = await dispatchLeaf(
      runtime,
      "qrspi-structure-reviewer",
      [
        "=== GOALS ===",
        goals,
        "",
        "=== REQUIREMENTS ===",
        requirements,
        "",
        "=== RESEARCH SUMMARY ===",
        research,
        "",
        "=== DESIGN ===",
        design,
        "",
        "=== STRUCTURE ===",
        structure,
      ].join("\n"),
      {
        customTools: [createAskHumanTool(runtime.services.gates)],
      },
    );

    const reviewFile = path.join(runtime.artifacts.reviewsDir, `structure-review-round-${String(reviewRound).padStart(2, "0")}.md`);
    await writeArtifact(reviewFile, review.text);
    filesWritten.push(path.relative(runtime.artifacts.runDir, reviewFile));

    if (parseReviewStatus(review.text) === "PASS") {
      return { status: "PASS" as const, reviewRounds: reviewRound, filesWritten };
    }

    if (reviewRound === 5) {
      return { status: "FAIL" as const, reviewRounds: reviewRound, filesWritten };
    }

    const rewritten = await dispatchLeaf(
      runtime,
      "qrspi-structure-mapper",
      [
        "=== GOALS ===",
        goals,
        "",
        "=== REQUIREMENTS ===",
        requirements,
        "",
        "=== RESEARCH SUMMARY ===",
        research,
        "",
        "=== DESIGN ===",
        design,
        "",
        "=== REVIEW FEEDBACK ===",
        review.text,
      ].join("\n"),
    );
    await writeArtifact(runtime.artifacts.structureFile, rewritten.text);
    reviewRound += 1;
  }

  return { status: "FAIL" as const, reviewRounds: 5, filesWritten };
}

function secondsBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
