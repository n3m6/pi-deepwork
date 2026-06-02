import path from "node:path";

import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { StageName } from "./types.js";

export interface GitOperationResult {
  ok: boolean;
  result?: ExecResult;
  warning?: string;
}

export class CheckpointManager {
  constructor(
    private readonly pi: Pick<ExtensionAPI, "exec">,
    private readonly workspaceRoot: string,
  ) {}

  async createRunBranch(runId: string, signal?: AbortSignal): Promise<GitOperationResult> {
    const branch = `qrspi/${runId}`;
    const existingHead = await this.execGit(["rev-parse", "--verify", "HEAD"], signal);
    if (!existingHead.ok) {
      const orphan = await this.execGit(["checkout", "--orphan", branch], signal);
      if (!orphan.ok) {
        return orphan;
      }
      return this.execGit([...commitIdentityArgs(), "commit", "--allow-empty", "-m", `qrspi: initialize ${runId}`], signal);
    }

    const base = await this.execGit(["rev-parse", "--verify", "main"], signal);
    const targetBase = base.ok ? "main" : "HEAD";
    return this.execGit(["checkout", "-b", branch, targetBase], signal);
  }

  async stageBoundaryCheckpoint(stage: StageName, action: "complete" | "skipped" | "failed", signal?: AbortSignal): Promise<GitOperationResult> {
    const status = await this.execGit(["status", "--short"], signal);
    if (!status.ok) {
      return status;
    }
    if (!status.result?.stdout.trim()) {
      return { ok: true, warning: "git worktree already clean" };
    }

    const add = await this.execGit(["add", "-A"], signal);
    if (!add.ok) {
      return add;
    }

    return this.execGit([...commitIdentityArgs(), "commit", "-m", `qrspi: stage ${stage} ${action}`], signal);
  }

  async currentBranch(signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.execGit(["branch", "--show-current"], signal);
    return result.ok ? result.result?.stdout.trim() || undefined : undefined;
  }

  async resolveRepoRoot(signal?: AbortSignal): Promise<string> {
    const result = await this.execGit(["rev-parse", "--show-toplevel"], signal);
    if (!result.ok || !result.result?.stdout.trim()) {
      return this.workspaceRoot;
    }
    return result.result.stdout.trim();
  }

  getWorktreeRootParent(repoRoot: string): string {
    return path.dirname(repoRoot);
  }

  private async execGit(args: string[], signal?: AbortSignal): Promise<GitOperationResult> {
    try {
      const result = await this.pi.exec("git", args, {
        cwd: this.workspaceRoot,
        timeout: 60_000,
        ...(signal ? { signal } : {}),
      });
      if (result.code !== 0) {
        return {
          ok: false,
          result,
          warning: result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`,
        };
      }
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function commitIdentityArgs(): string[] {
  return ["-c", "user.name=qrspi", "-c", "user.email=qrspi@example.invalid"];
}

export function phaseBranchName(runId: string, phase: number, taskId: string): string {
  return `qrspi-task/${runId}/phase-${String(phase).padStart(2, "0")}/${taskId}`;
}

export function worktreeRootPath(runId: string, repoRoot: string, phase: number, taskId: string): string {
  return path.join(path.dirname(repoRoot), ".qrspi-worktrees", runId, `phase-${String(phase).padStart(2, "0")}`, taskId);
}
