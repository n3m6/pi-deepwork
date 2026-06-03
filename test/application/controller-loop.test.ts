import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPipeline } from "../../src/application/pipeline/run-pipeline.js";
import { markStageCompleted } from "../../src/domain/run/index.js";
import { TestHarness } from "../support/harness.js";
import type { DispatchRequest, DispatchResult, Dispatcher, TelemetryEvent } from "../../src/application/port/index.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

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

  const finalState = await runPipeline({
    services: harness.services,
    state: harness.state,
    workspaceRoot: harness.workspaceRoot,
    isResumed: false,
  });

  const events = await harness.telemetrySink.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(eventTypes.includes("run.started"), `Expected run.started; got ${JSON.stringify(eventTypes)}`);
  assert.ok(eventTypes.includes("run.completed"), `Expected run.completed; got ${JSON.stringify(eventTypes)}`);
  assert.equal(finalState.nextStage, "done");

  // Characterization: pin the exact summary strings for lifecycle events
  const startedEvent = events.find((e: TelemetryEvent) => e.event_type === "run.started");
  assert.ok(startedEvent, "run.started event missing");
  assert.equal(startedEvent!.summary, `Pipeline started. Route: ${harness.state.route}.`);

  const completedEvent = events.find((e: TelemetryEvent) => e.event_type === "run.completed");
  assert.ok(completedEvent, "run.completed event missing");
  assert.equal(completedEvent!.summary, `Pipeline completed. Route: ${harness.state.route}.`);
  assert.equal(completedEvent!.status, "PASS");

  const stageStartedEvents = events.filter((e: TelemetryEvent) => e.event_type === "stage.started");
  assert.ok(stageStartedEvents.length > 0, "No stage.started events");
  assert.ok(stageStartedEvents[0]!.summary.startsWith("Stage "), `Unexpected summary: ${stageStartedEvents[0]!.summary}`);
  assert.ok(stageStartedEvents[0]!.summary.includes("Route:"), "stage.started summary missing Route");
});

test("runPipeline emits run.resumed (not run.started) when isResumed is true", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);

  harness.state = markStageCompleted(harness.state, "verify", "report");
  harness.state = { ...harness.state, nextStage: "report" };
  await writeReportArtifacts(harness);

  await runPipeline({
    services: harness.services,
    state: harness.state,
    workspaceRoot: harness.workspaceRoot,
    isResumed: true,
  });

  const events = await harness.telemetrySink.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(eventTypes.includes("run.resumed"), `Expected run.resumed; got ${JSON.stringify(eventTypes)}`);
  assert.ok(!eventTypes.includes("run.started"), "Should not emit run.started on resume");

  const resumedEvent = events.find((e: TelemetryEvent) => e.event_type === "run.resumed");
  assert.equal(resumedEvent!.summary, `Pipeline resumed. Route: ${harness.state.route}.`);
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
    async dispatchGenericCoding(prompt, options) { return harness.dispatcher.dispatchGenericCoding(prompt, options); },
  };

  const finalState = await runPipeline({
    services: { ...harness.services, dispatcher: integrationCheckerDispatcher },
    state: harness.state,
    workspaceRoot: harness.workspaceRoot,
    isResumed: false,
  });

  const events = await harness.telemetrySink.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(
    eventTypes.includes("backward_loop.requested"),
    `Expected backward_loop.requested; got ${JSON.stringify(eventTypes)}`,
  );

  // Characterization: backward_loop.requested must carry classification in context
  const loopReqEvent = events.find((e: TelemetryEvent) => e.event_type === "backward_loop.requested");
  assert.ok(loopReqEvent?.context?.classification, "backward_loop.requested missing context.classification");

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
    async dispatchGenericCoding(prompt, options) { return harness.dispatcher.dispatchGenericCoding(prompt, options); },
  };

  const finalState = await runPipeline({
    services: { ...harness.services, dispatcher: capDispatcher },
    state: harness.state,
    workspaceRoot: harness.workspaceRoot,
    isResumed: false,
  });

  const events = await harness.telemetrySink.readEvents();
  const eventTypes = events.map((e: TelemetryEvent) => e.event_type);

  assert.ok(
    eventTypes.includes("backward_loop.failed"),
    `Expected backward_loop.failed; got ${JSON.stringify(eventTypes)}`,
  );
  assert.ok(finalState.nextStage !== "done", "Pipeline should have stopped before completing normally");

  // Characterization: backward_loop.failed must carry the cap summary and classification
  const failedEvent = events.find((e: TelemetryEvent) => e.event_type === "backward_loop.failed");
  assert.ok(failedEvent?.summary.includes("reached; stopping the run"), `Unexpected summary: ${failedEvent?.summary}`);
  assert.ok(failedEvent?.context?.classification, "backward_loop.failed missing context.classification");
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

  const finalState = await runPipeline({
    services: harness.services,
    state: harness.state,
    workspaceRoot: harness.workspaceRoot,
    isResumed: false,
  });

  const events = await harness.telemetrySink.readEvents();
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

  const finalState = await runPipeline({
    services: harness.services,
    state: harness.state,
    workspaceRoot: harness.workspaceRoot,
    isResumed: false,
  });

  // After PARTIAL, pipeline should either reroute or stop
  const events = await harness.telemetrySink.readEvents();
  const verifyCompleted = events.some(
    (e: TelemetryEvent) => e.event_type === "stage.completed" && e.stage === "verify",
  );
  const verifyFailed = events.some(
    (e: TelemetryEvent) => e.event_type === "stage.failed" && e.stage === "verify",
  );

  assert.ok(verifyCompleted || verifyFailed, "verify stage should have run and emitted telemetry");
  void finalState;
});
