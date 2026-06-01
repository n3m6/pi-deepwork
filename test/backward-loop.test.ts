import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resetArtifactsForBackwardLoop } from "../src/backward-loop.js";
import { ensureRunDirectories, getRunArtifacts } from "../src/state.js";

test("resetArtifactsForBackwardLoop archives and deletes stale plan artifacts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-loop-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);

  await writeFile(artifacts.planFile, "# Plan\n", "utf8");
  await writeFile(artifacts.phaseManifestFile, "---\ntotal_phases: 1\n---\n", "utf8");
  await writeFile(path.join(artifacts.tasksDir, "task-01.md"), "# Task 01\n", "utf8");
  await mkdir(path.join(artifacts.phasesDir, "phase-01"), { recursive: true });
  await writeFile(path.join(artifacts.phasesDir, "phase-01", "execution-manifest.md"), "# Execution\n", "utf8");

  const result = await resetArtifactsForBackwardLoop(artifacts, "LOOP_PLAN");

  assert.equal(result.targetStage, "plan");
  assert.ok(result.archived.includes("plan.md"));
  assert.ok(result.archived.includes("tasks"));
  await assert.rejects(stat(artifacts.planFile));
  await assert.rejects(stat(path.join(artifacts.phasesDir, "phase-01")));
});

test("resetArtifactsForBackwardLoop treats DEFER_REPLAN as non-destructive", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-loop-defer-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-010000");
  await ensureRunDirectories(artifacts);

  await writeFile(artifacts.planFile, "# Plan\n", "utf8");
  await mkdir(path.join(artifacts.phasesDir, "phase-01"), { recursive: true });
  await writeFile(path.join(artifacts.phasesDir, "phase-01", "execution-manifest.md"), "# Execution\n", "utf8");

  const result = await resetArtifactsForBackwardLoop(artifacts, "DEFER_REPLAN");

  assert.equal(result.targetStage, "replan");
  assert.deepEqual(result.archived, []);
  await stat(artifacts.planFile);
  await stat(path.join(artifacts.phasesDir, "phase-01"));
});
