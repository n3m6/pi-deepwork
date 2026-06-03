/**
 * SimpleExactFileWorkflow
 *
 * Canonical detection and fast-path entry point for "simple exact file" tasks.
 * Reads artifact files through the ArtifactRepository port (no direct fs access).
 */

import type { StageOutcome, StageRuntime } from "../../types.js";
import type { SimpleExactFileTask } from "../../domain/task/simple-exact-file-spec.js";
import { parseSimpleExactFileTask } from "../../domain/task/simple-exact-file-spec.js";

export type { SimpleExactFileTask };
export { parseSimpleExactFileTask };
export { isSafeRelativePath } from "../../domain/task/simple-exact-file-spec.js";

/**
 * Detect whether the current run is a simple exact-file task.
 * Returns the parsed task if found on the quick-fix / unknown route, else undefined.
 */
export async function detectSimpleExactFileTask(runtime: StageRuntime): Promise<SimpleExactFileTask | undefined> {
  if (runtime.state.route !== "quick-fix" && runtime.state.route !== "unknown") {
    return undefined;
  }

  const repo = runtime.services.artifactRepo;
  const candidates = [
    runtime.state.userTask ?? "",
    repo ? ((await repo.read({ kind: "goals" })) ?? "") : "",
    repo ? ((await repo.read({ kind: "requirements" })) ?? "") : "",
  ];

  for (const candidate of candidates) {
    const task = parseSimpleExactFileTask(candidate);
    if (task) return task;
  }

  return undefined;
}

/**
 * Run the handler only if the current stage has a simple-exact-file fast path,
 * otherwise return null so the caller falls through to the full agent path.
 */
export async function runIfSimpleTask(
  runtime: StageRuntime,
  handler: (task: SimpleExactFileTask) => Promise<StageOutcome>,
): Promise<StageOutcome | null> {
  const task = await detectSimpleExactFileTask(runtime);
  if (!task) return null;
  return handler(task);
}
