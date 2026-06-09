import { test } from "node:test";
import assert from "node:assert/strict";

import { CheckpointManager } from "../../src/infra/git/version-control.js";

test("createRunBranch initializes an unborn repository with an empty run commit", async () => {
  const calls: string[][] = [];
  const checkpoint = new CheckpointManager(
    {
      async exec(_command, args) {
        calls.push(args);
        if (args[0] === "rev-parse" && args.includes("HEAD")) {
          return { stdout: "", stderr: "fatal: ambiguous argument HEAD", code: 1, killed: false };
        }
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    },
    "/repo",
  );

  const result = await checkpoint.createRunBranch("qrspi-20260602-000000");

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "HEAD"],
    ["checkout", "--orphan", "qrspi/qrspi-20260602-000000"],
    [
      "-c",
      "user.name=qrspi",
      "-c",
      "user.email=qrspi@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "qrspi: initialize qrspi-20260602-000000",
    ],
  ]);
});

test("stageBoundaryCheckpoint ignores pipeline-only scratch changes", async () => {
  const calls: string[][] = [];
  const checkpoint = new CheckpointManager(
    {
      async exec(_command, args) {
        calls.push(args);
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    },
    "/repo",
  );

  const result = await checkpoint.stageBoundaryCheckpoint("goals", "complete");

  assert.equal(result.ok, true);
  assert.equal(result.warning, "git worktree already clean");
  assert.deepEqual(calls, [["status", "--short", "--", ".", ":(exclude).pipeline", ":(exclude).pipeline/**"]]);
});

test("stageBoundaryCheckpoint stages non-pipeline changes with exclusions", async () => {
  const calls: string[][] = [];
  const checkpoint = new CheckpointManager(
    {
      async exec(_command, args) {
        calls.push(args);
        if (args[0] === "status") {
          return { stdout: " M README.md\n", stderr: "", code: 0, killed: false };
        }
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    },
    "/repo",
  );

  const result = await checkpoint.stageBoundaryCheckpoint("goals", "complete");

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ["status", "--short", "--", ".", ":(exclude).pipeline", ":(exclude).pipeline/**"],
    ["add", "-A", "--", ".", ":(exclude).pipeline", ":(exclude).pipeline/**"],
    ["-c", "user.name=qrspi", "-c", "user.email=qrspi@example.invalid", "commit", "-m", "qrspi: stage goals complete"],
  ]);
});
