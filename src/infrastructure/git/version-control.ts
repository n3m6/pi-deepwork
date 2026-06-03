// GitVersionControl — implements the VersionControl port using pi's exec API.
// Wraps CheckpointManager and WorktreeManager.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { CheckpointManager } from "../../checkpoint.js";
import { WorktreeManager } from "../../worktrees.js";
import type { StageName } from "../../application/port/index.js";
import type { TaskWorktreeHandle, VersionControl } from "../../application/port/index.js";

export class GitVersionControl implements VersionControl {
  private readonly checkpointMgr: CheckpointManager;

  constructor(
    private readonly pi: Pick<ExtensionAPI, "exec">,
    private readonly workspaceRoot: string,
    private readonly runId: string,
  ) {
    this.checkpointMgr = new CheckpointManager(pi, workspaceRoot);
  }

  async createRunBranch(runId: string, signal?: AbortSignal): Promise<void> {
    await this.checkpointMgr.createRunBranch(runId, signal);
  }

  async checkpoint(stage: StageName, action: "complete" | "skipped" | "failed", signal?: AbortSignal): Promise<void> {
    await this.checkpointMgr.stageBoundaryCheckpoint(stage, action, signal);
  }

  async resolveRepoRoot(signal?: AbortSignal): Promise<string> {
    return this.checkpointMgr.resolveRepoRoot(signal);
  }

  async prepareWorktree(phase: number, taskId: string, repoRoot: string, signal?: AbortSignal): Promise<TaskWorktreeHandle> {
    const mgr = this.buildWorktreeManager(repoRoot);
    const worktree = await mgr.prepare(phase, taskId, signal);
    return {
      branch: worktree.branch,
      worktreeRoot: worktree.worktreeRoot,
      taskId: worktree.taskId,
      phase: worktree.phase,
    };
  }

  async squashMerge(worktree: TaskWorktreeHandle, commitMessage: string, signal?: AbortSignal): Promise<{ ok: boolean; conflictOutput?: string }> {
    const mgr = this.buildWorktreeManager(this.workspaceRoot);
    return mgr.squashMerge(worktree, commitMessage, signal);
  }

  async rebaseWorktree(worktree: TaskWorktreeHandle, signal?: AbortSignal): Promise<{ ok: boolean; output?: string }> {
    const mgr = this.buildWorktreeManager(this.workspaceRoot);
    return mgr.rebaseOnRunBranch(worktree, signal);
  }

  async continueRebase(worktree: TaskWorktreeHandle, signal?: AbortSignal): Promise<{ ok: boolean; output?: string }> {
    const mgr = this.buildWorktreeManager(this.workspaceRoot);
    return mgr.continueRebase(worktree, signal);
  }

  async commitWorktreeChanges(worktreeRoot: string, message: string, signal?: AbortSignal): Promise<void> {
    const opts = { cwd: worktreeRoot, timeout: 60_000, ...(signal ? { signal } : {}) };
    const add = await this.pi.exec("git", ["add", "-A"], opts);
    if (add.code !== 0) {
      throw new Error(add.stderr.trim() || add.stdout.trim() || "git add -A failed");
    }
    const commit = await this.pi.exec("git", ["-c", "user.name=qrspi", "-c", "user.email=qrspi@example.invalid", "commit", "-m", message], opts);
    if (commit.code !== 0) {
      throw new Error(commit.stderr.trim() || commit.stdout.trim() || "git commit failed");
    }
  }

  async changedFiles(cwd: string, signal?: AbortSignal): Promise<string[]> {
    const result = await this.pi.exec("git", ["status", "--short"], {
      cwd,
      timeout: 60_000,
      ...(signal ? { signal } : {}),
    });
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  }

  async changedLineCount(cwd: string, signal?: AbortSignal): Promise<number> {
    const result = await this.pi.exec("git", ["diff", "--shortstat", "HEAD"], {
      cwd,
      timeout: 60_000,
      ...(signal ? { signal } : {}),
    });
    const insertions = Number.parseInt(result.stdout.match(/(\d+)\s+insertion/)?.[1] ?? "0", 10);
    const deletions = Number.parseInt(result.stdout.match(/(\d+)\s+deletion/)?.[1] ?? "0", 10);
    return insertions + deletions;
  }

  async listWorkspaceFiles(cwd: string, signal?: AbortSignal): Promise<string[]> {
    const result = await this.pi.exec("git", ["ls-files"], {
      cwd,
      timeout: 60_000,
      ...(signal ? { signal } : {}),
    });
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async cleanupWorktree(worktree: TaskWorktreeHandle, signal?: AbortSignal): Promise<void> {
    const mgr = this.buildWorktreeManager(this.workspaceRoot);
    await mgr.cleanup(worktree, signal);
  }

  private buildWorktreeManager(repoRoot: string): WorktreeManager {
    return new WorktreeManager(this.pi, this.workspaceRoot, repoRoot, this.runId);
  }
}
