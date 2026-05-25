import type {
  FailurePolicy,
  InteractionMode,
  PipelineMode,
} from "../domain/pipeline";

export interface RuntimeDiscoverySnapshot {
  skillPath: string;
  projectAgentsDir: string;
  totalBundledAgents: number;
  syncedAgents: number;
  skippedAgents: number;
  registeredQrspiAgents: string[];
  registryLayouts: string[];
}

export interface ResumeHandoffState {
  run_id: string;
  mode: PipelineMode;
  next_stage: string;
  last_completed_stage: string;
  route: string;
  interaction_mode: InteractionMode;
  failure_policy: FailurePolicy;
}

export function buildOrchestrationContract(): string {
  return `=== ORCHESTRATION CONTRACT ===
- Operate only as the Deepwork orchestrator.
- Do not write or edit project source files directly.
- Delegate every stage with the native Agent tool and the exact QRSPI custom agent type in subagent_type.
- Do not search for SKILL.md, call add_directory, create agent symlinks, or call subagent list as a prerequisite.
- Do not use subagent list, the generic subagent tool, or a general-purpose fallback to decide how to launch QRSPI stages.
- If the deepwork skill or native Agent tool is unavailable, stop immediately and report "Deepwork configuration error". Do not fall back to direct implementation.
- Do not probe ask_user before the first stage dispatch. If an interactive human gate is reached and ask_user is unavailable, stop immediately and report "Deepwork configuration error".`;
}

export function formatRuntimeDiscoverySnapshot(
  discovery: RuntimeDiscoverySnapshot,
): string {
  const layouts =
    discovery.registryLayouts.length > 0
      ? discovery.registryLayouts.join(", ")
      : "none";
  const qrspiAgents =
    discovery.registeredQrspiAgents.length > 0
      ? discovery.registeredQrspiAgents.join(", ")
      : "none";

  return `=== RUNTIME DISCOVERY ===
- Skill source: ${discovery.skillPath}
- Project agent directory: ${discovery.projectAgentsDir}
- Bundled agents: ${discovery.totalBundledAgents} total; ${discovery.syncedAgents} synced; ${discovery.skippedAgents} skipped
- Registry layouts refreshed: ${layouts}
- Registered QRSPI agents: ${qrspiAgents}
- Stage launcher: native Agent tool with registered QRSPI custom agent types
- Human gate tool: ask_user from pi-ask-user, required only when an interactive gate is reached
- Legacy child helper tools: qrspi_dispatch, qrspi_get_subagent_result`;
}

const STAGE_AGENT_BY_NEXT_STAGE: Readonly<Record<string, string>> = {
  "1": "qrspi-goals",
  goals: "qrspi-goals",
  "2": "qrspi-research",
  research: "qrspi-research",
  "3": "qrspi-design",
  design: "qrspi-design",
  "4": "qrspi-structure",
  structure: "qrspi-structure",
  "5": "qrspi-plan",
  plan: "qrspi-plan",
  "6": "qrspi-implement",
  implement: "qrspi-implement",
  "7": "qrspi-accept",
  accept: "qrspi-accept",
  "8": "qrspi-replan",
  replan: "qrspi-replan",
  "9": "qrspi-verify",
  verify: "qrspi-verify",
  "10": "qrspi-report",
  report: "qrspi-report",
};

export function getStageAgentForNextStage(nextStageValue: string): string {
  return (
    STAGE_AGENT_BY_NEXT_STAGE[nextStageValue.trim().toLowerCase()] ?? "unknown"
  );
}

export function buildNextDispatchContract(
  nextStageValue: string,
  runId: string,
  task?: string,
): string {
  const stageAgent = getStageAgentForNextStage(nextStageValue);
  const userTaskBlock =
    task === undefined ? "" : `\n\n=== USER TASK ===\n${task}`;

  return `=== NEXT DISPATCH ===
Call the native Agent tool exactly once for the recorded next stage. Do not run discovery first and do not substitute general-purpose.

Use the Agent tool with exactly:
- subagent_type: "${stageAgent}"
- description: "Stage ${nextStageValue} dispatch"
- prompt:
=== RUN ID ===
${runId}${userTaskBlock}

=== INTERACTION MODE ===
Use the value from this handoff prompt.

=== FAILURE POLICY ===
Use the value from this handoff prompt.`;
}

export function buildLiveRunHandoffPrompt(
  runId: string,
  task: string,
  interactionMode: InteractionMode,
  failurePolicy: FailurePolicy,
  discovery: RuntimeDiscoverySnapshot,
): string {
  return `Continue the existing Deepwork pipeline run that the runtime already scaffolded. Do not create a new run ID. Use Resume Mode against the existing pipeline directory on disk and continue from the recorded next stage in state.md.\n\n${buildOrchestrationContract()}\n\n${formatRuntimeDiscoverySnapshot(discovery)}\n\n${buildNextDispatchContract("1", runId, task)}\n\n=== RUN ID ===\n${runId}\n\n=== MODE ===\nlive\n\n=== PIPELINE DIR ===\n.pipeline/${runId}\n\n=== USER TASK ===\n${task}\n\n=== INTERACTION MODE ===\n${interactionMode}\n\n=== FAILURE POLICY ===\n${failurePolicy}`;
}

export function buildResumeHandoffPrompt(
  parsed: ResumeHandoffState,
  discovery: RuntimeDiscoverySnapshot,
): string {
  return `Resume the existing Deepwork pipeline run from disk. Do not create a new run ID. Use Resume Mode and continue from the recorded next stage.\n\n${buildOrchestrationContract()}\n\n${formatRuntimeDiscoverySnapshot(discovery)}\n\n${buildNextDispatchContract(parsed.next_stage, parsed.run_id)}\n\n=== RUN ID ===\n${parsed.run_id}\n\n=== MODE ===\n${parsed.mode}\n\n=== ROUTE ===\n${parsed.route}\n\n=== LAST COMPLETED STAGE ===\n${parsed.last_completed_stage}\n\n=== NEXT STAGE ===\n${parsed.next_stage}\n\n=== PIPELINE DIR ===\n.pipeline/${parsed.run_id}\n\n=== INTERACTION MODE ===\n${parsed.interaction_mode}\n\n=== FAILURE POLICY ===\n${parsed.failure_policy}`;
}

export function formatStartHandoffFailure(
  runId: string,
  error: string,
): string {
  return `Automatic orchestration handoff failed. The run was scaffolded under .pipeline/${runId}, but no Deepwork orchestrator is active because pi.sendUserMessage() threw: ${error}. Fix the runtime configuration, then run /deepwork-resume run-id:"${runId}".`;
}

export function formatResumeHandoffFailure(
  runId: string,
  error: string,
): string {
  return `Automatic orchestration handoff failed. The recovered run remains on disk, but no Deepwork orchestrator is active because pi.sendUserMessage() threw: ${error}. Fix the runtime configuration, then rerun /deepwork-resume run-id:"${runId}".`;
}
