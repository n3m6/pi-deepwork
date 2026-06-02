import path from "node:path";

import { createAskHumanTool } from "../gates.js";
import { parseKeyValueLines } from "../markdown.js";
import type { DispatchResult } from "../types.js";
import type { GateRoundDetail, Route, StageModule, StageOutcome, StageRuntime } from "../types.js";
import { dispatchFailureSummary, dispatchLeaf, parseReviewStatus, readArtifact, requireMarkdownSection, writeArtifact } from "./utils.js";

interface InterviewEntry {
  branch: string;
  source: "user-answer" | "repo-finding" | "user-confirmed-finding" | "automation-fallback";
  content: string;
}

const QUESTION_SET: Array<{ branch: string; title: string; question: string; required: boolean }> = [
  {
    branch: "problem-and-motivation",
    title: "Deepwork: intent",
    question: "What are you building or changing, and why does it matter?",
    required: true,
  },
  {
    branch: "constraints",
    title: "Deepwork: constraints",
    question: "What constraints or limitations must be respected?",
    required: true,
  },
  {
    branch: "non-goals",
    title: "Deepwork: non-goals",
    question: "What is explicitly out of scope for this run?",
    required: true,
  },
  {
    branch: "acceptance-criteria",
    title: "Deepwork: acceptance criteria",
    question: "How will we know this is done? List observable acceptance criteria.",
    required: true,
  },
  {
    branch: "testing-expectations",
    title: "Deepwork: testing expectations",
    question: "What tests or validation should be added or updated?",
    required: true,
  },
];

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

    await writeArtifact(runtime.artifacts.requirementsFile, userTask);
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
          customTools: [createAskHumanTool(runtime.services.gates)],
        },
      );

      const synthesisFailure = goalsDispatchFailureOutcome(synthesized, "Goals synthesis failed", ["requirements.md"], 0);
      if (synthesisFailure) {
        return synthesisFailure;
      }
      const goalsMarkdown = requireMarkdownSection(synthesized.text, "goals.md");
      const configMarkdown = requireMarkdownSection(synthesized.text, "config.md");
      await writeArtifact(runtime.artifacts.goalsFile, goalsMarkdown);
      await writeArtifact(runtime.artifacts.configFile, configMarkdown);

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
        `Review the goals artifact at ${path.relative(runtime.artifacts.runDir, runtime.artifacts.goalsFile)} and choose how to proceed.`,
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

      const feedbackFile = path.join(runtime.artifacts.feedbackDir, `goals-round-${String(gateRounds).padStart(2, "0")}.md`);
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
      await writeArtifact(feedbackFile, feedbackBlock);
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
      await writeArtifact(runtime.artifacts.requirementsFile, rewrittenRequirements);
    }
  },
};

async function collectInterview(runtime: StageRuntime, userTask: string): Promise<{ entries: InterviewEntry[] } | { failure: string }> {
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

async function runReviewLoop(runtime: StageRuntime, interviewEntries: InterviewEntry[]): Promise<{
  status: "PASS" | "FAIL";
  reviewRounds: number;
  filesWritten: string[];
  summary?: string;
  dispatchFailure?: boolean;
}> {
  const filesWritten: string[] = [];
  const interviewRecord = renderInterviewRecord(interviewEntries);
  const requirements = await readArtifact(runtime.artifacts.requirementsFile);

  let reviewRound = 1;
  while (reviewRound <= 5) {
    const goals = await readArtifact(runtime.artifacts.goalsFile);
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

    const reviewFile = path.join(runtime.artifacts.reviewsDir, `goals-review-round-${String(reviewRound).padStart(2, "0")}.md`);
    await writeArtifact(reviewFile, review.text);
    filesWritten.push(path.relative(runtime.artifacts.runDir, reviewFile));

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
        customTools: [createAskHumanTool(runtime.services.gates)],
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
    await writeArtifact(runtime.artifacts.goalsFile, requireMarkdownSection(rewritten.text, "goals.md"));
    await writeArtifact(runtime.artifacts.configFile, requireMarkdownSection(rewritten.text, "config.md"));
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

function inferFromTask(userTask: string, branch: string): string | undefined {
  const normalized = userTask.trim();
  if (!normalized) {
    return undefined;
  }
  switch (branch) {
    case "problem-and-motivation":
      return normalized;
    case "constraints":
      return /\b(without|must|should not|cannot|don't)\b/i.test(normalized) ? normalized : undefined;
    case "non-goals":
      return /\bout of scope|non-goal|not include\b/i.test(normalized) ? normalized : undefined;
    case "acceptance-criteria":
      return /\bacceptance\b|\bshould\b|\bmust\b/i.test(normalized) ? normalized : undefined;
    case "testing-expectations":
      return /\btest|verify|validation|acceptance\b/i.test(normalized) ? normalized : undefined;
    default:
      return undefined;
  }
}

function secondsBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
