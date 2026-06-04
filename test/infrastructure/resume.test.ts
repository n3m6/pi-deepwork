import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resumeOrInferState } from "../../src/infrastructure/fs/state-reconstruction.js";
import { ensureRunDirectories, getRunArtifacts } from "../../src/infrastructure/fs/artifact-repository.js";
import { saveState } from "../../src/infrastructure/fs/state-repository.js";
import { Run } from "../../src/domain/run/index.js";

test("resumeOrInferState prefers persisted state.json", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-resume-state-"));
  const runId = "qrspi-20260601-000000";
  const artifacts = getRunArtifacts(workspace, runId);
  await ensureRunDirectories(artifacts);

  const state = Run.start({
    runId,
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "quick-fix",
  }).toSnapshot();
  await saveState(artifacts.stateFile, state);

  const resumed = await resumeOrInferState({
    workspaceRoot: workspace,
    runId,
    interactionMode: "interactive",
    failurePolicy: "fail-closed",
  });

  assert.ok(resumed);
  assert.equal(resumed?.resumeSource, "resume");
  assert.equal(resumed?.route, "quick-fix");
});

test("resumeOrInferState infers mid-loop replan as next phase implement", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-resume-loop-"));
  const runId = "qrspi-20260601-010000";
  const artifacts = getRunArtifacts(workspace, runId);
  await ensureRunDirectories(artifacts);
  const phaseDir = path.join(artifacts.phasesDir, "phase-01");
  await mkdir(path.join(phaseDir, "replan"), { recursive: true });

  await writeFile(artifacts.configFile, `route: full\nrun_id: ${runId}\n`, "utf8");
  await writeFile(artifacts.goalsFile, "# Goals\n", "utf8");
  await writeFile(artifacts.researchSummaryFile, "# Research\n", "utf8");
  await writeFile(artifacts.designFile, "# Design\n", "utf8");
  await writeFile(artifacts.structureFile, "# Structure\n", "utf8");
  await writeFile(artifacts.planFile, "# Plan\n", "utf8");
  await writeFile(artifacts.phaseManifestFile, "---\ntotal_phases: 2\n---\n", "utf8");
  await writeFile(path.join(phaseDir, "stage7-summary.md"), "### Status — PASS\n\n# Stage 7 Summary\n", "utf8");
  await writeFile(path.join(phaseDir, "stage8-summary.md"), "### Status — PASS\n\n# Stage 8 Summary\n", "utf8");
  await writeFile(path.join(phaseDir, "replan", "phase-01-replan.md"), "# Replan\n", "utf8");

  const resumed = await resumeOrInferState({
    workspaceRoot: workspace,
    runId,
    interactionMode: "automated",
    failurePolicy: "best-effort",
  });

  assert.equal(resumed?.lastCompletedStage, "replan");
  assert.equal(resumed?.currentPhase, 2);
  assert.equal(resumed?.nextStage, "implement");
});

test("resumeOrInferState respects quick-fix route when inferring artifacts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-resume-quick-"));
  const runId = "qrspi-20260601-020000";
  const artifacts = getRunArtifacts(workspace, runId);
  await ensureRunDirectories(artifacts);

  await writeFile(artifacts.configFile, `route: quick-fix\nrun_id: ${runId}\n`, "utf8");
  await writeFile(artifacts.goalsFile, "# Goals\n", "utf8");
  await writeFile(artifacts.researchSummaryFile, "# Research\n", "utf8");

  const resumed = await resumeOrInferState({
    workspaceRoot: workspace,
    runId,
    interactionMode: "automated",
    failurePolicy: "best-effort",
  });

  assert.equal(resumed?.route, "quick-fix");
  assert.equal(resumed?.lastCompletedStage, "research");
  assert.equal(resumed?.nextStage, "plan");
});

test("resumeOrInferState can infer progress from artifacts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-resume-artifacts-"));
  const runId = "qrspi-20260601-000000";
  const artifacts = getRunArtifacts(workspace, runId);
  await ensureRunDirectories(artifacts);

  await writeFile(artifacts.goalsFile, "# Goals\n\nok\n", "utf8");
  await writeFile(artifacts.researchSummaryFile, "# Research\n\nok\n", "utf8");

  const resumed = await resumeOrInferState({
    workspaceRoot: workspace,
    runId,
    interactionMode: "automated",
    failurePolicy: "best-effort",
  });

  assert.ok(resumed);
  assert.equal(resumed?.resumeSource, "artifacts");
  assert.equal(resumed?.lastCompletedStage, "research");
  assert.equal(resumed?.nextStage, "design");
});
