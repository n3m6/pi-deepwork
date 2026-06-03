import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { commitIdentityArgs, phaseBranchName, worktreeRootPath } from "./checkpoint.js";

export interface TaskWorktree {
  branch: string;
  worktreeRoot: string;
  taskId: string;
  phase: number;
}

export class WorktreeManager {
  constructor(
    private readonly pi: Pick<ExtensionAPI, "exec">,
    private readonly workspaceRoot: string,
    private readonly repoRoot: string,
    private readonly runId: string,
  ) {}

  async prepare(phase: number, taskId: string, signal?: AbortSignal): Promise<TaskWorktree> {
    const branch = phaseBranchName(this.runId, phase, taskId);
    const worktreeRoot = worktreeRootPath(this.runId, this.repoRoot, phase, taskId);
    await mkdir(path.dirname(worktreeRoot), { recursive: true });
    await this.cleanup({ branch, worktreeRoot, taskId, phase }, signal);
    await this.ensureRunBranch(signal);
    await this.exec(["worktree", "add", "-b", branch, worktreeRoot, `qrspi/${this.runId}`], signal);
    return { branch, worktreeRoot, taskId, phase };
  }

  async cleanup(worktree: TaskWorktree, signal?: AbortSignal): Promise<void> {
    await this.exec(["worktree", "remove", "--force", worktree.worktreeRoot], signal, true);
    await this.exec(["branch", "-D", worktree.branch], signal, true);
  }

  async squashMerge(worktree: TaskWorktree, commitMessage: string, signal?: AbortSignal): Promise<{
    ok: boolean;
    conflictOutput?: string;
  }> {
    const merge = await this.exec(["merge", "--squash", worktree.branch], signal, true);
    if (merge.code !== 0) {
      await this.exec(["merge", "--abort"], signal, true);
      await this.exec(["reset", "--merge"], signal, true);
      return {
        ok: false,
        conflictOutput: [merge.stdout, merge.stderr].filter(Boolean).join("\n"),
      };
    }

    const staged = await this.exec(["diff", "--cached", "--quiet"], signal, true);
    if (staged.code === 0) {
      await this.cleanup(worktree, signal);
      return { ok: true };
    }

    await this.exec([...commitIdentityArgs(), "commit", "-m", commitMessage], signal);
    await this.cleanup(worktree, signal);
    return { ok: true };
  }

  async listChangedFiles(worktree: TaskWorktree, signal?: AbortSignal): Promise<string[]> {
    const diff = await this.exec(["-C", worktree.worktreeRoot, "status", "--short"], signal);
    return diff.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3));
  }

  async rebaseOnRunBranch(worktree: TaskWorktree, signal?: AbortSignal): Promise<{ ok: boolean; output?: string }> {
    const rebase = await this.exec(["-C", worktree.worktreeRoot, "rebase", `qrspi/${this.runId}`], signal, true);
    return {
      ok: rebase.code === 0,
      output: [rebase.stdout, rebase.stderr].filter(Boolean).join("\n"),
    };
  }

  async continueRebase(worktree: TaskWorktree, signal?: AbortSignal): Promise<{ ok: boolean; output?: string }> {
    const add = await this.exec(["-C", worktree.worktreeRoot, "add", "-A"], signal, true);
    if (add.code !== 0) {
      return { ok: false, output: [add.stdout, add.stderr].filter(Boolean).join("\n") };
    }
    const rebase = await this.exec(["-C", worktree.worktreeRoot, "-c", "core.editor=true", "rebase", "--continue"], signal, true);
    return {
      ok: rebase.code === 0,
      output: [rebase.stdout, rebase.stderr].filter(Boolean).join("\n"),
    };
  }

  private async exec(args: string[], signal?: AbortSignal, tolerateFailure = false) {
    const result = await this.pi.exec("git", args, {
      cwd: this.workspaceRoot,
      timeout: 60_000,
      ...(signal ? { signal } : {}),
    });
    if (!tolerateFailure && result.code !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
    }
    return result;
  }

  private async ensureRunBranch(signal?: AbortSignal): Promise<void> {
    const runBranch = `qrspi/${this.runId}`;
    const existing = await this.exec(["rev-parse", "--verify", runBranch], signal, true);
    if (existing.code === 0) {
      return;
    }
    const head = await this.exec(["rev-parse", "--verify", "HEAD"], signal, true);
    if (head.code !== 0) {
      const orphan = await this.exec(["checkout", "--orphan", runBranch], signal, true);
      if (orphan.code !== 0) {
        throw new Error(orphan.stderr.trim() || orphan.stdout.trim() || `git checkout --orphan ${runBranch} failed`);
      }
      await this.exec([...commitIdentityArgs(), "commit", "--allow-empty", "-m", `qrspi: initialize ${this.runId}`], signal);
      return;
    }
    await this.exec(["branch", runBranch, "HEAD"], signal);
  }
}
