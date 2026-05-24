export type RunId = string;
export type PipelineRoute = "" | "full" | "quick-fix";
export type ExecutableRoute = Exclude<PipelineRoute, "">;
export type PipelineMode = "live" | "dry-run";
export type InteractionMode = "interactive" | "automated";
export type FailurePolicy = "fail-closed" | "best-effort";

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
  route: PipelineRoute;
  current_phase: number;
  total_phases: number;
  last_completed_stage: string;
  next_stage: string;
  stages_completed: string[];
  phase_history: PhaseHistoryEntry[];
  backward_loops: number;
  resume_source: "fresh" | "resume" | "artifacts";
  mode: PipelineMode;
  interaction_mode: InteractionMode;
  failure_policy: FailurePolicy;
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

export const STAGE_NAMES: ReadonlyArray<string> = [
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

export const QUICK_FIX_STAGE_NAMES: ReadonlyArray<string> = [
  "goals",
  "research",
  "plan",
  "implement",
  "accept",
  "verify",
  "report",
];

const DRY_RUN_STAGE_ARTIFACTS: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    goals: ["config.md", "requirements.md", "goals.md", "goal-inventory.md"],
    research: [
      "goal-inventory.md",
      "questions.md",
      "question-leakage-review.md",
      "question-quality-review.md",
      "research/iterations/round-01/questions.md",
      "research/iterations/round-01/q-01.md",
      "research/iterations/round-01/summary.md",
      "research/question-ledger.md",
      "research/open-questions.md",
      "research/summary.md",
      "reviews/research/round-01/research-pass-review-round-01.md",
      "reviews/research-review-round-01.md",
    ],
    design: ["design.md"],
    structure: ["structure.md"],
    plan: ["plan.md", "phase-manifest.md", "baseline-results.md"],
    implement: [
      "phases/phase-01/execution-manifest.md",
      "phases/phase-01/stage7-summary.md",
    ],
    accept: [
      "phases/phase-01/acceptance-results.md",
      "phases/phase-01/stage8-summary.md",
    ],
    replan: ["phases/phase-01/replan/phase-01-replan.md"],
    verify: ["stage9-summary.md"],
    report: [
      "stage10-summary.md",
      "telemetry/run-log.md",
      "telemetry/metrics-summary.md",
    ],
  };

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

export function getRouteStages(route: ExecutableRoute): ReadonlyArray<string> {
  return route === "quick-fix" ? QUICK_FIX_STAGE_NAMES : STAGE_NAMES;
}

export function getDryRunStageArtifactPaths(
  runId: string,
  stage: string,
): string[] {
  const artifacts = DRY_RUN_STAGE_ARTIFACTS[stage.toLowerCase()] ?? [];
  return artifacts.map((artifact) => `${getPipelineDir(runId)}/${artifact}`);
}

export function getDryRunArtifactPaths(
  runId: string,
  route: ExecutableRoute,
): string[] {
  const artifactPaths = new Set<string>();

  for (const stage of getRouteStages(route)) {
    for (const artifact of getDryRunStageArtifactPaths(runId, stage)) {
      artifactPaths.add(artifact);
    }
  }

  return [...artifactPaths];
}

export function makeInitialState(
  runId: string,
  overrides: Partial<PipelineState> = {},
): PipelineState {
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
    mode: "live",
    interaction_mode: "interactive",
    failure_policy: "fail-closed",
    ...overrides,
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

export function stageNumber(name: string): number {
  const lower = name.toLowerCase();
  const idx = STAGE_NAMES.findIndex((s) => s === lower);
  return idx === -1 ? 0 : idx + 1;
}

export function nextStage(
  currentStage: string,
  route: ExecutableRoute,
): string | null {
  const lower = currentStage.toLowerCase();
  const stageOrder = getRouteStages(route);
  const idx = stageOrder.findIndex((s) => s === lower);
  if (idx === -1) return null;

  if (idx >= stageOrder.length - 1) return null;
  return stageOrder[idx + 1]!;
}
