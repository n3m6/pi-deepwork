import { test } from "node:test";
import assert from "node:assert/strict";

import { CheckpointManager } from "../../src/infrastructure/git/version-control.js";

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
