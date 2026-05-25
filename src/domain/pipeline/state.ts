export type RunId = string;
export type PipelineRoute = "" | "full" | "quick-fix";
export type ExecutableRoute = Exclude<PipelineRoute, "">;
export type PipelineMode = "live" | "dry-run";
export type InteractionMode = "interactive" | "automated";
export type FailurePolicy = "fail-closed" | "best-effort";

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
