import type { StageOutcome, StageRuntime } from "../types.js";
import { dispatchGenericCoding, readArtifact } from "./utils.js";

export async function runFastImplTestSubstage(
  runtime: StageRuntime,
  options: {
    taskId: string;
    worktreeRoot: string;
    taskSpecPath: string;
    attempt: number;
  },
): Promise<StageOutcome> {
  const taskSpec = await readArtifact(options.taskSpecPath);
  return dispatchGenericCoding(
    runtime,
    [
      "Write or update only the tests needed for this task.",
      "Prefer deterministic, behavior-focused tests. Do not modify unrelated production code.",
      `Task: ${options.taskId}`,
      `Attempt: ${options.attempt}`,
      `Worktree root: ${options.worktreeRoot}`,
      "",
      taskSpec,
      "",
      "Return telemetry.evidence_quality with counts for deterministic, flaky, harnessNoisy, ambiguous, redundant, noTestTasks, and noTestAuditOverrides.",
    ].join("\n"),
    { cwd: options.worktreeRoot },
  );
}
