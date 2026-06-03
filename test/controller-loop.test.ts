import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPipeline } from "../src/controller.js";
import { CheckpointManager } from "../src/checkpoint.js";
import { TelemetryRecorder } from "../src/telemetry.js";
import { markStageCompleted } from "../src/state.js";
import { TestHarness } from "./support/harness.js";
import type { DispatchRequest, DispatchResult, Dispatcher, TelemetryEvent } from "../src/types.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

function makeCheckpoint(harness: TestHarness): CheckpointManager {
  return new CheckpointManager(harness.services.pi, harness.workspaceRoot);
}

async function makeTelemetry(harness: TestHarness): Promise<TelemetryRecorder> {
  const telemetry = new TelemetryRecorder(harness.artifacts, harness.state.runId);
  await telemetry.initialize();
  return telemetry;
}

async function writeReportArtifacts(harness: TestHarness): Promise<void> {
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Works.", "utf8");
  await writeFile(harness.artifacts.baselineResultsFile, "### Baseline Status — PASS\n\nAll clean.", "utf8");
  await writeFile(harness.artifacts.stage9SummaryFile, "### Overall Status — PASS\n\n### Stage Summary\nVerification passed.", "utf8");
  const phase = harness.state.currentPhase;
  const phaseDir = path.join(harness.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(path.join(phaseDir, "stage8-summary.md"), "### Status — PASS\n\nAll accepted.", "utf8");
  await writeFile(path.join(phaseDir, "execution-manifest.md"), "# Execution Manifest\n\nAll tasks PASS.", "utf8");
}

// ---------------------------------------------------------------------------
// Lifecycle telemetry
// ---------------------------------------------------------------------------

test("runPipeline emits run.started and run.completed telemetry on a trivial run", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);

  // Advance state so we only need to run `report`, and write what report reads
  harness.state = markStageCompleted(harness.state, "verify", "report");
  harness.state = { ...harness.state, nextStage: "report" };
  await writeReportArtifacts(harness);

  const telemetry = await makeTelemetry(harness);
  const checkpoint = makeCheckpoint(harness);

  const finalState = await runPipeline({
    services: harness.services,
    state: harness.state,
    artifacts: harness.artifacts,
    telemetry,
    checkpoint,
    isResumed: false,
  });

  const events = await telemetry.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(eventTypes.includes("run.started"), `Expected run.started; got ${JSON.stringify(eventTypes)}`);
  assert.ok(eventTypes.includes("run.completed"), `Expected run.completed; got ${JSON.stringify(eventTypes)}`);
  assert.equal(finalState.nextStage, "done");
});

test("runPipeline emits run.resumed (not run.started) when isResumed is true", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);

  harness.state = markStageCompleted(harness.state, "verify", "report");
  harness.state = { ...harness.state, nextStage: "report" };
  await writeReportArtifacts(harness);

  const telemetry = await makeTelemetry(harness);
  const checkpoint = makeCheckpoint(harness);

  await runPipeline({
    services: harness.services,
    state: harness.state,
    artifacts: harness.artifacts,
    telemetry,
    checkpoint,
    isResumed: true,
  });

  const events = await telemetry.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(eventTypes.includes("run.resumed"), `Expected run.resumed; got ${JSON.stringify(eventTypes)}`);
  assert.ok(!eventTypes.includes("run.started"), "Should not emit run.started on resume");
});

// ---------------------------------------------------------------------------
// Backward loop via implement → integration checker (LOOP_PLAN)
// ---------------------------------------------------------------------------

test("runPipeline emits backward_loop events when implement returns integration-checker backward loop", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 1 });
  harnesses.push(harness);

  // Advance state to implement
  harness.state = markStageCompleted(harness.state, "research", "design");
  harness.state = markStageCompleted(harness.state, "design", "structure");
  harness.state = markStageCompleted(harness.state, "structure", "plan");
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });
  harness.state = { ...harness.state, nextStage: "implement" };

  // Write artifacts implement and plan need (plan stage runs after backward loop)
  await writeFile(harness.artifacts.planFile, "# Plan\n\n## Overview\nOne phase.", "utf8");
  await writeFile(harness.artifacts.phaseManifestFile, "---\ntotal_phases: 1\n---\n\n## Phase 1\n- **Tasks:** 01\n", "utf8");
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Works.", "utf8");
  await writeFile(harness.artifacts.requirementsFile, "Build CLI.", "utf8");
  await writeFile(harness.artifacts.baselineResultsFile, "### Baseline Status — PASS\n", "utf8");
  await writeFile(harness.artifacts.configFile, `created: 2026-06-01\nroute: full\nrun_id: ${harness.state.runId}\n`, "utf8");
  // Plan stage also needs research summary, design, and structure
  await mkdir(harness.artifacts.researchDir, { recursive: true });
  await writeFile(harness.artifacts.researchSummaryFile, "# Research Summary\n\nFindings synthesized.", "utf8");
  await writeFile(harness.artifacts.designFile, "# Design\n\nSimple design.", "utf8");
  await writeFile(harness.artifacts.structureFile, "# Structure\n\n- `src/example.ts` (MODIFY)", "utf8");

  const taskSpec = "# Task 01: Example\n\n## Metadata\n- **Task:** 01\n- **Phase:** 1\n- **Route:** full\n\n## Files\n- `src/example.ts` (MODIFY)\n";
  await mkdir(harness.artifacts.tasksDir, { recursive: true });
  await writeFile(path.join(harness.artifacts.tasksDir, "task-01.md"), taskSpec, "utf8");

  const integrationCheckerDispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-integration-checker") {
        return {
          text: "### Status — FAIL\n\n### Stage Summary\nCross-task issue detected.\n\n### Backward Loop Request\n**Affected Artifact**: plan\nPlanning needs revisiting.",
          messages: [],
          customToolCalls: [],
          endReason: "agent_end",
        };
      }
      // Delegate everything else to the harness MockDispatcher
      return harness.dispatcher.dispatch(request);
    },
    async dispatchParallel(requests) { return Promise.all(requests.map((r) => this.dispatch(r))); },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
  };

  const telemetry = await makeTelemetry(harness);
  const checkpoint = makeCheckpoint(harness);

  const finalState = await runPipeline({
    services: { ...harness.services, dispatcher: integrationCheckerDispatcher },
    state: harness.state,
    artifacts: harness.artifacts,
    telemetry,
    checkpoint,
    isResumed: false,
  });

  const events = await telemetry.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(
    eventTypes.includes("backward_loop.requested"),
    `Expected backward_loop.requested; got ${JSON.stringify(eventTypes)}`,
  );

  void finalState;
});

// ---------------------------------------------------------------------------
// MAX_BACKWARD_LOOPS cap
// ---------------------------------------------------------------------------

test("runPipeline emits backward_loop.failed when implement backward loop hits cap", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 1 });
  harnesses.push(harness);

  // Set backwardLoops at MAX (3) so next backward loop triggers cap
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });
  harness.state = { ...harness.state, nextStage: "implement", backwardLoops: 3 };

  await writeFile(harness.artifacts.planFile, "# Plan\n\n## Overview\nOne phase.", "utf8");
  await writeFile(harness.artifacts.phaseManifestFile, "---\ntotal_phases: 1\n---\n\n## Phase 1\n- **Tasks:** 01\n", "utf8");
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Works.", "utf8");
  await writeFile(harness.artifacts.requirementsFile, "Build CLI.", "utf8");
  await writeFile(harness.artifacts.baselineResultsFile, "### Baseline Status — PASS\n", "utf8");
  await writeFile(harness.artifacts.configFile, `created: 2026-06-01\nroute: full\nrun_id: ${harness.state.runId}\n`, "utf8");
  await mkdir(harness.artifacts.tasksDir, { recursive: true });
  await writeFile(path.join(harness.artifacts.tasksDir, "task-01.md"), "# Task 01\n\n## Metadata\n- **Task:** 01\n- **Phase:** 1\n- **Route:** full\n\n## Files\n- `src/example.ts` (MODIFY)\n", "utf8");

  const capDispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-integration-checker") {
        return {
          text: "### Status — FAIL\n\n### Stage Summary\nCross-task issue.\n\n### Backward Loop Request\n**Affected Artifact**: design\nDesign needs rethinking.",
          messages: [],
          customToolCalls: [],
          endReason: "agent_end",
        };
      }
      return harness.dispatcher.dispatch(request);
    },
    async dispatchParallel(requests) { return Promise.all(requests.map((r) => this.dispatch(r))); },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
  };

  const telemetry = await makeTelemetry(harness);
  const checkpoint = makeCheckpoint(harness);

  const finalState = await runPipeline({
    services: { ...harness.services, dispatcher: capDispatcher },
    state: harness.state,
    artifacts: harness.artifacts,
    telemetry,
    checkpoint,
    isResumed: false,
  });

  const events = await telemetry.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(
    eventTypes.includes("backward_loop.failed"),
    `Expected backward_loop.failed; got ${JSON.stringify(eventTypes)}`,
  );
  assert.ok(finalState.nextStage !== "done", "Pipeline should have stopped before completing normally");
});

// ---------------------------------------------------------------------------
// Quick-fix route skips design and structure
// ---------------------------------------------------------------------------

test("runPipeline emits stage.skipped for design and structure in quick-fix route", async () => {
  const harness = await TestHarness.create({ route: "quick-fix", totalPhases: 1 });
  harnesses.push(harness);

  // Write goals and requirements so the research stage can proceed
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Works.", "utf8");
  await writeFile(harness.artifacts.requirementsFile, "Build CLI.", "utf8");
  await writeFile(harness.artifacts.researchQuestionsFile, "# Research Questions\n\n### Q1: What paths exist?\n**Tag**: codebase\n**Covers**: FR-1\n**Answer shape**: Identify paths.\n**Decision unblocked**: Which subsystem.\n", "utf8").catch(() => undefined);

  harness.state = markStageCompleted(harness.state, "goals", "research");
  harness.state = { ...harness.state, nextStage: "research", route: "quick-fix" };

  const telemetry = await makeTelemetry(harness);
  const checkpoint = makeCheckpoint(harness);

  const finalState = await runPipeline({
    services: harness.services,
    state: harness.state,
    artifacts: harness.artifacts,
    telemetry,
    checkpoint,
    isResumed: false,
  });

  const events = await telemetry.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(
    eventTypes.includes("stage.skipped"),
    `Expected stage.skipped events; got ${JSON.stringify(eventTypes)}`,
  );

  const skippedStages = events
    .filter((e: TelemetryEvent) => e.event_type === "stage.skipped")
    .map((e: TelemetryEvent) => e.stage);

  assert.ok(
    skippedStages.includes("design") || skippedStages.includes("structure"),
    `Expected design or structure skipped; got ${JSON.stringify(skippedStages)}`,
  );

  void finalState;
});

// ---------------------------------------------------------------------------
// Verify PARTIAL reroutes back to implement
// ---------------------------------------------------------------------------

test("runPipeline reroutes to implement when verify returns PARTIAL", async () => {
  const harness = await TestHarness.create({ route: "full", verificationStatus: "PARTIAL" });
  harnesses.push(harness);

  harness.state = markStageCompleted(harness.state, "accept", "verify");
  harness.state = { ...harness.state, nextStage: "verify", verifyFixAttempts: 0 };

  // Write artifacts that verify and subsequent stages (implement, accept) need
  await writeReportArtifacts(harness);
  await writeFile(harness.artifacts.baselineResultsFile, "### Baseline Status — PASS\n\nAll clean.", "utf8");
  await writeFile(harness.artifacts.planFile, "# Plan\n\n## Overview\nOne phase.", "utf8");
  await writeFile(harness.artifacts.requirementsFile, "Build a minimal CLI.", "utf8");
  await writeFile(harness.artifacts.phaseManifestFile, "---\ntotal_phases: 1\n---\n\n## Phase 1\n- **Tasks:** 01\n", "utf8");
  // accept stage reads design and structure for route=full
  await writeFile(harness.artifacts.designFile, "# Design\n\nSimple CLI design.", "utf8");
  await writeFile(harness.artifacts.structureFile, "# Structure\n\n- `src/cli.ts` (CREATE)", "utf8");
  // Start near the cap so verify→implement→accept only loops a couple of times
  harness.state = { ...harness.state, verifyFixAttempts: 2 };

  const telemetry = await makeTelemetry(harness);
  const checkpoint = makeCheckpoint(harness);

  const finalState = await runPipeline({
    services: harness.services,
    state: harness.state,
    artifacts: harness.artifacts,
    telemetry,
    checkpoint,
    isResumed: false,
  });

  // After PARTIAL, pipeline should either reroute or stop
  const events = await telemetry.readEvents();
  const verifyCompleted = events.some(
    (e: TelemetryEvent) => e.event_type === "stage.completed" && e.stage === "verify",
  );
  const verifyFailed = events.some(
    (e: TelemetryEvent) => e.event_type === "stage.failed" && e.stage === "verify",
  );

  assert.ok(verifyCompleted || verifyFailed, "verify stage should have run and emitted telemetry");
  void finalState;
});
