import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createInitialState, createRunId, ensureRunDirectories, getRunArtifacts, loadState, markStageCompleted, saveState } from "../src/state.js";

test("createRunId formats deterministic qrspi ids", () => {
  const runId = createRunId(new Date(2026, 5, 1, 8, 9, 10));
  assert.equal(runId, "qrspi-20260601-080910");
});

test("state round-trips through state.json", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-state-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);

  const initial = createInitialState({
    runId: "qrspi-20260601-000000",
    userTask: "Ship it.",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  });
  const completed = markStageCompleted(initial, "goals", "research", { route: "quick-fix" });
  await saveState(artifacts.stateFile, completed);

  const loaded = await loadState(artifacts.stateFile);
  assert.ok(loaded);
  assert.equal(loaded.runId, "qrspi-20260601-000000");
  assert.equal(loaded.route, "quick-fix");
  assert.equal(loaded.lastCompletedStage, "goals");
  assert.equal(loaded.nextStage, "research");
});

test("ensureRunDirectories scaffolds pipeline folders", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-dirs-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);

  await Promise.all([
    stat(artifacts.runDir),
    stat(artifacts.telemetryDir),
    stat(artifacts.reviewsDir),
    stat(artifacts.feedbackDir),
    stat(artifacts.outlinesDir),
    stat(artifacts.archiveDir),
  ]);
});
