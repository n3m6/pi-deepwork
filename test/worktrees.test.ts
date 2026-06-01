import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { WorktreeManager, type TaskWorktree } from "../src/worktrees.js";

test("squashMerge aborts and reports conflicts without cleanup", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-worktree-"));
  const calls: string[][] = [];
  const manager = new WorktreeManager(
    {
      async exec(_command, args) {
        calls.push(args);
        if (args[0] === "merge" && args[1] === "--squash") {
          return { stdout: "", stderr: "conflict", code: 1, killed: false };
        }
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    },
    workspace,
    workspace,
    "qrspi-20260601-050000",
  );
  const worktree: TaskWorktree = {
    branch: "task-branch",
    worktreeRoot: path.join(workspace, "task"),
    taskId: "01",
    phase: 1,
  };

  const result = await manager.squashMerge(worktree, "merge task");

  assert.equal(result.ok, false);
  assert.match(result.conflictOutput ?? "", /conflict/);
  assert.deepEqual(calls.slice(0, 3), [
    ["merge", "--squash", "task-branch"],
    ["merge", "--abort"],
    ["reset", "--merge"],
  ]);
});

test("worktree rebase helpers report continue failures for abandon path", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-worktree-"));
  const manager = new WorktreeManager(
    {
      async exec(_command, args) {
        if (args.includes("--continue")) {
          return { stdout: "", stderr: "still conflicted", code: 1, killed: false };
        }
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    },
    workspace,
    workspace,
    "qrspi-20260601-060000",
  );
  const worktree: TaskWorktree = {
    branch: "task-branch",
    worktreeRoot: path.join(workspace, "task"),
    taskId: "01",
    phase: 1,
  };

  const result = await manager.continueRebase(worktree);

  assert.equal(result.ok, false);
  assert.match(result.output ?? "", /still conflicted/);
});
