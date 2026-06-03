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
      "Do not create new test infrastructure, package manifests, or test directories unless the task spec explicitly lists those files or the repository already has a matching harness.",
      "For trivial file-creation tasks with no existing harness, perform a read-back verification and return PASS with no test files written.",
      "When testing CLI subprocesses, capture the actual stdout, stderr, and exit status. Prefer spawnSync over execSync when assertions need stderr or non-zero exit codes; do not hardcode stderr values in helpers.",
      "If a subprocess helper catches errors, use a local structural type for the observed fields instead of referencing non-exported Node.js error types.",
      "All file operations must stay inside the provided worktree. If the task spec contains an absolute path to the original workspace, treat it as a repository-relative path under this worktree instead.",
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
