import { QUESTION_SET, inferFromTask } from "../../domain/goals/interview-policy.js";
import { parseKeyValueLines } from "../../infrastructure/codec/markdown-codec.js";
import { parseSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import type { DispatchResult } from "../port/index.js";
import type { GateRoundDetail, Route, StageModule, StageOutcome, StageRuntime } from "../port/index.js";
import {
  artifactRelPath,
  dispatchFailureSummary,
  dispatchLeaf,
  parseReviewStatus,
  readArtifact,
  requireMarkdownSection,
  writeArtifact,
} from "./utils.js";

interface InterviewEntry {
  branch: string;
  source: "user-answer" | "repo-finding" | "user-confirmed-finding" | "automation-fallback";
  content: string;
}

export const goalsStage: StageModule = {
  stage: "goals",
  async run(runtime): Promise<StageOutcome> {
    const userTask = runtime.state.userTask;
    if (!userTask) {
      return {
        status: "FAIL",
        filesWritten: [],
        summary: "Cannot run Goals without an initial task description.",
        telemetry: {
          gate_status: "none",
        },
      };
    }

    await writeArtifact(runtime, { kind: "requirements" }, userTask);
    const simpleTask = parseSimpleExactFileTask(userTask);
    if (simpleTask) {
      await writeArtifact(runtime, { kind: "goals" }, renderSimpleGoals(simpleTask.filePath, simpleTask.content));
      await writeArtifact(runtime, { kind: "config" }, renderSimpleConfig(runtime.state.runId));
      return {
        status: "PASS",
        filesWritten: ["requirements.md", "goals.md", "config.md"],
        route: "quick-fix",
        summary: "Simple exact-file task captured deterministically. Route: quick-fix.",
        telemetry: {
          review_rounds: 0,
          terminal_review_state: "clean",
          gate_status: "approved",
          gate_mode: "automated",
          gate_rounds: 0,
          gate_wait_time_s: 0,
          gate_round_details: [],
          deterministic_fast_path: "simple-exact-file",
        },
      };
    }

    const interview = await collectInterview(runtime, userTask);
    if ("failure" in interview) {
      return {
        status: "FAIL",
        filesWritten: ["requirements.md"],
        summary: interview.failure,
        telemetry: {
          gate_status: "none",
          review_rounds: 0,
          gate_rounds: 0,
          gate_wait_time_s: 0,
          gate_round_details: [],
        },
      };
    }

    let feedbackHistory: string[] = [];
    let gateRounds = 0;
    let gateWaitTimeSeconds = 0;
    const gateRoundDetails: GateRoundDetail[] = [];

    while (true) {
      const synthesized = await dispatchLeaf(
        runtime,
        "qrspi-goals-synthesizer",
        [
          "=== RUN ID ===",
          runtime.state.runId,
          "",
          "=== USER TASK ===",
          userTask,
          "",
          "=== INTERVIEW RECORD ===",
          renderInterviewRecord(interview.entries),
          feedbackHistory.length > 0 ? "\n=== FEEDBACK HISTORY ===" : "",
          feedbackHistory.length > 0 ? feedbackHistory.join("\n\n") : "",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          customTools: [runtime.services.gates.createAskHumanTool()],
        },
      );

      const synthesisFailure = goalsDispatchFailureOutcome(
        synthesized,
        "Goals synthesis failed",
        ["requirements.md"],
        0,
      );
      if (synthesisFailure) {
        return synthesisFailure;
      }
      const goalsMarkdown = requireMarkdownSection(synthesized.text, "goals.md");
      const configMarkdown = requireMarkdownSection(synthesized.text, "config.md");
      await writeArtifact(runtime, { kind: "goals" }, goalsMarkdown);
      await writeArtifact(runtime, { kind: "config" }, configMarkdown);

      const review = await runReviewLoop(runtime, interview.entries);
      if (review.status === "FAIL") {
        const telemetry = {
          review_rounds: review.reviewRounds,
          ...(review.dispatchFailure ? {} : { terminal_review_state: "unclean-cap" as const }),
          gate_status: "none" as const,
          gate_rounds: 0,
          gate_wait_time_s: 0,
          gate_round_details: [],
        };
        return {
          status: "FAIL",
          filesWritten: ["requirements.md", "goals.md", "config.md", ...review.filesWritten],
          summary: review.summary ?? "Goals review loop reached the unresolved review cap.",
          telemetry,
        };
      }

      if (runtime.services.gates.interactionMode === "automated") {
        const route = parseRoute(configMarkdown);
        return {
          status: "PASS",
          filesWritten: ["requirements.md", "goals.md", "config.md", ...review.filesWritten],
          route,
          summary: `Goals captured and approved automatically. Route: ${route}.`,
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
        "Goals approval",
        [
          { value: "approve", label: "Approve goals and continue" },
          { value: "feedback", label: "Provide revision feedback" },
        ],
        `Review the goals artifact at ${artifactRelPath(runtime, { kind: "goals" })} and choose how to proceed.`,
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
        const route = parseRoute(configMarkdown);
        return {
          status: "PASS",
          filesWritten: ["requirements.md", "goals.md", "config.md", ...review.filesWritten],
          route,
          summary: `Goals captured and approved. Route: ${route}.`,
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
        "Goals feedback",
        "Describe the changes needed before the goals can be approved.",
      );
      if (!feedback && runtime.services.gates.failurePolicy === "fail-closed") {
        return {
          status: "FAIL",
          filesWritten: ["requirements.md", "goals.md", "config.md", ...review.filesWritten],
          summary: "Goals approval was rejected without actionable feedback.",
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

      const feedbackId = {
        kind: "feedbackFile" as const,
        name: `goals-round-${String(gateRounds).padStart(2, "0")}.md`,
      };
      const feedbackBlock = [
        `## Round ${gateRounds} Feedback`,
        "",
        "### User Feedback",
        feedback?.trim() || "No additional feedback supplied.",
        "",
        "### Rejected Artifact",
        goalsMarkdown.trim(),
        "",
      ].join("\n");
      await writeArtifact(runtime, feedbackId, feedbackBlock);
      feedbackHistory.push(feedbackBlock);

      const rewrittenRequirements = [
        "## Original User Task",
        userTask.trim(),
        "",
        "## User Feedback Updates",
        feedbackHistory
          .map((entry) => entry.match(/### User Feedback\n([\s\S]*?)\n\n### Rejected Artifact/)?.[1]?.trim() ?? "")
          .filter(Boolean)
          .join("\n\n"),
        "",
      ].join("\n");
      await writeArtifact(runtime, { kind: "requirements" }, rewrittenRequirements);
    }
  },
};

async function collectInterview(
  runtime: StageRuntime,
  userTask: string,
): Promise<{ entries: InterviewEntry[] } | { failure: string }> {
  const entries: InterviewEntry[] = [
    {
      branch: "user-task",
      source: "user-answer",
      content: userTask,
    },
  ];

  for (const question of QUESTION_SET) {
    const inferred = inferFromTask(userTask, question.branch);
    if (inferred) {
      entries.push({
        branch: question.branch,
        source: "user-answer",
        content: inferred,
      });
      continue;
    }

    if (runtime.services.gates.interactionMode === "interactive") {
      const answer = await runtime.services.gates.askText(question.title, question.question);
      if (answer?.trim()) {
        entries.push({
          branch: question.branch,
          source: "user-answer",
          content: answer.trim(),
        });
        continue;
      }
    }

    if (runtime.services.gates.failurePolicy === "fail-closed" && question.required) {
      return {
        failure: `Goals interview could not resolve the required branch "${question.branch}".`,
      };
    }

    entries.push({
      branch: question.branch,
      source: "automation-fallback",
      content: "Unresolved; proceed conservatively.",
    });
  }

  return { entries };
}

async function runReviewLoop(
  runtime: StageRuntime,
  interviewEntries: InterviewEntry[],
): Promise<{
  status: "PASS" | "FAIL";
  reviewRounds: number;
  filesWritten: string[];
  summary?: string;
  dispatchFailure?: boolean;
}> {
  const filesWritten: string[] = [];
  const interviewRecord = renderInterviewRecord(interviewEntries);
  const requirements = await readArtifact(runtime, { kind: "requirements" });

  let reviewRound = 1;
  while (reviewRound <= 5) {
    const goals = await readArtifact(runtime, { kind: "goals" });
    const review = await dispatchLeaf(
      runtime,
      "qrspi-goals-reviewer",
      [
        "=== REQUIREMENTS ===",
        requirements,
        "",
        "=== INTERVIEW RECORD ===",
        interviewRecord,
        "",
        "=== GOALS ===",
        goals,
      ].join("\n"),
    );
    const reviewFailure = dispatchFailureSummary(review, "Goals review failed");
    if (reviewFailure) {
      return {
        status: "FAIL",
        reviewRounds: reviewRound,
        filesWritten,
        summary: reviewFailure,
        dispatchFailure: true,
      };
    }

    const reviewId = {
      kind: "reviewFile" as const,
      name: `goals-review-round-${String(reviewRound).padStart(2, "0")}.md`,
    };
    await writeArtifact(runtime, reviewId, review.text);
    filesWritten.push(artifactRelPath(runtime, reviewId));

    if (parseReviewStatus(review.text) === "PASS") {
      return {
        status: "PASS",
        reviewRounds: reviewRound,
        filesWritten,
      };
    }

    if (reviewRound === 5) {
      return {
        status: "FAIL",
        reviewRounds: reviewRound,
        filesWritten,
      };
    }

    const rewritten = await dispatchLeaf(
      runtime,
      "qrspi-goals-synthesizer",
      [
        "=== RUN ID ===",
        runtime.state.runId,
        "",
        "=== USER TASK ===",
        runtime.state.userTask ?? requirements,
        "",
        "=== INTERVIEW RECORD ===",
        interviewRecord,
        "",
        "=== REVIEW FEEDBACK ===",
        review.text,
      ].join("\n"),
      {
        customTools: [runtime.services.gates.createAskHumanTool()],
      },
    );
    const rewriteFailure = dispatchFailureSummary(rewritten, "Goals rewrite failed");
    if (rewriteFailure) {
      return {
        status: "FAIL",
        reviewRounds: reviewRound,
        filesWritten,
        summary: rewriteFailure,
        dispatchFailure: true,
      };
    }
    await writeArtifact(runtime, { kind: "goals" }, requireMarkdownSection(rewritten.text, "goals.md"));
    await writeArtifact(runtime, { kind: "config" }, requireMarkdownSection(rewritten.text, "config.md"));
    reviewRound += 1;
  }

  return {
    status: "FAIL",
    reviewRounds: 5,
    filesWritten,
  };
}

function goalsDispatchFailureOutcome(
  result: DispatchResult,
  label: string,
  filesWritten: string[],
  reviewRounds: number,
): StageOutcome | undefined {
  const summary = dispatchFailureSummary(result, label);
  if (!summary) {
    return undefined;
  }
  return {
    status: "FAIL",
    filesWritten,
    summary,
    telemetry: {
      review_rounds: reviewRounds,
      gate_status: "none",
      gate_rounds: 0,
      gate_wait_time_s: 0,
      gate_round_details: [],
      dispatch_end_reason: result.endReason ?? "unknown",
    },
  };
}

function renderInterviewRecord(entries: InterviewEntry[]): string {
  return entries
    .map((entry) => [`## ${entry.branch}`, `source: ${entry.source}`, entry.content.trim(), ""].join("\n"))
    .join("\n");
}

function parseRoute(configMarkdown: string): Route {
  const values = parseKeyValueLines(configMarkdown);
  return values.route === "quick-fix" ? "quick-fix" : "full";
}

function renderSimpleGoals(filePath: string, content: string): string {
  return [
    "# Goals",
    "",
    "## Intent",
    `Create \`${filePath}\` with exact content.`,
    "",
    "## Functional Requirements",
    `- The file \`${filePath}\` must exist in the repository root.`,
    `- The file \`${filePath}\` must contain exactly \`${content}\`.`,
    "",
    "## Non-Functional Requirements",
    "None specified.",
    "",
    "## Technical Specification",
    "Use a byte-preserving write method so no trailing newline or extra whitespace is added.",
    "",
    "## Constraints",
    "- Do not add any other files or content.",
    "",
    "## Non-Goals",
    "- No unrelated repository changes.",
    "",
    "## Acceptance Criteria",
    `1. A file named \`${filePath}\` exists in the repository root.`,
    `2. The content of \`${filePath}\` is exactly \`${content}\`, with no additional characters, lines, or whitespace.`,
  ].join("\n");
}

function renderSimpleConfig(runId: string): string {
  return [
    "---",
    `created: ${new Date().toISOString().slice(0, 10)}`,
    "route: quick-fix",
    `run_id: ${runId}`,
    "---",
    "",
  ].join("\n");
}

function secondsBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
