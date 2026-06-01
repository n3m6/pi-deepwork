import path from "node:path";

import type { DispatchRequest, StageOutcome, StageRuntime } from "../types.js";
import { parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

interface ReviewerSpec {
  agentName: string;
  advisory: boolean;
}

export async function runCodeReviewSubstage(
  runtime: StageRuntime,
  options: {
    taskId: string;
    worktreeRoot: string;
    taskSpecPath: string;
  },
): Promise<StageOutcome> {
  const taskSpec = await readArtifact(options.taskSpecPath);
  const changedFiles = await listChangedFiles(runtime, options.worktreeRoot);
  const changedLineCount = await countChangedLines(runtime, options.worktreeRoot);
  const reviewers = selectReviewers(runtime, changedFiles, changedLineCount);
  const requests: DispatchRequest[] = reviewers.map((reviewer) => {
    const target = runtime.services.agentDefinitions.get(reviewer.agentName);
    if (!target) {
      throw new Error(`Missing leaf agent definition: ${reviewer.agentName}`);
    }
    return {
      target,
      prompt: buildReviewPrompt(options.taskId, options.worktreeRoot, taskSpec, changedFiles, changedLineCount),
      cwd: options.worktreeRoot,
      tools: ["read", "bash", "grep", "find", "ls"],
      ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
    };
  });

  const results = await runtime.services.dispatcher.dispatchParallel(requests);
  const filesWritten: string[] = [];
  const blockingFailures: string[] = [];
  const summaries: string[] = [];

  for (const [index, result] of results.entries()) {
    const reviewer = reviewers[index];
    if (!reviewer) {
      continue;
    }
    const reviewFile = path.join(
      runtime.artifacts.reviewsDir,
      `code-review-task-${options.taskId}-${reviewer.agentName.replace(/^qrspi-/, "")}.md`,
    );
    await writeArtifact(reviewFile, result.text);
    filesWritten.push(path.relative(runtime.artifacts.runDir, reviewFile));
    const status = parseReviewStatus(result.text);
    summaries.push(`${reviewer.agentName}: ${status}${reviewer.advisory ? " (advisory)" : ""}`);
    if (status === "FAIL" && !reviewer.advisory) {
      blockingFailures.push(reviewer.agentName);
    }
  }

  return {
    status: blockingFailures.length > 0 ? "FAIL" : "PASS",
    filesWritten,
    summary: blockingFailures.length > 0
      ? `Blocking code reviewers failed: ${blockingFailures.join(", ")}.`
      : "Code-review fanout passed.",
    telemetry: {
      child_agent_calls: Object.fromEntries(reviewers.map((reviewer) => [reviewer.agentName, 1])),
      review_rounds: 1,
      review_type: "code-review",
      review_status_summary: summaries.join("; "),
    },
  };
}

function selectReviewers(runtime: StageRuntime, changedFiles: string[], changedLineCount: number): ReviewerSpec[] {
  const reviewers: ReviewerSpec[] = [
    { agentName: "qrspi-review-code-quality", advisory: false },
  ];
  const hasTaskTests = changedFiles.some((file) => /\b(__tests__|tests?|spec)\b|[._-](test|spec)\./i.test(file));
  if (hasTaskTests) {
    reviewers.push({ agentName: "qrspi-review-test-coverage", advisory: false });
  }
  if (changedFiles.some((file) => /(auth|security|permission|token|secret|crypto|password|session)/i.test(file))) {
    reviewers.push({ agentName: "qrspi-review-security", advisory: false });
  }
  if (changedFiles.some((file) => /(log|catch|error|fallback|silent|ignore|empty|noop)/i.test(file))) {
    reviewers.push({ agentName: "qrspi-review-silent-failure", advisory: false });
  }
  if (runtime.state.route === "full") {
    reviewers.push({ agentName: "qrspi-review-goal-traceability", advisory: false });
  }
  if (
    changedFiles.length > 3 ||
    changedLineCount > 200 ||
    changedFiles.some((file) => /(simpl|refactor|util|helper|common|shared)/i.test(file))
  ) {
    reviewers.push({ agentName: "qrspi-review-code-simplifier", advisory: true });
  }
  return reviewers;
}

function buildReviewPrompt(
  taskId: string,
  worktreeRoot: string,
  taskSpec: string,
  changedFiles: string[],
  changedLineCount: number,
): string {
  return [
    "Review the current task worktree for implementation issues.",
    "You are read-only for this review pass: do not edit files.",
    "Review against the task spec and observable behavior, not hypothetical improvements.",
    "",
    `Task: ${taskId}`,
    `Worktree root: ${worktreeRoot}`,
    `Changed line count: ${changedLineCount}`,
    "",
    "Changed files:",
    changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`).join("\n") : "None detected.",
    "",
    "Task spec:",
    taskSpec,
  ].join("\n");
}

async function listChangedFiles(runtime: StageRuntime, worktreeRoot: string): Promise<string[]> {
  const result = await runtime.services.pi.exec("git", ["status", "--short"], {
    cwd: worktreeRoot,
    timeout: 60_000,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
  });
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function countChangedLines(runtime: StageRuntime, worktreeRoot: string): Promise<number> {
  const result = await runtime.services.pi.exec("git", ["diff", "--shortstat", "HEAD"], {
    cwd: worktreeRoot,
    timeout: 60_000,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
  });
  const insertions = Number.parseInt(result.stdout.match(/(\d+)\s+insertion/)?.[1] ?? "0", 10);
  const deletions = Number.parseInt(result.stdout.match(/(\d+)\s+deletion/)?.[1] ?? "0", 10);
  return insertions + deletions;
}
