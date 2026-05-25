import type { PipelineRoute } from "./state";

export interface TelemetryEvent {
  schema_version: string;
  event_id: string;
  sequence: number;
  ts: string;
  run_id: string;
  writer_agent: string;
  writer_scope: string;
  event_type: string;
  status: "PASS" | "FAIL" | "SKIP" | "ABORT";
  route: PipelineRoute;
  summary: string;
  stage?: number;
  stage_instance?: string;
  phase?: number;
  wave?: number;
  task_id?: string;
  review_round?: number;
  attempt?: number;
  child_agent?: string;
  correlation_id?: string;
  payload?: {
    context?: Record<string, unknown>;
    artifacts?: string[];
    timing?: { started_at: string; completed_at: string; duration_ms: number };
    decision?: string;
    error?: string;
    git?: { branch: string; commit?: string };
  };
}

export function makeTelemetryEvent(
  runId: string,
  eventType: string,
  overrides: Partial<TelemetryEvent>,
): TelemetryEvent {
  const ts = new Date().toISOString();
  const defaults = {
    schema_version: "1.0" as const,
    event_id: `${runId}-${eventType}-${ts}`,
    sequence: 0,
    ts,
    run_id: runId,
    writer_agent: "orchestrator" as const,
    writer_scope: "pipeline" as const,
    event_type: eventType,
    status: "PASS" as const,
    route: "" as const,
    summary: "",
  };

  return { ...defaults, ...overrides };
}

export function createRunLogEntry(event: TelemetryEvent): string {
  return `- [${event.ts}] ${event.event_type} — ${event.status}: ${event.summary}`;
}
