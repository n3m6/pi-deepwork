import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DomainEvent } from "../../domain/event/index.js";
import type { TelemetrySink } from "../../application/port/index.js";
import type { Route, RunArtifacts, RunState, StageName, TelemetryEvent } from "../../application/port/index.js";

const SCHEMA_VERSION = "1.0";

// ---------------------------------------------------------------------------
// TelemetryRecorder — appends raw TelemetryEvents to the JSONL file.
// ---------------------------------------------------------------------------

export class TelemetryRecorder {
  private sequence = 1;

  constructor(
    private readonly artifacts: RunArtifacts,
    private readonly runId: string,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.artifacts.eventsFile), { recursive: true });
    const events = await this.readEvents();
    this.sequence = events.length + 1;
    if (events.length === 0) {
      await writeFile(this.artifacts.eventsFile, "", "utf8");
    }
  }

  async readEvents(): Promise<TelemetryEvent[]> {
    try {
      const raw = await readFile(this.artifacts.eventsFile, "utf8");
      return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TelemetryEvent);
    } catch {
      return [];
    }
  }

  async append(event: Omit<TelemetryEvent, "schema_version" | "event_id" | "sequence" | "ts" | "run_id" | "writer_agent" | "writer_scope">): Promise<TelemetryEvent> {
    const fullEvent: TelemetryEvent = {
      schema_version: SCHEMA_VERSION,
      event_id: `${this.runId}-${this.sequence}`,
      sequence: this.sequence,
      ts: new Date().toISOString(),
      run_id: this.runId,
      writer_agent: "deepwork",
      writer_scope: "orchestrator",
      ...event,
    };
    this.sequence += 1;

    const line = JSON.stringify(fullEvent);
    const existing = await readSafe(this.artifacts.eventsFile);
    const next = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
    await writeFile(this.artifacts.eventsFile, next, "utf8");
    return fullEvent;
  }

  async regenerateRunLog(state: RunState): Promise<void> {
    const events = await this.readEvents();
    const markdown = renderRunLog(this.runId, state, events);
    await writeFile(this.artifacts.runLogFile, markdown, "utf8");
  }

  async regenerateMetrics(state: RunState): Promise<void> {
    const events = await this.readEvents();
    const markdown = renderMetricsSummary(this.runId, state, events);
    await writeFile(this.artifacts.metricsFile, markdown, "utf8");
  }
}

// ---------------------------------------------------------------------------
// JsonlTelemetrySink — implements the TelemetrySink port with domain-event mapping.
// ---------------------------------------------------------------------------

export class JsonlTelemetrySink implements TelemetrySink {
  constructor(private readonly recorder: TelemetryRecorder) {}

  static create(artifacts: RunArtifacts, runId: string): JsonlTelemetrySink {
    return new JsonlTelemetrySink(new TelemetryRecorder(artifacts, runId));
  }

  async initialize(): Promise<void> {
    await this.recorder.initialize();
  }

  async record(event: DomainEvent): Promise<void> {
    const mapped = domainEventToTelemetryEvent(event);
    if (mapped) {
      await this.recorder.append(mapped);
    }
  }

  async regenerateRunLog(state: RunState): Promise<void> {
    await this.recorder.regenerateRunLog(state);
  }

  async regenerateMetrics(state: RunState): Promise<void> {
    await this.recorder.regenerateMetrics(state);
  }

  async readEvents(): Promise<TelemetryEvent[]> {
    return this.recorder.readEvents();
  }

  /** Direct access to the underlying recorder for migration compat. */
  get raw(): TelemetryRecorder {
    return this.recorder;
  }
}

// ---------------------------------------------------------------------------
// Render functions — produce run-log.md and metrics-summary.md
// ---------------------------------------------------------------------------

export function renderRunLog(runId: string, state: RunState, events: TelemetryEvent[]): string {
  const route = state.route;
  const started = events.find((event) => event.event_type === "run.started")?.ts ?? state.startedAt;
  const finished = [...events]
    .reverse()
    .find((event) => event.event_type === "run.completed" || event.event_type === "run.aborted")?.ts;
  const resumes = events.filter((event) => event.event_type === "run.resumed").length;
  const currentStatus = finished
    ? finished && events.some((event) => event.event_type === "run.aborted")
      ? "aborted"
      : "completed"
    : "in-progress";

  const timelineRows = events.map((event) => {
    const scope = event.stage ? `stage:${event.stage}` : "run";
    const artifacts = event.artifacts && event.artifacts.length > 0 ? event.artifacts.join(", ") : "—";
    return `| ${timeOnly(event.ts)} | ${event.sequence} | ${scope} | ${event.event_type} | ${event.status} | ${event.summary} | ${artifacts} |`;
  });

  const failureRows = events
    .filter((event) => event.event_type.startsWith("backward_loop") || event.event_type === "stage.failed")
    .map((event) => {
      const type = event.event_type.startsWith("backward_loop") ? "backward_loop" : event.event_type;
      const artifact = event.artifacts?.[0] ?? "—";
      return `| ${type} | ${event.stage ?? "—"} | ${event.phase ?? "—"} | ${event.review_round ?? "—"} | ${event.summary} | ${artifact} |`;
    });

  const currentSignal =
    state.nextStage === "done"
      ? "Run complete."
      : `Next stage: ${state.nextStage}${state.currentPhase > 1 ? ` (phase ${state.currentPhase})` : ""}.`;

  return [
    `# Run Log — ${runId}`,
    "",
    "## Run Overview",
    "",
    `- **Run ID:** ${runId}`,
    `- **Route:** ${route}`,
    `- **Status:** ${currentStatus}`,
    `- **Started:** ${started}`,
    `- **Completed / Aborted:** ${finished ?? "—"}`,
    `- **Resume count:** ${resumes}`,
    `- **Stages completed:** ${state.stagesCompleted.length > 0 ? state.stagesCompleted.join(", ") : "—"}`,
    `- **Next stage:** ${state.nextStage}`,
    "",
    "## Current Status",
    "",
    currentSignal,
    "",
    "## Timeline",
    "",
    "| Time (UTC) | Seq | Scope | Event | Status | Summary | Artifacts |",
    "| ---------- | --- | ----- | ----- | ------ | ------- | --------- |",
    ...(timelineRows.length > 0 ? timelineRows : ["| — | — | run | — | — | No events yet. | — |"]),
    "",
    "## Active Phase Snapshot",
    "",
    `- **Current phase:** ${state.currentPhase} of ${Math.max(state.totalPhases, 1)}`,
    `- **Current stage:** ${state.nextStage === "done" ? "done" : state.nextStage}`,
    `- **Waves completed:** ${events.filter((event) => event.stage === "implement" && event.event_type === "stage.completed").length}`,
    `- **Acceptance state:** ${events.some((event) => event.stage === "accept" && event.event_type === "stage.completed") ? "complete" : "pending"}`,
    `- **Outstanding blockers:** ${failureRows.length > 0 ? failureRows.length : "none"}`,
    "",
    "## Failure and Loop Index",
    "",
    "| Type | Stage | Phase | Round | Summary | Artifact |",
    "| ---- | ----- | ----- | ----- | ------- | -------- |",
    ...(failureRows.length > 0 ? failureRows : ["_(Empty when no failures or loops have occurred.)_"]),
    "",
    "## Artifact Index",
    "",
    "- `state.json` — current recovery state",
    "- `config.md` — route and metadata",
    "- `goals.md` — distilled intent",
    "- `plan.md` — current plan",
    "- `phase-manifest.md` — phase breakdown",
    "- `telemetry/events.jsonl` — full event stream",
    "",
  ].join("\n");
}

export function renderMetricsSummary(runId: string, state: RunState, events: TelemetryEvent[]): string {
  const stageDurations = buildStageDurations(events);
  const childCalls = aggregateChildCalls(events);
  const reviewRounds = aggregateReviewRounds(events);
  const gateRows = aggregateGateRows(events);
  const evidenceRows = aggregateEvidence(events);
  const route = state.route === "unknown" ? "full" : state.route;
  const runTerminalEvent = [...events]
    .reverse()
    .find((event) => event.event_type === "run.completed" || event.event_type === "run.aborted");
  const finalStatus =
    runTerminalEvent?.event_type === "run.aborted"
      ? "aborted"
      : state.nextStage !== "done" || runTerminalEvent?.status === "PARTIAL"
        ? "stopped-partial"
        : state.verifyStatus === "FAIL"
          ? "completed-fail"
          : state.verifyStatus === "PARTIAL"
            ? "completed-partial"
            : "completed-pass";
  const started = events.find((event) => event.event_type === "run.started")?.ts ?? state.startedAt;
  const ended = runTerminalEvent?.ts;

  return [
    `# Metrics Summary — ${runId}`,
    "",
    "## Run",
    "",
    `- **Route:** ${route}`,
    `- **Final status:** ${finalStatus}`,
    `- **Total duration:** ${durationSeconds(started, ended)} s`,
    `- **Stages completed:** ${state.stagesCompleted.length} of 10`,
    `- **Resume count:** ${events.filter((event) => event.event_type === "run.resumed").length}`,
    `- **Backward loop count:** ${state.backwardLoops}`,
    "",
    "## Stage Durations",
    "",
    "| Stage | Phase | Duration (s) | Status |",
    "| ----- | ----- | ------------ | ------ |",
    ...stageDurations,
    "",
    "## Child Agent Calls",
    "",
    "| Stage | Child Agent | Calls | Pass | Fail |",
    "| ----- | ----------- | ----- | ---- | ---- |",
    ...(childCalls.length > 0 ? childCalls : ["| — | — | 0 | 0 | 0 |"]),
    "",
    "## Review Rounds",
    "",
    "| Stage | Type | Rounds |",
    "| ----- | ---- | ------ |",
    ...(reviewRounds.length > 0 ? reviewRounds : ["| — | — | 0 |"]),
    "",
    "## Retry and Loop Counts",
    "",
    `- **Stage retries:** ${events.filter((event) => event.event_type === "stage.retried").length}`,
    `- **E2E remediation rounds:** ${countStage(events, "e2e-regression", "stage.retried")}`,
    `- **Regression remediation rounds:** ${countStage(events, "baseline-regression", "stage.retried")}`,
    `- **Acceptance loop rounds:** ${countStage(events, "accept", "stage.retried")}`,
    `- **Review round cap hits:** ${events.filter((event) => event.context?.terminal_review_state === "unclean-cap").length}`,
    `- **Backward loops:** ${state.backwardLoops}`,
    "",
    "## Human Gate Outcomes",
    "",
    "| Stage | Presentations | Rejections | Approvals |",
    "| ----- | ------------- | ---------- | --------- |",
    ...(gateRows.length > 0 ? gateRows : ["| — | 0 | 0 | 0 |"]),
    "",
    "## Test Evidence Quality",
    "",
    "| Phase | Deterministic | Flaky | Harness Noisy | Ambiguous | Redundant | No-Test Tasks | No-Test Audit Overrides |",
    "| ----- | ------------- | ----- | ------------- | --------- | --------- | ------------- | ----------------------- |",
    ...(evidenceRows.length > 0 ? evidenceRows : ["| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |"]),
    "",
    "## Code Health",
    "",
    `- **Coverage status:** ${state.verifyStatus ?? "SKIPPED"}`,
    `- **Plan/Replan terminal review states:** ${collectTerminalStates(events).join(", ") || "none"}`,
    "",
  ].join("\n");
}

export function createRunEventSummary(stage: StageName | undefined, route: Route, verb: string): string {
  return stage ? `Stage ${stage} ${verb}. Route: ${route}.` : `Pipeline ${verb}. Route: ${route}.`;
}

// ---------------------------------------------------------------------------
// Domain event → TelemetryEvent mapping
// ---------------------------------------------------------------------------

type TelemetryEventPartial = Omit<TelemetryEvent, "schema_version" | "event_id" | "sequence" | "ts" | "run_id" | "writer_agent" | "writer_scope">;

function domainEventToTelemetryEvent(event: DomainEvent): TelemetryEventPartial | undefined {
  switch (event.type) {
    case "run.started":
      return { event_type: "run.started", status: "PASS", route: event.route, summary: `Pipeline started. Route: ${event.route}.` };
    case "run.resumed":
      return { event_type: "run.resumed", status: "PASS", route: event.route, summary: `Pipeline resumed. Route: ${event.route}.` };
    case "run.completed":
      return {
        event_type: "run.completed",
        status: event.status,
        route: event.route,
        summary: event.status === "PASS" ? `Pipeline completed. Route: ${event.route}.` : `Pipeline stopped. Route: ${event.route}.`,
      };
    case "run.aborted":
      return {
        event_type: "run.aborted",
        status: "FAIL",
        route: event.route,
        summary: event.error,
        error: { message: event.error },
      };
    case "stage.started":
      return {
        event_type: "stage.started",
        status: "RUNNING",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Stage ${event.stage} started. Route: ${event.route}.`,
      };
    case "stage.completed": {
      const resolvedEventType =
        event.outcome.status === "SKIP" ? "stage.skipped" : event.outcome.status === "FAIL" ? "stage.failed" : "stage.completed";
      return {
        event_type: resolvedEventType,
        status: event.outcome.status,
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.outcome.summary,
        artifacts: event.outcome.filesWritten,
        timing: {
          started_at: event.startedAt,
          ended_at: event.endedAt,
        },
        ...(event.outcome.telemetry ? { context: event.outcome.telemetry as Record<string, unknown> } : {}),
      };
    }
    case "stage.failed":
      return {
        event_type: "stage.failed",
        status: "FAIL",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.summary,
        ...(event.context ? { context: event.context } : {}),
        ...(event.error ? { error: { message: event.error } } : {}),
      };
    case "stage.skipped":
      return {
        event_type: "stage.skipped",
        status: "SKIP",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.summary,
      };
    case "stage.retried":
      return {
        event_type: "stage.retried",
        status: "RETRY",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.summary,
        ...(event.context ? { context: event.context } : {}),
      };
    case "gate.presented":
      return {
        event_type: "gate.presented",
        status: "RUNNING",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.summary,
      };
    case "gate.approved":
      return {
        event_type: "gate.approved",
        status: "PASS",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.summary,
      };
    case "gate.rejected":
      return {
        event_type: "gate.rejected",
        status: "FAIL",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.summary,
      };
    case "backward_loop.requested":
      return {
        event_type: "backward_loop.requested",
        status: "FAIL",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.request.summary,
        context: {
          classification: event.request.classification,
          ...(event.request.guidance !== undefined ? { guidance: event.request.guidance } : {}),
        },
      };
    case "backward_loop.decided":
      return {
        event_type: "backward_loop.decided",
        status: "PASS",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Looping back to ${event.targetStage}.`,
        context: {
          classification: event.request.classification,
          target_stage: event.targetStage,
        },
      };
    case "backward_loop.deferred":
      return {
        event_type: "backward_loop.deferred",
        status: "PASS",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Deferred remediation to replan for phase ${event.phase}.`,
        context: {
          classification: event.request.classification,
          ...(event.request.guidance !== undefined ? { guidance: event.request.guidance } : {}),
        },
      };
    case "backward_loop.reset":
      return {
        event_type: "backward_loop.reset",
        status: "PASS",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Archived and deleted stale artifacts for ${event.targetStage}.`,
        artifacts: event.archived,
      };
    case "backward_loop.failed":
      return {
        event_type: "backward_loop.failed",
        status: "FAIL",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Backward-loop cap (${event.maxLoops}) reached; stopping the run.`,
        context: {
          classification: event.classification,
        },
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildStageDurations(events: TelemetryEvent[]): string[] {
  const starts = new Map<string, TelemetryEvent>();
  const rows: string[] = [];

  for (const event of events) {
    const key = `${event.stage ?? "run"}:${event.phase ?? 0}:${event.stage_instance ?? 0}`;
    if (event.event_type === "stage.started") {
      starts.set(key, event);
      continue;
    }
    if (!event.event_type.startsWith("stage.") || !event.stage) {
      continue;
    }
    const start = starts.get(key);
    const duration = start ? durationSeconds(start.ts, event.ts) : "skipped";
    rows.push(`| ${event.stage} | ${event.phase ?? "—"} | ${duration} | ${event.status} |`);
  }

  return rows.length > 0 ? rows : ["| goals | — | skipped | skip |"];
}

function aggregateChildCalls(events: TelemetryEvent[]): string[] {
  const rows: string[] = [];
  for (const event of events) {
    if (!event.stage || !event.context?.child_agent_calls || typeof event.context.child_agent_calls !== "object") {
      continue;
    }
    for (const [child, value] of Object.entries(event.context.child_agent_calls as Record<string, unknown>)) {
      const calls = typeof value === "number" ? value : 0;
      rows.push(`| ${event.stage} | ${child} | ${calls} | ${calls} | 0 |`);
    }
  }
  return rows;
}

function aggregateReviewRounds(events: TelemetryEvent[]): string[] {
  return events
    .filter((event) => Boolean(event.stage) && typeof event.context?.review_rounds === "number")
    .map((event) => `| ${event.stage ?? "—"} | ${String(event.context?.review_type ?? "reviewer")} | ${String(event.context?.review_rounds ?? 0)} |`);
}

function aggregateGateRows(events: TelemetryEvent[]): string[] {
  const totals = new Map<StageName, { presented: number; rejected: number; approved: number }>();
  for (const event of events) {
    if (!event.stage || !event.event_type.startsWith("gate.")) {
      continue;
    }
    const current = totals.get(event.stage) ?? { presented: 0, rejected: 0, approved: 0 };
    if (event.event_type === "gate.presented") {
      current.presented += 1;
    } else if (event.event_type === "gate.rejected") {
      current.rejected += 1;
    } else if (event.event_type === "gate.approved") {
      current.approved += 1;
    }
    totals.set(event.stage, current);
  }
  return [...totals.entries()].map(
    ([stage, counts]) => `| ${stage} | ${counts.presented} | ${counts.rejected} | ${counts.approved} |`,
  );
}

function aggregateEvidence(events: TelemetryEvent[]): string[] {
  const phases = new Map<number, { deterministic: number; flaky: number; harnessNoisy: number; ambiguous: number; redundant: number; noTestTasks: number; noTestAuditOverrides: number }>();
  for (const event of events) {
    if (!event.phase || !event.context?.evidence_quality || typeof event.context.evidence_quality !== "object") {
      continue;
    }
    const current = phases.get(event.phase) ?? {
      deterministic: 0,
      flaky: 0,
      harnessNoisy: 0,
      ambiguous: 0,
      redundant: 0,
      noTestTasks: 0,
      noTestAuditOverrides: 0,
    };
    const evidence = event.context.evidence_quality as Record<string, unknown>;
    current.deterministic += numberValue(evidence.deterministic);
    current.flaky += numberValue(evidence.flaky);
    current.harnessNoisy += numberValue(evidence.harnessNoisy);
    current.ambiguous += numberValue(evidence.ambiguous);
    current.redundant += numberValue(evidence.redundant);
    current.noTestTasks += numberValue(evidence.noTestTasks);
    current.noTestAuditOverrides += numberValue(evidence.noTestAuditOverrides);
    phases.set(event.phase, current);
  }

  return [...phases.entries()].map(
    ([phase, evidence]) =>
      `| ${phase} | ${evidence.deterministic} | ${evidence.flaky} | ${evidence.harnessNoisy} | ${evidence.ambiguous} | ${evidence.redundant} | ${evidence.noTestTasks} | ${evidence.noTestAuditOverrides} |`,
  );
}

function collectTerminalStates(events: TelemetryEvent[]): string[] {
  return events
    .filter((event) => event.stage === "plan" || event.stage === "replan")
    .map((event) => event.context?.terminal_review_state)
    .filter((value): value is string => typeof value === "string")
    .map((value, index) => `${index === 0 ? "plan" : "replan"}:${value}`);
}

function countStage(events: TelemetryEvent[], stage: string, eventType: string): number {
  return events.filter((event) => event.stage === stage && event.event_type === eventType).length;
}

function durationSeconds(startedAt: string | undefined, endedAt: string | undefined): string {
  if (!startedAt || !endedAt) {
    return "0";
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "0";
  }
  return String(Math.max(0, Math.round((end - start) / 1000)));
}

function timeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(11, 19);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function readSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
