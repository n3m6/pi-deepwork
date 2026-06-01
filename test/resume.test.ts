import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resumeOrInferState } from "../src/resume.js";
import { createInitialState, ensureRunDirectories, getRunArtifacts, saveState } from "../src/state.js";

test("resumeOrInferState prefers persisted state.json", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-resume-state-"));
  const runId = "qrspi-20260601-000000";
  const artifacts = getRunArtifacts(workspace, runId);
  await ensureRunDirectories(artifacts);

  const state = createInitialState({
    runId,
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "quick-fix",
  });
  await saveState(artifacts.stateFile, state);

  const resumed = await resumeOrInferState({
    workspaceRoot: workspace,
    runId,
    interactionMode: "interactive",
    failurePolicy: "fail-closed",
  });

  assert.ok(resumed.state);
  assert.equal(resumed.state?.resumeSource, "resume");
  assert.equal(resumed.state?.route, "quick-fix");
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

  assert.equal(resumed.state?.lastCompletedStage, "replan");
  assert.equal(resumed.state?.currentPhase, 2);
  assert.equal(resumed.state?.nextStage, "implement");
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

  assert.equal(resumed.state?.route, "quick-fix");
  assert.equal(resumed.state?.lastCompletedStage, "research");
  assert.equal(resumed.state?.nextStage, "plan");
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

  assert.ok(resumed.state);
  assert.equal(resumed.state?.resumeSource, "artifacts");
  assert.equal(resumed.state?.lastCompletedStage, "research");
  assert.equal(resumed.state?.nextStage, "design");
});
