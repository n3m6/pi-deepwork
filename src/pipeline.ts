export type RunId = string;

export interface PipelinePaths {
  pipelineDir: string;
  gitBranch: string;
  statePath: string;
  telemetryDir: string;
  eventsPath: string;
  runLogPath: string;
  metricsPath: string;
}

export interface PhaseHistoryEntry {
  phase: number;
  completed_stages: string[];
}

export interface PipelineState {
  run_id: string;
  route: "" | "full" | "quick-fix";
  current_phase: number;
  total_phases: number;
  last_completed_stage: string;
  next_stage: string;
  stages_completed: string[];
  phase_history: PhaseHistoryEntry[];
  backward_loops: number;
  resume_source: "fresh" | "resume";
}

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
  route: "" | "full" | "quick-fix";
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

export const STAGE_NAMES: ReadonlyArray<string> = [
  "goals",
  "questions",
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

export function generateRunId(): string {
  const now = new Date();
  const Y = now.getUTCFullYear().toString();
  const M = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const D = now.getUTCDate().toString().padStart(2, "0");
  const h = now.getUTCHours().toString().padStart(2, "0");
  const m = now.getUTCMinutes().toString().padStart(2, "0");
  const s = now.getUTCSeconds().toString().padStart(2, "0");
  return `qrspi-${Y}${M}${D}-${h}${m}${s}`;
}

export function getPipelineDir(runId: string): string {
  return `.pipeline/${runId}`;
}

export function getGitBranch(runId: string): string {
  return `qrspi/${runId}`;
}

export function getStatePath(runId: string): string {
  return `${getPipelineDir(runId)}/state.md`;
}

export function getTelemetryDir(runId: string): string {
  return `${getPipelineDir(runId)}/telemetry`;
}

export function getEventsPath(runId: string): string {
  return `${getTelemetryDir(runId)}/events.jsonl`;
}

export function getRunLogPath(runId: string): string {
  return `${getTelemetryDir(runId)}/run-log.md`;
}

export function getMetricsPath(runId: string): string {
  return `${getTelemetryDir(runId)}/metrics-summary.md`;
}

export function getPipelinePaths(runId: string): PipelinePaths {
  return {
    pipelineDir: getPipelineDir(runId),
    gitBranch: getGitBranch(runId),
    statePath: getStatePath(runId),
    telemetryDir: getTelemetryDir(runId),
    eventsPath: getEventsPath(runId),
    runLogPath: getRunLogPath(runId),
    metricsPath: getMetricsPath(runId),
  };
}

export function makeInitialState(runId: string): PipelineState {
  return {
    run_id: runId,
    route: "",
    current_phase: 1,
    total_phases: 0,
    last_completed_stage: "0",
    next_stage: "1",
    stages_completed: [],
    phase_history: [],
    backward_loops: 0,
    resume_source: "fresh",
  };
}

export function makeTelemetryEvent(
  runId: string,
  eventType: string,
  overrides: Partial<TelemetryEvent>
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

export function stageNumber(name: string): number {
  const lower = name.toLowerCase();
  const idx = STAGE_NAMES.findIndex((s) => s === lower);
  return idx === -1 ? 0 : idx + 1;
}

export function nextStage(
  currentStage: string,
  route: "full" | "quick-fix"
): string | null {
  const lower = currentStage.toLowerCase();
  const idx = STAGE_NAMES.findIndex((s) => s === lower);
  if (idx === -1) return null;

  if (route === "quick-fix") {
    const quickFixOrder: string[] = [
      "goals",
      "questions",
      "research",
      "plan",
      "implement",
      "accept",
      "verify",
      "report",
    ];
    const qIdx = quickFixOrder.findIndex((s) => s === lower);
    if (qIdx === -1) return null;
    if (qIdx >= quickFixOrder.length - 1) return null;
    return quickFixOrder[qIdx + 1]!;
  }

  if (idx >= STAGE_NAMES.length - 1) return null;
  return STAGE_NAMES[idx + 1]!;
}
