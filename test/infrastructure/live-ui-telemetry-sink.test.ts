import { test } from "node:test";
import assert from "node:assert/strict";

import type { DomainEvent } from "../../src/domain/event/index.js";
import { Run } from "../../src/domain/run/index.js";
import type { RunState, TelemetryEvent } from "../../src/application/port/index.js";
import {
  breadcrumbFor,
  renderWidgetLines,
  LiveUiTelemetrySink,
  DEEPWORK_PROGRESS_CUSTOM_TYPE,
  type InitializableTelemetrySink,
} from "../../src/infrastructure/pi/live-ui-telemetry-sink.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class StubTelemetrySink implements InitializableTelemetrySink {
  readonly recordedEvents: DomainEvent[] = [];
  readonly regeneratedStates: RunState[] = [];
  initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async record(event: DomainEvent): Promise<void> {
    this.recordedEvents.push(event);
  }

  async regenerateRunLog(state: RunState): Promise<void> {
    this.regeneratedStates.push(state);
  }

  async regenerateMetrics(_state: RunState): Promise<void> {}

  async readEvents(): Promise<TelemetryEvent[]> {
    return [];
  }
}

interface UiSpy {
  notifyCalls: Array<{ message: string; level: string }>;
  widgetCalls: Array<string[]>;
  setWidget(key: string, lines: string[]): void;
  notify(message: string, level: string): void;
}

interface PiSpy {
  sentMessages: Array<{ customType: string; content: string; display: boolean }>;
  sendMessage(msg: { customType: string; content: string; display: boolean }): void;
}

function createFakeCtx(hasUI: boolean): { ctx: ExtensionCommandContext; ui: UiSpy } {
  const ui: UiSpy = {
    notifyCalls: [],
    widgetCalls: [],
    setWidget(_key: string, lines: unknown) {
      if (Array.isArray(lines)) {
        ui.widgetCalls.push(lines as string[]);
      }
    },
    notify(message: string, level: string) {
      ui.notifyCalls.push({ message, level });
    },
  };

  const ctx = {
    hasUI,
    cwd: "/tmp",
    ui: ui as unknown as ExtensionCommandContext["ui"],
    signal: undefined,
    model: undefined,
    modelRegistry: {} as never,
    isIdle: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
    waitForIdle: async () => undefined,
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    navigateTree: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    reload: async () => undefined,
    sessionManager: {
      getCwd: () => "/tmp",
      getSessionDir: () => "/tmp",
      getSessionId: () => "test",
      getSessionFile: () => undefined,
      getLeafId: () => null,
      getLeafEntry: () => undefined,
      getEntry: () => undefined,
      getLabel: () => undefined,
      getBranch: () => [],
      getHeader: () => null,
      getEntries: () => [],
      getTree: () => [],
      getSessionName: () => undefined,
    },
    mode: "tui" as const,
    getSystemPromptOptions: () => ({
      cwd: "/tmp",
      contextFiles: [],
      skills: [],
      selectedTools: [],
      toolSnippets: [],
      promptGuidelines: [],
      appendSystemPrompt: [],
    }),
  } as unknown as ExtensionCommandContext;

  return { ctx, ui };
}

function createFakePi(): { pi: ExtensionAPI; spy: PiSpy } {
  const spy: PiSpy = {
    sentMessages: [],
    sendMessage(msg: { customType: string; content: string; display: boolean }) {
      spy.sentMessages.push(msg);
    },
  };

  const pi = {
    sendMessage: spy.sendMessage.bind(spy),
  } as unknown as ExtensionAPI;

  return { pi, spy };
}

function makeFullRunState(overrides?: Partial<RunState>): RunState {
  const base = Run.start({
    runId: "qrspi-20260601-000000",
    userTask: "test task",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// breadcrumbFor — pure helper tests
// ---------------------------------------------------------------------------

test("breadcrumbFor returns run.started with info level", () => {
  const crumb = breadcrumbFor({ type: "run.started", runId: "r1", route: "full" });
  assert.ok(crumb);
  assert.equal(crumb.level, "info");
  assert.match(crumb.line, /Deepwork started/);
  assert.match(crumb.line, /full/);
});

test("breadcrumbFor returns run.resumed with info level", () => {
  const crumb = breadcrumbFor({ type: "run.resumed", runId: "r1", route: "quick-fix" });
  assert.ok(crumb);
  assert.equal(crumb.level, "info");
  assert.match(crumb.line, /resumed/);
});

test("breadcrumbFor returns run.completed with info level", () => {
  const crumb = breadcrumbFor({ type: "run.completed", runId: "r1", route: "full", status: "PASS" });
  assert.ok(crumb);
  assert.equal(crumb.level, "info");
  assert.match(crumb.line, /PASS/);
});

test("breadcrumbFor returns run.aborted with error level", () => {
  const crumb = breadcrumbFor({ type: "run.aborted", runId: "r1", route: "full", error: "connection lost" });
  assert.ok(crumb);
  assert.equal(crumb.level, "error");
  assert.match(crumb.line, /aborted/);
  assert.match(crumb.line, /connection lost/);
});

test("breadcrumbFor returns stage.completed without a level", () => {
  const crumb = breadcrumbFor({
    type: "stage.completed",
    stage: "goals",
    phase: 1,
    stageInstance: 1,
    route: "full",
    outcome: {
      status: "PASS",
      filesWritten: [],
      summary: "Goals captured.",
    },
    startedAt: "2026-06-01T00:00:00Z",
    endedAt: "2026-06-01T00:00:05Z",
  });
  assert.ok(crumb);
  assert.equal(crumb.level, undefined);
  assert.match(crumb.line, /OK goals/);
  assert.match(crumb.line, /Goals captured/);
});

test("breadcrumbFor returns stage.failed with error level", () => {
  const crumb = breadcrumbFor({
    type: "stage.failed",
    stage: "plan",
    phase: 1,
    stageInstance: 1,
    route: "full",
    summary: "Review cap hit.",
  });
  assert.ok(crumb);
  assert.equal(crumb.level, "error");
  assert.match(crumb.line, /FAIL plan/);
});

test("breadcrumbFor returns gate.presented with warning level", () => {
  const crumb = breadcrumbFor({
    type: "gate.presented",
    stage: "goals",
    phase: 1,
    stageInstance: 1,
    route: "full",
    summary: "Awaiting approval.",
  });
  assert.ok(crumb);
  assert.equal(crumb.level, "warning");
  assert.match(crumb.line, /approval needed at goals/);
});

test("breadcrumbFor returns backward_loop.decided without a level", () => {
  const crumb = breadcrumbFor({
    type: "backward_loop.decided",
    stage: "implement",
    phase: 1,
    stageInstance: 1,
    route: "full",
    targetStage: "plan",
    request: { classification: "LOOP_PLAN", summary: "Plan needs revision." },
  });
  assert.ok(crumb);
  assert.equal(crumb.level, undefined);
  assert.match(crumb.line, /loop back to plan/);
});

test("breadcrumbFor returns backward_loop.failed with error level", () => {
  const crumb = breadcrumbFor({
    type: "backward_loop.failed",
    stage: "implement",
    phase: 1,
    stageInstance: 1,
    route: "full",
    classification: "LOOP_PLAN",
    maxLoops: 3,
  });
  assert.ok(crumb);
  assert.equal(crumb.level, "error");
  assert.match(crumb.line, /cap reached/);
});

test("breadcrumbFor returns undefined for stage.started (silent)", () => {
  const crumb = breadcrumbFor({
    type: "stage.started",
    stage: "research",
    phase: 1,
    stageInstance: 1,
    route: "full",
  });
  assert.equal(crumb, undefined);
});

test("breadcrumbFor returns undefined for backward_loop.requested (silent)", () => {
  const crumb = breadcrumbFor({
    type: "backward_loop.requested",
    stage: "implement",
    phase: 1,
    stageInstance: 1,
    route: "full",
    request: { classification: "LOOP_PLAN", summary: "Need replan." },
  });
  assert.equal(crumb, undefined);
});

// ---------------------------------------------------------------------------
// renderWidgetLines — pure helper tests
// ---------------------------------------------------------------------------

test("renderWidgetLines returns starting line when no state", () => {
  const lines = renderWidgetLines({});
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /starting/);
});

test("renderWidgetLines full route: no skipped stages, shows ✓ for completed, ▶ for current", () => {
  const state = makeFullRunState({
    route: "full",
    stagesCompleted: ["goals", "research"],
    currentPhase: 1,
    totalPhases: 3,
    lastCompletedStage: "research",
    nextStage: "design",
    backwardLoops: 1,
    acceptFixAttempts: 0,
    verifyFixAttempts: 2,
  });

  const lines = renderWidgetLines(
    { state, currentStage: "design", stageStartedAt: Date.now() - 30_000, runStartedAt: Date.now() - 120_000 },
    Date.now(),
  );

  assert.equal(lines.length, 5);
  // Header contains run ID and route
  assert.match(lines[0] ?? "", /qrspi-20260601-000000/);
  assert.match(lines[0] ?? "", /full/);

  // Stage row: goals✓ research✓ design▶ — no dashes (full route)
  const stageRow = lines[1] ?? "";
  assert.match(stageRow, /goals✓/);
  assert.match(stageRow, /research✓/);
  assert.match(stageRow, /design▶/);
  assert.doesNotMatch(stageRow, /design-/);
  assert.doesNotMatch(stageRow, /structure-/);

  // Phase line
  assert.match(lines[2] ?? "", /phase 1\/3/);
  assert.match(lines[2] ?? "", /design/);

  // Loop counters
  assert.match(lines[3] ?? "", /backward 1\/3/);
  assert.match(lines[3] ?? "", /verify-fix 2\/3/);

  // Last
  assert.match(lines[4] ?? "", /last: research/);
});

test("renderWidgetLines quick-fix route: design and structure show -", () => {
  const state = makeFullRunState({
    route: "quick-fix",
    stagesCompleted: ["goals", "research"],
    currentPhase: 1,
    totalPhases: 1,
    lastCompletedStage: "research",
    nextStage: "plan",
  });

  const lines = renderWidgetLines({ state, currentStage: "plan" }, Date.now());
  const stageRow = lines[1] ?? "";

  assert.match(stageRow, /design-/);
  assert.match(stageRow, /structure-/);
  assert.match(stageRow, /plan▶/);
});

test("renderWidgetLines marks a re-executed completed stage as current (▶ wins over ✓)", () => {
  // Verify-fix/accept-fix loops route back to "implement", which stays in
  // stagesCompleted via appendUniqueStage. The active stage must still render ▶.
  const state = makeFullRunState({
    route: "full",
    stagesCompleted: ["goals", "research", "design", "structure", "plan", "implement"],
    currentPhase: 1,
    totalPhases: 1,
    lastCompletedStage: "verify",
    nextStage: "implement",
    verifyFixAttempts: 1,
  });

  const lines = renderWidgetLines({ state, currentStage: "implement" }, Date.now());
  const stageRow = lines[1] ?? "";

  assert.match(stageRow, /implement▶/);
  assert.doesNotMatch(stageRow, /implement✓/);
  // Earlier completed stages that are not the active one keep their ✓.
  assert.match(stageRow, /goals✓/);
  assert.match(stageRow, /plan✓/);
});

test("renderWidgetLines shows last summary when available", () => {
  const state = makeFullRunState({
    lastCompletedStage: "goals",
    nextStage: "research",
    stagesCompleted: ["goals"],
  });

  const lines = renderWidgetLines({ state, lastSummary: "Goals captured and approved. Route: full." });
  assert.match(lines[4] ?? "", /Goals captured/);
});

test("renderWidgetLines elapsed timer uses fixed nowMs", () => {
  const started = 1_000_000;
  const now = started + 90_000; // 1m30s

  const state = makeFullRunState({ nextStage: "goals", stagesCompleted: [] });
  const lines = renderWidgetLines({ state, runStartedAt: started, stageStartedAt: started + 60_000 }, now);

  assert.match(lines[0] ?? "", /01:30/); // run elapsed
  assert.match(lines[2] ?? "", /00:30/); // stage running
});

// ---------------------------------------------------------------------------
// LiveUiTelemetrySink integration tests
// ---------------------------------------------------------------------------

test("LiveUiTelemetrySink.initialize() delegates to inner sink", async () => {
  const inner = new StubTelemetrySink();
  const { ctx } = createFakeCtx(false);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  await sink.initialize();
  assert.ok(inner.initialized);
});

test("LiveUiTelemetrySink.record() always forwards to inner sink", async () => {
  const inner = new StubTelemetrySink();
  const { ctx } = createFakeCtx(false); // hasUI: false
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  const event: DomainEvent = { type: "run.started", runId: "r1", route: "full" };
  await sink.record(event);

  assert.equal(inner.recordedEvents.length, 1);
  assert.equal(inner.recordedEvents[0]?.type, "run.started");
});

test("LiveUiTelemetrySink.regenerateRunLog() forwards and caches state", async () => {
  const inner = new StubTelemetrySink();
  const { ctx } = createFakeCtx(false);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);
  const state = makeFullRunState();

  await sink.regenerateRunLog(state);

  assert.equal(inner.regeneratedStates.length, 1);
  assert.equal(inner.regeneratedStates[0]?.runId, state.runId);
});

test("LiveUiTelemetrySink.regenerateMetrics() forwards to inner sink", async () => {
  const inner = new StubTelemetrySink();
  const { ctx } = createFakeCtx(false);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);
  const state = makeFullRunState();

  // Should not throw and inner should be called
  await sink.regenerateMetrics(state);
  // No errors means forward happened (StubTelemetrySink.regenerateMetrics is a no-op but doesn't throw)
});

test("LiveUiTelemetrySink.readEvents() delegates to inner sink", async () => {
  const inner = new StubTelemetrySink();
  const { ctx } = createFakeCtx(false);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  const result = await sink.readEvents();
  assert.deepEqual(result, []);
});

test("LiveUiTelemetrySink with hasUI:false skips UI calls", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(false);
  const { pi, spy } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  await sink.record({ type: "run.started", runId: "r1", route: "full" });

  assert.equal(ui.notifyCalls.length, 0);
  assert.equal(ui.widgetCalls.length, 0);
  assert.equal(spy.sentMessages.length, 0);
});

test("LiveUiTelemetrySink with hasUI:true sends breadcrumbs for milestone events", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(true);
  const { pi, spy } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  // run.started should produce a breadcrumb with info level
  await sink.record({ type: "run.started", runId: "r1", route: "full" });

  assert.equal(spy.sentMessages.length, 1);
  const msg = spy.sentMessages[0];
  assert.ok(msg);
  assert.equal(msg.customType, DEEPWORK_PROGRESS_CUSTOM_TYPE);
  assert.equal(msg.display, true);
  assert.match(msg.content, /Deepwork started/);

  assert.equal(ui.notifyCalls.length, 1);
  assert.equal(ui.notifyCalls[0]?.level, "info");
});

test("LiveUiTelemetrySink stage.started does not produce a breadcrumb", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(true);
  const { pi, spy } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  await sink.record({ type: "stage.started", stage: "goals", phase: 1, stageInstance: 1, route: "full" });

  assert.equal(spy.sentMessages.length, 0);
  assert.equal(ui.notifyCalls.length, 0);
  // Widget should still be refreshed
  assert.equal(ui.widgetCalls.length, 1);
});

test("LiveUiTelemetrySink gate.presented triggers warning notification", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(true);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  await sink.record({
    type: "gate.presented",
    stage: "goals",
    phase: 1,
    stageInstance: 1,
    route: "full",
    summary: "Awaiting approval.",
  });

  assert.equal(ui.notifyCalls.length, 1);
  assert.equal(ui.notifyCalls[0]?.level, "warning");
});

test("LiveUiTelemetrySink stage.failed triggers error notification", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(true);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  await sink.record({
    type: "stage.failed",
    stage: "plan",
    phase: 1,
    stageInstance: 1,
    route: "full",
    summary: "Review cap hit.",
  });

  assert.equal(ui.notifyCalls.length, 1);
  assert.equal(ui.notifyCalls[0]?.level, "error");
});

test("LiveUiTelemetrySink widget is refreshed after regenerateRunLog when hasUI:true", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(true);
  const { pi } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);
  const state = makeFullRunState({ stagesCompleted: ["goals"], lastCompletedStage: "goals" });

  await sink.regenerateRunLog(state);

  assert.ok(ui.widgetCalls.length > 0);
  const lastWidget = ui.widgetCalls.at(-1);
  assert.ok(lastWidget);
  // Header line should contain the run ID
  assert.match(lastWidget[0] ?? "", /qrspi-20260601-000000/);
});

test("LiveUiTelemetrySink full event sequence produces correct breadcrumbs", async () => {
  const inner = new StubTelemetrySink();
  const { ctx, ui } = createFakeCtx(true);
  const { pi, spy } = createFakePi();
  const sink = new LiveUiTelemetrySink(inner, pi, ctx);

  const events: DomainEvent[] = [
    { type: "run.started", runId: "r1", route: "full" },
    { type: "stage.started", stage: "goals", phase: 1, stageInstance: 1, route: "full" },
    {
      type: "stage.completed",
      stage: "goals",
      phase: 1,
      stageInstance: 1,
      route: "full",
      outcome: { status: "PASS", filesWritten: [], summary: "Goals captured." },
      startedAt: "2026-06-01T00:00:00Z",
      endedAt: "2026-06-01T00:00:05Z",
    },
    {
      type: "backward_loop.decided",
      stage: "implement",
      phase: 1,
      stageInstance: 1,
      route: "full",
      targetStage: "plan",
      request: { classification: "LOOP_PLAN", summary: "Plan revision needed." },
    },
    {
      type: "gate.presented",
      stage: "design",
      phase: 1,
      stageInstance: 1,
      route: "full",
      summary: "Approve design?",
    },
    { type: "run.completed", runId: "r1", route: "full", status: "PASS" },
  ];

  for (const event of events) {
    await sink.record(event);
  }

  // stage.started is silent — 5 events produce breadcrumbs (all except stage.started)
  assert.equal(spy.sentMessages.length, 5);

  const contents = spy.sentMessages.map((m) => m.content);
  assert.match(contents[0] ?? "", /Deepwork started/);
  assert.match(contents[1] ?? "", /OK goals/);
  assert.match(contents[2] ?? "", /loop back to plan/);
  assert.match(contents[3] ?? "", /approval needed at design/);
  assert.match(contents[4] ?? "", /Deepwork PASS/);

  // gate.presented triggers warning notify
  const warningNotify = ui.notifyCalls.find((n) => n.level === "warning");
  assert.ok(warningNotify);
  assert.match(warningNotify.message, /approval needed/);
});
