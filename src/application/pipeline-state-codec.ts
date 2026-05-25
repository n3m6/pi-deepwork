import type {
  FailurePolicy,
  InteractionMode,
  PipelineMode,
  PipelineState,
} from "../domain/pipeline";

export interface ParsedPipelineState {
  run_id: string;
  mode: PipelineMode;
  next_stage: string;
  last_completed_stage: string;
  route: string;
  interaction_mode: InteractionMode;
  failure_policy: FailurePolicy;
}

export function yamlify(state: PipelineState): string {
  return `---
run_id: ${state.run_id}
mode: "${state.mode}"
route: "${state.route}"
current_phase: ${state.current_phase}
total_phases: ${state.total_phases}
last_completed_stage: "${state.last_completed_stage}"
next_stage: "${state.next_stage}"
stages_completed: ${JSON.stringify(state.stages_completed)}
phase_history: ${JSON.stringify(state.phase_history)}
backward_loops: ${state.backward_loops}
resume_source: "${state.resume_source}"
interaction_mode: "${state.interaction_mode}"
failure_policy: "${state.failure_policy}"
---
`;
}

export function parseStateYaml(raw: string): ParsedPipelineState | null {
  const parts = raw.split("---");
  if (parts.length < 3) return null;
  const block = parts[1]!;
  const lines = block.trim().split("\n");
  const map: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  if (
    !map.run_id ||
    !map.next_stage ||
    !map.last_completed_stage ||
    map.route === undefined
  ) {
    return null;
  }
  return {
    run_id: map.run_id,
    mode: map.mode === "dry-run" ? "dry-run" : "live",
    next_stage: map.next_stage,
    last_completed_stage: map.last_completed_stage,
    route: map.route,
    interaction_mode:
      map.interaction_mode === "automated" ? "automated" : "interactive",
    failure_policy:
      map.failure_policy === "best-effort" ? "best-effort" : "fail-closed",
  };
}
