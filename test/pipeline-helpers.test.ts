import test from "node:test";
import assert from "node:assert/strict";
import {
  getDryRunArtifactPaths,
  generateRunId,
  getPipelineDir,
  getGitBranch,
  getRouteStages,
  getStatePath,
  getTelemetryDir,
  getEventsPath,
  getRunLogPath,
  getMetricsPath,
  makeInitialState,
  makeTelemetryEvent,
  STAGE_NAMES,
  stageNumber,
  nextStage,
} from "../src/pipeline";

// ---------------------------------------------------------------------------
// generateRunId
// ---------------------------------------------------------------------------

test("generateRunId returns a string matching qrspi-YYYYMMDD-HHMMSS format", () => {
  const id = generateRunId();
  assert.ok(
    /^qrspi-\d{8}-\d{6}$/.test(id),
    `Expected format qrspi-YYYYMMDD-HHMMSS, got: ${id}`,
  );
});

test("generateRunId date portion is a valid UTC date", () => {
  const id = generateRunId();
  const match = id.match(/^qrspi-(\d{8})-(\d{6})$/);
  const dateStr = match![1]!;
  const Y = parseInt(dateStr.slice(0, 4), 10);
  const M = parseInt(dateStr.slice(4, 6), 10);
  const D = parseInt(dateStr.slice(6, 8), 10);
  assert.ok(Y >= 2025 && Y <= 2100, `Year ${Y} out of range`);
  assert.ok(M >= 1 && M <= 12, `Month ${M} out of range`);
  assert.ok(D >= 1 && D <= 31, `Day ${D} out of range`);
});

test("generateRunId time portion is valid 24-hour time 000000-235959", () => {
  const id = generateRunId();
  const match = id.match(/^qrspi-(\d{8})-(\d{6})$/);
  const timeStr = match![2]!;
  const hh = parseInt(timeStr.slice(0, 2), 10);
  const mm = parseInt(timeStr.slice(2, 4), 10);
  const ss = parseInt(timeStr.slice(4, 6), 10);
  assert.ok(hh >= 0 && hh <= 23, `Hours ${hh} out of range`);
  assert.ok(mm >= 0 && mm <= 59, `Minutes ${mm} out of range`);
  assert.ok(ss >= 0 && ss <= 59, `Seconds ${ss} out of range`);
  const totalSeconds = hh * 3600 + mm * 60 + ss;
  assert.ok(totalSeconds >= 0 && totalSeconds <= 23 * 3600 + 59 * 60 + 59);
});

test("generateRunId called twice in same second returns identical values", () => {
  const id1 = generateRunId();
  const id2 = generateRunId();
  assert.equal(id1, id2);
});

test("generateRunId across a second boundary returns different IDs", (t, done) => {
  const id1 = generateRunId();
  setTimeout(() => {
    const id2 = generateRunId();
    assert.notEqual(id1, id2);
    done();
  }, 1100);
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

test("getPipelineDir returns .pipeline/<runId>", () => {
  assert.equal(
    getPipelineDir("qrspi-20260515-143022"),
    ".pipeline/qrspi-20260515-143022",
  );
});

test("getGitBranch returns qrspi/<runId>", () => {
  assert.equal(
    getGitBranch("qrspi-20260515-143022"),
    "qrspi/qrspi-20260515-143022",
  );
});

test("getStatePath returns .pipeline/<runId>/state.md", () => {
  assert.equal(
    getStatePath("qrspi-20260515-143022"),
    ".pipeline/qrspi-20260515-143022/state.md",
  );
});

test("getTelemetryDir returns .pipeline/<runId>/telemetry", () => {
  assert.equal(
    getTelemetryDir("qrspi-20260515-143022"),
    ".pipeline/qrspi-20260515-143022/telemetry",
  );
});

test("getEventsPath returns .pipeline/<runId>/telemetry/events.jsonl", () => {
  assert.equal(
    getEventsPath("qrspi-20260515-143022"),
    ".pipeline/qrspi-20260515-143022/telemetry/events.jsonl",
  );
});

test("getRunLogPath returns .pipeline/<runId>/telemetry/run-log.md", () => {
  assert.equal(
    getRunLogPath("qrspi-20260515-143022"),
    ".pipeline/qrspi-20260515-143022/telemetry/run-log.md",
  );
});

test("getMetricsPath returns .pipeline/<runId>/telemetry/metrics-summary.md", () => {
  assert.equal(
    getMetricsPath("qrspi-20260515-143022"),
    ".pipeline/qrspi-20260515-143022/telemetry/metrics-summary.md",
  );
});

// ---------------------------------------------------------------------------
// makeInitialState
// ---------------------------------------------------------------------------

test("makeInitialState returns object with all 13 required fields", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  const keys = Object.keys(state).sort();
  const expected = [
    "backward_loops",
    "current_phase",
    "failure_policy",
    "interaction_mode",
    "last_completed_stage",
    "mode",
    "next_stage",
    "phase_history",
    "resume_source",
    "route",
    "run_id",
    "stages_completed",
    "total_phases",
  ].sort();
  assert.deepEqual(keys, expected);
});

test("makeInitialState run_id matches input", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.run_id, "qrspi-20260515-143022");
});

test("makeInitialState route is empty string", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.route, "");
});

test("makeInitialState current_phase is 1", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.current_phase, 1);
});

test("makeInitialState total_phases is 0", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.total_phases, 0);
});

test("makeInitialState last_completed_stage is '0'", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.last_completed_stage, "0");
});

test("makeInitialState next_stage is '1'", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.next_stage, "1");
});

test("makeInitialState stages_completed is empty array", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.deepEqual(state.stages_completed, []);
});

test("makeInitialState phase_history is empty array", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.deepEqual(state.phase_history, []);
});

test("makeInitialState backward_loops is 0", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.backward_loops, 0);
});

test("makeInitialState resume_source is 'fresh'", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.resume_source, "fresh");
});

test("makeInitialState mode defaults to 'live'", () => {
  const state = makeInitialState("qrspi-20260515-143022");
  assert.equal(state.mode, "live");
});

// ---------------------------------------------------------------------------
// makeTelemetryEvent
// ---------------------------------------------------------------------------

test("makeTelemetryEvent returns all required envelope fields", () => {
  const event = makeTelemetryEvent("qrspi-20260515-143022", "run.started", {});
  assert.ok(
    typeof event.schema_version === "string" && event.schema_version.length > 0,
  );
  assert.ok(typeof event.event_id === "string" && event.event_id.length > 0);
  assert.equal(event.sequence, 0);
  assert.ok(typeof event.ts === "string");
  assert.ok(!isNaN(new Date(event.ts).getTime()));
  assert.equal(event.run_id, "qrspi-20260515-143022");
  assert.equal(event.writer_agent, "orchestrator");
  assert.equal(event.writer_scope, "pipeline");
  assert.equal(event.event_type, "run.started");
  assert.equal(event.status, "PASS");
  assert.equal(event.route, "");
  assert.equal(event.summary, "");
});

test("makeTelemetryEvent default sequence is 0", () => {
  const event = makeTelemetryEvent("qrspi-test", "test.event", {});
  assert.equal(event.sequence, 0);
});

test("makeTelemetryEvent sequence can be overridden via overrides", () => {
  const event = makeTelemetryEvent("qrspi-test", "test.event", {
    sequence: 42,
  });
  assert.equal(event.sequence, 42);
});

test("makeTelemetryEvent overrides merge into returned object", () => {
  const event = makeTelemetryEvent("qrspi-xxx", "stage.completed", {
    status: "FAIL" as const,
    stage: 1,
    summary: "Stage 1 failed",
  });
  assert.equal(event.status, "FAIL");
  assert.equal(event.stage, 1);
  assert.equal(event.summary, "Stage 1 failed");
  assert.equal(event.event_type, "stage.completed");
  assert.equal(event.run_id, "qrspi-xxx");
});

test("makeTelemetryEvent overrides do not leak to subsequent calls", () => {
  const ev1 = makeTelemetryEvent("qrspi-test", "ev.a", {
    status: "FAIL" as const,
    summary: "Bad",
  });
  const ev2 = makeTelemetryEvent("qrspi-test", "ev.b", {});
  assert.equal(ev2.status, "PASS");
  assert.equal(ev2.summary, "");
  assert.equal(ev1.status, "FAIL");
  assert.equal(ev1.summary, "Bad");
});

// ---------------------------------------------------------------------------
// STAGE_NAMES
// ---------------------------------------------------------------------------

test("STAGE_NAMES contains the 10 executable stages", () => {
  assert.ok(STAGE_NAMES.length >= 10);
  assert.equal(STAGE_NAMES.length, 10);
});

test("STAGE_NAMES index 0 (Stage 1) is 'goals'", () => {
  assert.equal(STAGE_NAMES[0], "goals");
});

test("STAGE_NAMES last entry is 'report'", () => {
  assert.equal(STAGE_NAMES[STAGE_NAMES.length - 1], "report");
});

test("getRouteStages('full') returns the canonical full stage list", () => {
  assert.deepEqual(getRouteStages("full"), STAGE_NAMES);
});

test("getRouteStages('quick-fix') returns the quick-fix stage list", () => {
  assert.deepEqual(getRouteStages("quick-fix"), [
    "goals",
    "research",
    "plan",
    "implement",
    "accept",
    "verify",
    "report",
  ]);
});

test("getDryRunArtifactPaths('full') includes full-route artifacts", () => {
  const artifacts = getDryRunArtifactPaths("qrspi-20260515-143022", "full");
  assert.ok(artifacts.includes(".pipeline/qrspi-20260515-143022/design.md"));
  assert.ok(artifacts.includes(".pipeline/qrspi-20260515-143022/structure.md"));
  assert.ok(
    artifacts.includes(
      ".pipeline/qrspi-20260515-143022/phases/phase-01/replan/phase-01-replan.md",
    ),
  );
  assert.ok(
    artifacts.includes(
      ".pipeline/qrspi-20260515-143022/telemetry/metrics-summary.md",
    ),
  );
});

test("getDryRunArtifactPaths('quick-fix') omits skipped-stage artifacts", () => {
  const artifacts = getDryRunArtifactPaths(
    "qrspi-20260515-143022",
    "quick-fix",
  );
  assert.equal(
    artifacts.includes(".pipeline/qrspi-20260515-143022/design.md"),
    false,
  );
  assert.equal(
    artifacts.includes(".pipeline/qrspi-20260515-143022/structure.md"),
    false,
  );
  assert.equal(
    artifacts.includes(
      ".pipeline/qrspi-20260515-143022/phases/phase-01/replan/phase-01-replan.md",
    ),
    false,
  );
  assert.ok(artifacts.includes(".pipeline/qrspi-20260515-143022/plan.md"));
  assert.ok(
    artifacts.includes(".pipeline/qrspi-20260515-143022/telemetry/run-log.md"),
  );
});

// ---------------------------------------------------------------------------
// stageNumber
// ---------------------------------------------------------------------------

test("stageNumber('goals') returns 1", () => {
  assert.equal(stageNumber("goals"), 1);
});

test("stageNumber('research') returns 2", () => {
  assert.equal(stageNumber("research"), 2);
});

test("stageNumber('report') returns 10", () => {
  assert.equal(stageNumber("report"), 10);
});

test("stageNumber of unrecognized stage name returns 0", () => {
  assert.equal(stageNumber("nonexistent"), 0);
});

test("stageNumber('') returns 0", () => {
  assert.equal(stageNumber(""), 0);
});

// ---------------------------------------------------------------------------
// nextStage — full route
// ---------------------------------------------------------------------------

test("nextStage('goals', 'full') returns 'research'", () => {
  assert.equal(nextStage("goals", "full"), "research");
});

test("nextStage('report', 'full') returns null", () => {
  assert.equal(nextStage("report", "full"), null);
});

test("nextStage walks all full-route transitions correctly", () => {
  const fullOrder = [
    "goals",
    "research",
    "design",
    "structure",
    "plan",
    "implement",
    "accept",
    "replan",
    "verify",
    "report",
  ];
  for (let i = 0; i < fullOrder.length - 1; i++) {
    assert.equal(
      nextStage(fullOrder[i]!, "full"),
      fullOrder[i + 1]!,
      `nextStage("${fullOrder[i]}", "full") should be "${fullOrder[i + 1]}"`,
    );
  }
  assert.equal(nextStage("report", "full"), null);
});

test("nextStage('', 'full') returns null", () => {
  assert.equal(nextStage("", "full"), null);
});

// ---------------------------------------------------------------------------
// nextStage — quick-fix route
// ---------------------------------------------------------------------------

test("nextStage quick-fix: 'goals' → 'research'", () => {
  assert.equal(nextStage("goals", "quick-fix"), "research");
});

test("nextStage quick-fix: 'research' → 'plan' (skips design, structure)", () => {
  assert.equal(nextStage("research", "quick-fix"), "plan");
});

test("nextStage quick-fix: 'implement' → 'accept' (skips replan)", () => {
  assert.equal(nextStage("implement", "quick-fix"), "accept");
});

test("nextStage quick-fix: 'report' → null", () => {
  assert.equal(nextStage("report", "quick-fix"), null);
});

test("nextStage quick-fix: 'design' returns null (skipped stage)", () => {
  assert.equal(nextStage("design", "quick-fix"), null);
});

test("nextStage quick-fix: 'structure' returns null (skipped stage)", () => {
  assert.equal(nextStage("structure", "quick-fix"), null);
});

test("nextStage('', 'quick-fix') returns null", () => {
  assert.equal(nextStage("", "quick-fix"), null);
});
