// JsonlTelemetrySink — maps domain events to TelemetryEvent schema and writes JSONL.
// Wraps TelemetryRecorder for migration compatibility.

import type { DomainEvent } from "../../domain/event/index.js";
import { TelemetryRecorder } from "../../telemetry.js";
import type { TelemetrySink } from "../../application/port/index.js";
import type { RunArtifacts, RunState, StageName } from "../../application/port/index.js";
import type { TelemetryEvent } from "../../types.js";

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

  /** Direct access to the underlying recorder for migration compat. */
  get raw(): TelemetryRecorder {
    return this.recorder;
  }
}

type TelemetryEventPartial = Omit<TelemetryEvent, "schema_version" | "event_id" | "sequence" | "ts" | "run_id" | "writer_agent" | "writer_scope">;

function domainEventToTelemetryEvent(event: DomainEvent): TelemetryEventPartial | undefined {
  switch (event.type) {
    case "run.started":
      return { event_type: "run.started", status: "PASS", route: event.route, summary: `Run started. Route: ${event.route}.` };
    case "run.resumed":
      return { event_type: "run.resumed", status: "PASS", route: event.route, summary: `Run resumed. Route: ${event.route}.` };
    case "run.completed":
      return { event_type: "run.completed", status: event.status, route: event.route, summary: `Run completed. Route: ${event.route}.` };
    case "run.aborted":
      return { event_type: "run.aborted", status: "FAIL", route: event.route, summary: event.error };
    case "stage.started":
      return {
        event_type: "stage.started",
        status: "RUNNING",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Stage ${event.stage} started.`,
      };
    case "stage.completed":
      return {
        event_type: "stage.completed",
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
          duration_s: Math.round((new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime()) / 1000),
        },
        ...(event.outcome.telemetry ? { context: event.outcome.telemetry as Record<string, unknown> } : {}),
      };
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
      };
    case "backward_loop.decided":
      return {
        event_type: "backward_loop.decided",
        status: "FAIL",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Backward loop decided: ${event.targetStage}. ${event.request.summary}`,
        decision: { choice: event.targetStage, reason: event.request.summary },
      };
    case "backward_loop.deferred":
      return {
        event_type: "backward_loop.deferred",
        status: "PARTIAL",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: event.request.summary,
      };
    case "backward_loop.reset":
      return {
        event_type: "backward_loop.reset",
        status: "PASS",
        route: event.route,
        stage: event.stage as StageName,
        phase: event.phase,
        stage_instance: event.stageInstance,
        summary: `Artifacts archived: ${event.archived.join(", ") || "none"}.`,
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
        summary: `Backward loop cap hit (${event.maxLoops}). Classification: ${event.classification}.`,
      };
    default:
      return undefined;
  }
}
