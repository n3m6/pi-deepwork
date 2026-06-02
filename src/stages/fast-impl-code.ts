import type { StageOutcome, StageRuntime } from "../types.js";
import { dispatchGenericCoding, readArtifact } from "./utils.js";

export async function runFastImplCodeSubstage(
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
      "Implement the production-code portion of this task in the provided worktree.",
      "Do not edit test files in this step.",
      "Keep the implementation minimal and constrained to the task spec.",
      "All file operations must stay inside the provided worktree. If the task spec contains an absolute path to the original workspace, treat it as a repository-relative path under this worktree instead.",
      `Task: ${options.taskId}`,
      `Attempt: ${options.attempt}`,
      `Worktree root: ${options.worktreeRoot}`,
      "",
      taskSpec,
      "",
      "Run any targeted verification you need before returning. Call stage_return with PASS or FAIL, filesWritten, and a concise summary.",
    ].join("\n"),
    { cwd: options.worktreeRoot },
  );
}
