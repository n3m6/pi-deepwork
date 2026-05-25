import { spawnSync } from "node:child_process";

import type { GitBranchResult, GitPort } from "../../ports/git";

export function isGitAvailable(): boolean {
  try {
    const result = spawnSync("git", ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function tryCreateGitBranch(
  runId: string,
  workspaceRoot: string,
): GitBranchResult {
  try {
    const result = spawnSync(
      "git",
      ["checkout", "-b", `qrspi/${runId}`, "main"],
      {
        encoding: "utf-8",
        cwd: workspaceRoot,
      },
    );
    if (result.status !== 0) {
      const err = (result.stderr ?? result.stdout ?? "").trim();
      return {
        ok: false,
        error: err || `git checkout exited with status ${result.status}`,
      };
    }
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const gitCli: GitPort = {
  isAvailable: isGitAvailable,
  createRunBranch: tryCreateGitBranch,
};
