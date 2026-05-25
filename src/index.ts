import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  createRunLogEntry,
  getDryRunStageArtifactPaths,
  generateRunId,
  getMetricsPath,
  getPipelineDir,
  getRouteStages,
  getRunLogPath,
  getTelemetryDir,
  getStatePath,
  getEventsPath,
  makeInitialState,
  makeTelemetryEvent,
  nextStage,
  stageNumber,
} from "./pipeline";
import type {
  ExecutableRoute,
  PipelineMode,
  PipelineState,
  TelemetryEvent,
  InteractionMode,
  FailurePolicy,
} from "./pipeline";
import {
  createDispatchTool,
  createGetSubagentResultTool,
  createQuestionTool,
  setPi,
} from "./shared-tools";
import {
  ensureRegisteredSubagents,
  getProjectAgentsDir,
  REQUIRED_QRSPI_STAGE_AGENTS,
} from "./subagent-catalog";
import {
  ensureRuntimeSkillCompatInstall,
  getRuntimePackageRoot,
} from "./skill-compat";
import type {
  ExtensionAPI,
  ExtensionContext,
  CommandHandler,
} from "./types/pi-extensions";

interface RuntimeHandoffResult {
  delivered: boolean;
  error?: string;
}

interface RuntimeDiscoverySnapshot {
  skillPath: string;
  projectAgentsDir: string;
  totalBundledAgents: number;
  syncedAgents: number;
  skippedAgents: number;
  registeredQrspiAgents: string[];
  registryLayouts: string[];
}

type AgentPrepResult =
  | { ok: true; discovery: RuntimeDiscoverySnapshot }
  | { ok: false; error: string };

function yamlify(state: PipelineState): string {
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

function parseStateYaml(raw: string): {
  run_id: string;
  mode: PipelineMode;
  next_stage: string;
  last_completed_stage: string;
  route: string;
  interaction_mode: InteractionMode;
  failure_policy: FailurePolicy;
} | null {
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

function parseDryRunArg(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "on"
    );
  }

  return false;
}

function parseRouteArg(value: unknown): ExecutableRoute | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "full" || normalized === "quick-fix") {
    return normalized;
  }

  return null;
}

function parseInteractionModeArg(value: unknown): InteractionMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "interactive" || normalized === "automated") {
    return normalized;
  }

  return null;
}

function parseFailurePolicyArg(value: unknown): FailurePolicy | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "fail-closed" || normalized === "best-effort") {
    return normalized;
  }

  return null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildOrchestrationContract(): string {
  return `=== ORCHESTRATION CONTRACT ===
- Operate only as the Deepwork orchestrator.
- Do not write or edit project source files directly.
- Delegate every stage with the native Agent tool and the exact QRSPI custom agent type in subagent_type.
- Do not search for SKILL.md, call add_directory, create agent symlinks, or call subagent list as a prerequisite.
- Do not use subagent list, the generic subagent tool, or a general-purpose fallback to decide how to launch QRSPI stages.
- If the deepwork skill, native Agent tool, or qrspi_question tool is unavailable, stop immediately and report "Deepwork configuration error". Do not fall back to direct implementation.`;
}

function formatRuntimeDiscoverySnapshot(
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
- Expected extension tools: qrspi_question, qrspi_get_subagent_result`;
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

function getStageAgentForNextStage(nextStageValue: string): string {
  return (
    STAGE_AGENT_BY_NEXT_STAGE[nextStageValue.trim().toLowerCase()] ?? "unknown"
  );
}

function buildNextDispatchContract(
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

function buildLiveRunHandoffPrompt(
  runId: string,
  task: string,
  interactionMode: InteractionMode,
  failurePolicy: FailurePolicy,
  discovery: RuntimeDiscoverySnapshot,
): string {
  return `Continue the existing Deepwork pipeline run that the runtime already scaffolded. Do not create a new run ID. Use Resume Mode against the existing pipeline directory on disk and continue from the recorded next stage in state.md.\n\n${buildOrchestrationContract()}\n\n${formatRuntimeDiscoverySnapshot(discovery)}\n\n${buildNextDispatchContract("1", runId, task)}\n\n=== RUN ID ===\n${runId}\n\n=== MODE ===\nlive\n\n=== PIPELINE DIR ===\n.pipeline/${runId}\n\n=== USER TASK ===\n${task}\n\n=== INTERACTION MODE ===\n${interactionMode}\n\n=== FAILURE POLICY ===\n${failurePolicy}`;
}

function buildResumeHandoffPrompt(
  parsed: {
    run_id: string;
    mode: PipelineMode;
    next_stage: string;
    last_completed_stage: string;
    route: string;
    interaction_mode: InteractionMode;
    failure_policy: FailurePolicy;
  },
  discovery: RuntimeDiscoverySnapshot,
): string {
  return `Resume the existing Deepwork pipeline run from disk. Do not create a new run ID. Use Resume Mode and continue from the recorded next stage.\n\n${buildOrchestrationContract()}\n\n${formatRuntimeDiscoverySnapshot(discovery)}\n\n${buildNextDispatchContract(parsed.next_stage, parsed.run_id)}\n\n=== RUN ID ===\n${parsed.run_id}\n\n=== MODE ===\n${parsed.mode}\n\n=== ROUTE ===\n${parsed.route}\n\n=== LAST COMPLETED STAGE ===\n${parsed.last_completed_stage}\n\n=== NEXT STAGE ===\n${parsed.next_stage}\n\n=== PIPELINE DIR ===\n.pipeline/${parsed.run_id}\n\n=== INTERACTION MODE ===\n${parsed.interaction_mode}\n\n=== FAILURE POLICY ===\n${parsed.failure_policy}`;
}

function formatStartHandoffFailure(runId: string, error: string): string {
  return `Automatic orchestration handoff failed. The run was scaffolded under .pipeline/${runId}, but no Deepwork orchestrator is active because pi.sendUserMessage() threw: ${error}. Fix the runtime configuration, then run /deepwork-resume run-id:"${runId}".`;
}

function formatResumeHandoffFailure(runId: string, error: string): string {
  return `Automatic orchestration handoff failed. The recovered run remains on disk, but no Deepwork orchestrator is active because pi.sendUserMessage() threw: ${error}. Fix the runtime configuration, then rerun /deepwork-resume run-id:"${runId}".`;
}

async function handoffToSession(
  pi: ExtensionAPI,
  prompt: string,
): Promise<RuntimeHandoffResult> {
  try {
    await Promise.resolve(pi.sendUserMessage(prompt));
    return { delivered: true };
  } catch (error: unknown) {
    return { delivered: false, error: describeError(error) };
  }
}

function writeTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
  return path.resolve(workspaceRoot, filePath);
}

function resolveWorkspacePaths(
  workspaceRoot: string,
  runId: string,
): {
  statePath: string;
  telemetryDir: string;
  eventsPath: string;
  runLogPath: string;
  metricsPath: string;
} {
  return {
    statePath: resolveWorkspacePath(workspaceRoot, getStatePath(runId)),
    telemetryDir: resolveWorkspacePath(workspaceRoot, getTelemetryDir(runId)),
    eventsPath: resolveWorkspacePath(workspaceRoot, getEventsPath(runId)),
    runLogPath: resolveWorkspacePath(workspaceRoot, getRunLogPath(runId)),
    metricsPath: resolveWorkspacePath(workspaceRoot, getMetricsPath(runId)),
  };
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function updatePhaseHistory(state: PipelineState, stage: string): void {
  if (stage !== "implement" && stage !== "accept" && stage !== "replan") {
    return;
  }

  const lastEntry = state.phase_history[state.phase_history.length - 1];
  if (!lastEntry || lastEntry.phase !== state.current_phase) {
    state.phase_history.push({
      phase: state.current_phase,
      completed_stages: [stage],
    });
    return;
  }

  if (!lastEntry.completed_stages.includes(stage)) {
    lastEntry.completed_stages.push(stage);
  }
}

function createDryRunArtifactContent(
  runId: string,
  route: ExecutableRoute,
  interactionMode: InteractionMode,
  failurePolicy: FailurePolicy,
  stage: string,
  task: string,
  artifactPath: string,
  stageIndex: number,
  totalStages: number,
): string {
  const pipelineDir = `${path.sep}${getPipelineDir(runId)}${path.sep}`;
  const relativeArtifactPath = artifactPath.includes(pipelineDir)
    ? artifactPath.split(pipelineDir)[1]!
    : artifactPath.replace(`${getPipelineDir(runId)}/`, "");
  const heading = `${titleCase(stage)} — Dry Run`;
  const metadata = [
    `- Run ID: ${runId}`,
    `- Mode: dry-run`,
    `- Route: ${route}`,
    `- Interaction Mode: ${interactionMode}`,
    `- Failure Policy: ${failurePolicy}`,
    `- Stage: ${stageNumber(stage)} of ${totalStages} (${titleCase(stage)})`,
    `- Progress: ${stageIndex} of ${totalStages}`,
    `- Artifact: ${relativeArtifactPath}`,
  ].join("\n");

  if (relativeArtifactPath === "requirements.md") {
    return `# Requirements — Dry Run\n\n${task}\n\n---\nThis file was generated by a simulated dry run. No subagents were dispatched and no project files were modified.\n`;
  }

  if (relativeArtifactPath === "config.md") {
    return `# Config — Dry Run\n\n- Run ID: ${runId}\n- Mode: dry-run\n- Route: ${route}\n- Interaction Mode: ${interactionMode}\n- Failure Policy: ${failurePolicy}\n- Selected stages: ${getRouteStages(route).join(", ")}\n`;
  }

  if (relativeArtifactPath === "phase-manifest.md") {
    return `# Phase Manifest — Dry Run\n\n${metadata}\n\n## Phases\n\n- Phase 1 — Simulated implementation phase\n`;
  }

  return `# ${heading}\n\n${metadata}\n\nThis artifact was generated by a simulated dry run. It represents the output shape for this stage without invoking QRSPI subagents or modifying project source files.\n\n## Source Task\n\n${task}\n`;
}

function formatDryRunRunLog(
  runId: string,
  route: ExecutableRoute,
  events: TelemetryEvent[],
  state: PipelineState,
): string {
  const entries = events.map((event) => createRunLogEntry(event)).join("\n");

  return `# Run Log — ${runId}\n\n## Run Overview\n\n- Mode: dry-run\n- Route: ${route}\n- Status: completed\n- Last completed stage: ${state.last_completed_stage}\n- Next stage: ${state.next_stage}\n\n## Timeline\n\n${entries}\n`;
}

function formatDryRunMetricsSummary(
  runId: string,
  route: ExecutableRoute,
  stageOrder: ReadonlyArray<string>,
): string {
  const durationRows = stageOrder
    .map((stage) => `| ${stage} | 1 | pass |`)
    .join("\n");

  return `# Metrics Summary — ${runId}\n\n## Run\n\n- Mode: dry-run\n- Route: ${route}\n- Final status: completed-pass\n- Stages completed: ${stageOrder.length} of ${stageOrder.length}\n\n## Stage Durations\n\n| Stage | Simulated Phases | Status |\n| ----- | ---------------- | ------ |\n${durationRows}\n`;
}

function runDryRun(
  workspaceRoot: string,
  task: string,
  route: ExecutableRoute,
  interactionMode: InteractionMode,
  failurePolicy: FailurePolicy,
): { runId: string; state: PipelineState } {
  const runId = generateRunId();
  const paths = resolveWorkspacePaths(workspaceRoot, runId);
  const stageOrder = getRouteStages(route);
  const state = makeInitialState(runId, {
    mode: "dry-run",
    route,
    total_phases: route === "quick-fix" ? 1 : 0,
    interaction_mode: interactionMode,
    failure_policy: failurePolicy,
  });
  const events: TelemetryEvent[] = [];
  let sequence = 1;

  const pushEvent = (
    eventType: string,
    summary: string,
    overrides: Partial<TelemetryEvent> = {},
  ): void => {
    events.push(
      makeTelemetryEvent(runId, eventType, {
        sequence,
        route,
        summary,
        ...overrides,
      }),
    );
    sequence += 1;
  };

  fs.mkdirSync(paths.telemetryDir, { recursive: true });
  writeTextFile(paths.statePath, yamlify(state));
  writeTextFile(paths.eventsPath, "");

  pushEvent("run.started", `Dry run started. Route: ${route}.`, {
    payload: { context: { mode: "dry-run" } },
  });

  for (const [index, stage] of stageOrder.entries()) {
    const stageIndex = index + 1;
    const stageId = stageNumber(stage);
    const stageArtifacts = getDryRunStageArtifactPaths(runId, stage);

    pushEvent("stage.started", `Dry run stage ${stageId} (${stage}) started.`, {
      stage: stageId,
      payload: { context: { mode: "dry-run" } },
    });

    for (const artifactPath of stageArtifacts) {
      writeTextFile(
        resolveWorkspacePath(workspaceRoot, artifactPath),
        createDryRunArtifactContent(
          runId,
          route,
          interactionMode,
          failurePolicy,
          stage,
          task,
          artifactPath,
          stageIndex,
          stageOrder.length,
        ),
      );
    }

    if (stage === "plan") {
      state.total_phases = 1;
    }

    updatePhaseHistory(state, stage);
    state.last_completed_stage = String(stageId);
    state.next_stage =
      nextStage(stage, route) === null
        ? "done"
        : String(stageNumber(nextStage(stage, route)!));
    state.stages_completed.push(stage);
    writeTextFile(paths.statePath, yamlify(state));

    pushEvent(
      "stage.completed",
      `Dry run stage ${stageId} (${stage}) completed.`,
      {
        stage: stageId,
        payload: {
          context: { mode: "dry-run" },
          artifacts: stageArtifacts,
        },
      },
    );
  }

  pushEvent(
    "run.completed",
    `Dry run completed across ${stageOrder.length} stages.`,
    {
      payload: { context: { mode: "dry-run" } },
    },
  );

  writeTextFile(
    paths.eventsPath,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writeTextFile(
    paths.runLogPath,
    formatDryRunRunLog(runId, route, events, state),
  );
  writeTextFile(
    paths.metricsPath,
    formatDryRunMetricsSummary(runId, route, stageOrder),
  );

  return { runId, state };
}

function isGitAvailable(): boolean {
  try {
    const result = spawnSync("git", ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function tryCreateGitBranch(
  runId: string,
  workspaceRoot: string,
): { ok: boolean; error?: string } {
  try {
    const result = spawnSync(
      "git",
      ["checkout", "-b", `qrspi/${runId}`, "main"],
      {
        encoding: "utf-8",
        cwd: workspaceRoot,
      },
    );
    if (result.status !== 0) {
      const err = (result.stderr ?? result.stdout ?? "").trim();
      return {
        ok: false,
        error: err || `git checkout exited with status ${result.status}`,
      };
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function scanPipelineRunIds(): string[] {
  try {
    const entries = fs.readdirSync(".pipeline");
    return entries.filter((name) => name.startsWith("qrspi-"));
  } catch {
    return [];
  }
}

function ensureWorkspaceQrsiAgents(workspaceRoot: string): AgentPrepResult {
  const runtimePackageRoot = getRuntimePackageRoot(__dirname);
  const registration = ensureRegisteredSubagents(
    workspaceRoot,
    REQUIRED_QRSPI_STAGE_AGENTS,
  );

  if (!registration.ok) {
    if (registration.refreshResult?.error) {
      console.warn(
        `[pi-deepwork] Unable to refresh pi-subagents agent registry before Deepwork handoff: ${registration.refreshResult.error}`,
      );
    }

    return {
      ok: false,
      error:
        registration.error ??
        `Failed to prepare QRSPI agent definitions under ${getProjectAgentsDir(workspaceRoot)}.`,
    };
  }

  const syncResult = registration.syncResult;
  const refreshResult = registration.refreshResult;

  return {
    ok: true,
    discovery: {
      skillPath: path.join(
        runtimePackageRoot,
        "skills",
        "deepwork",
        "SKILL.md",
      ),
      projectAgentsDir: registration.projectAgentsDir,
      totalBundledAgents: syncResult?.total ?? 0,
      syncedAgents: syncResult?.synced.length ?? 0,
      skippedAgents: syncResult?.skipped.length ?? 0,
      registeredQrspiAgents:
        refreshResult?.agentNames
          .filter((agentName) => agentName.startsWith("qrspi-"))
          .sort() ?? [],
      registryLayouts: refreshResult?.layouts ?? [],
    },
  };
}

function getDiscoveredSkillPaths(
  bundledSkillsRoot: string,
  skillCompat: { skillPath?: string },
): string[] {
  const skillPaths = [bundledSkillsRoot];

  if (skillCompat.skillPath && fs.existsSync(skillCompat.skillPath)) {
    skillPaths.push(path.dirname(path.dirname(skillCompat.skillPath)));
  }

  return [...new Set(skillPaths)];
}

function createDeepworkHandler(pi: ExtensionAPI): CommandHandler {
  return async (args: Record<string, unknown>, ctx: ExtensionContext) => {
    let task: string | undefined =
      typeof args.task === "string" ? args.task : undefined;
    const dryRun = parseDryRunArg(args["dry-run"]);
    const routeArg = args.route;
    const parsedRoute = parseRouteArg(routeArg);
    const interactionModeArg = args["interaction-mode"];
    const parsedInteractionMode =
      interactionModeArg === undefined
        ? "interactive"
        : parseInteractionModeArg(interactionModeArg);
    const failurePolicyArg = args["failure-policy"];
    const parsedFailurePolicy =
      failurePolicyArg === undefined
        ? "fail-closed"
        : parseFailurePolicyArg(failurePolicyArg);

    if (dryRun && routeArg !== undefined && parsedRoute === null) {
      await ctx.ui.confirm(
        "Deepwork Error",
        `Invalid route "${String(routeArg)}". Expected "full" or "quick-fix".`,
      );
      return;
    }

    if (parsedInteractionMode === null) {
      await ctx.ui.confirm(
        "Deepwork Error",
        `Invalid interaction-mode "${String(interactionModeArg)}". Expected "interactive" or "automated".`,
      );
      return;
    }

    if (parsedFailurePolicy === null) {
      await ctx.ui.confirm(
        "Deepwork Error",
        `Invalid failure-policy "${String(failurePolicyArg)}". Expected "fail-closed" or "best-effort".`,
      );
      return;
    }

    if (!task || task.trim().length === 0) {
      const confirmed = await ctx.ui.confirm(
        "Deepwork Task",
        "No task description provided. Run a generic deepwork pipeline?",
        { signal: ctx.signal },
      );
      if (!confirmed) {
        await ctx.ui.confirm(
          "Deepwork Task",
          "Deepwork aborted — no task description provided.",
        );
        return;
      }
      task = "Unspecified task — generic deepwork run";
    }

    if (dryRun) {
      const route = parsedRoute ?? "full";
      const { runId, state } = runDryRun(
        ctx.cwd,
        task,
        route,
        parsedInteractionMode,
        parsedFailurePolicy,
      );

      await ctx.ui.confirm(
        "Deepwork Dry Run Complete",
        `=== RUN ID ===\n${runId}\n\n=== MODE ===\ndry-run\n\n=== ROUTE ===\n${route}\n\n=== INTERACTION MODE ===\n${parsedInteractionMode}\n\n=== FAILURE POLICY ===\n${parsedFailurePolicy}\n\n=== USER TASK ===\n${task}\n\nDry run complete. Simulated artifacts were written to .pipeline/${runId}/ and state.md now points to ${state.next_stage}. No subagents were dispatched and no project files were modified.`,
      );
      return;
    }

    const agentPrep = ensureWorkspaceQrsiAgents(ctx.cwd);
    if (!agentPrep.ok) {
      await ctx.ui.confirm("Deepwork Error", agentPrep.error);
      return;
    }

    const runId = generateRunId();
    const paths = resolveWorkspacePaths(ctx.cwd, runId);

    try {
      fs.mkdirSync(paths.telemetryDir, { recursive: true });
    } catch (e: unknown) {
      const errMsg = describeError(e);
      await ctx.ui.confirm(
        "Deepwork Error",
        `Failed to create pipeline directory: ${errMsg}`,
      );
      return;
    }

    if (isGitAvailable()) {
      const branchResult = tryCreateGitBranch(runId, ctx.cwd);
      if (!branchResult.ok) {
        console.warn(
          `Failed to create git branch qrspi/${runId}: ${branchResult.error ?? "unknown error"}`,
        );
      }
    } else {
      console.warn(
        "git not found in PATH — proceeding without git branching. Pipeline state will be tracked in .pipeline/ files only.",
      );
    }

    const state = makeInitialState(runId, {
      interaction_mode: parsedInteractionMode,
      failure_policy: parsedFailurePolicy,
    });
    const stateYaml = yamlify(state);
    try {
      fs.writeFileSync(paths.statePath, stateYaml, "utf-8");
    } catch (e: unknown) {
      const errMsg = describeError(e);
      await ctx.ui.confirm(
        "Deepwork Error",
        `Failed to write state.md: ${errMsg}`,
      );
      return;
    }

    try {
      fs.writeFileSync(paths.eventsPath, "\n", "utf-8");
    } catch (e: unknown) {
      const errMsg = describeError(e);
      await ctx.ui.confirm(
        "Deepwork Error",
        `Failed to create events.jsonl: ${errMsg}`,
      );
      return;
    }

    const handoff = await handoffToSession(
      pi,
      buildLiveRunHandoffPrompt(
        runId,
        task,
        parsedInteractionMode,
        parsedFailurePolicy,
        agentPrep.discovery,
      ),
    );
    const handoffSummary = handoff.delivered
      ? "The active session was handed off to Deepwork via pi.sendUserMessage()."
      : formatStartHandoffFailure(runId, handoff.error ?? "unknown error");

    await ctx.ui.confirm(
      "Deepwork Started",
      `=== RUN ID ===\n${runId}\n\n=== INTERACTION MODE ===\n${parsedInteractionMode}\n\n=== FAILURE POLICY ===\n${parsedFailurePolicy}\n\n=== USER TASK ===\n${task}\n\n${handoffSummary}`,
    );
  };
}

function createDeepworkResumeHandler(pi: ExtensionAPI): CommandHandler {
  return async (args: Record<string, unknown>, ctx: ExtensionContext) => {
    const runId: string | undefined =
      typeof args["run-id"] === "string" ? args["run-id"] : undefined;

    if (!runId || runId.trim().length === 0) {
      await ctx.ui.confirm(
        "Resume Error",
        "No run ID provided. Usage: /deepwork-resume qrspi-YYYYMMDD-HHMMSS",
      );
      return;
    }

    const statePath = resolveWorkspacePath(ctx.cwd, getStatePath(runId));
    if (!fs.existsSync(statePath)) {
      await ctx.ui.confirm(
        "Resume Error",
        `Run ID "${runId}" not found. Check .pipeline/ for valid run IDs.`,
      );
      return;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(statePath, "utf-8");
    } catch {
      await ctx.ui.confirm(
        "Resume Error",
        `state.md for run "${runId}" is corrupted. Cannot resume.`,
      );
      return;
    }

    const parsed = parseStateYaml(raw);
    if (!parsed) {
      await ctx.ui.confirm(
        "Resume Error",
        `state.md for run "${runId}" is corrupted. Cannot resume.`,
      );
      return;
    }

    if (parsed.next_stage === "done") {
      const title =
        parsed.mode === "dry-run"
          ? "Deepwork Dry Run Complete"
          : "Resume Pipeline";
      const kind =
        parsed.mode === "dry-run" ? "simulated dry run" : "pipeline run";
      await ctx.ui.confirm(
        title,
        `=== RUN ID ===\n${parsed.run_id}\n\n=== MODE ===\n${parsed.mode}\n\n=== ROUTE ===\n${parsed.route}\n\n=== INTERACTION MODE ===\n${parsed.interaction_mode}\n\n=== FAILURE POLICY ===\n${parsed.failure_policy}\n\nThis ${kind} is already complete. There is no next stage to resume.`,
      );
      return;
    }

    const agentPrep = ensureWorkspaceQrsiAgents(ctx.cwd);
    if (!agentPrep.ok) {
      await ctx.ui.confirm("Resume Error", agentPrep.error);
      return;
    }

    const handoff = await handoffToSession(
      pi,
      buildResumeHandoffPrompt(parsed, agentPrep.discovery),
    );
    const handoffSummary = handoff.delivered
      ? "The active session was handed off to Deepwork via pi.sendUserMessage()."
      : formatResumeHandoffFailure(
          parsed.run_id,
          handoff.error ?? "unknown error",
        );

    await ctx.ui.confirm(
      parsed.mode === "dry-run" ? "Resume Dry Run" : "Resume Pipeline",
      `=== RESUME RUN ID ===\n${parsed.run_id}\n\n=== MODE ===\n${parsed.mode}\n\n=== RESUME FROM STAGE ===\nStage ${parsed.next_stage} (last completed: Stage ${parsed.last_completed_stage})\n\n=== ROUTE ===\n${parsed.route}\n\n=== INTERACTION MODE ===\n${parsed.interaction_mode}\n\n=== FAILURE POLICY ===\n${parsed.failure_policy}\n\n${handoffSummary}`,
    );
  };
}

export default function activate(pi: ExtensionAPI): void {
  const runtimePackageRoot = getRuntimePackageRoot(__dirname);
  const skillCompat = ensureRuntimeSkillCompatInstall(__dirname);
  if (skillCompat.error) {
    console.warn(
      `[pi-deepwork] Unable to prepare npm-compatible Deepwork skill path${skillCompat.targetRoot ? ` at ${skillCompat.targetRoot}` : ""}: ${skillCompat.error}`,
    );
  }

  setPi(pi);

  pi.registerCommand("deepwork", {
    description:
      "Start a QRSPI deepwork pipeline or run a simulated dry-run through the stage flow (Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report)",
    getArgumentCompletions: async () => ({
      task: [],
      "dry-run": ["false", "true"],
      route: ["full", "quick-fix"],
      "interaction-mode": ["interactive", "automated"],
      "failure-policy": ["fail-closed", "best-effort"],
    }),
    handler: createDeepworkHandler(pi),
  });

  pi.registerCommand("deepwork-resume", {
    description:
      "Resume a paused or interrupted deepwork pipeline run from the next stage recorded in state.md",
    getArgumentCompletions: async () => ({ "run-id": scanPipelineRunIds() }),
    handler: createDeepworkResumeHandler(pi),
  });

  pi.registerTool(createDispatchTool());
  pi.registerTool(createGetSubagentResultTool());
  pi.registerTool(createQuestionTool());

  pi.on("resources_discover", () => ({
    skillPaths: getDiscoveredSkillPaths(
      path.join(runtimePackageRoot, "skills"),
      skillCompat,
    ),
  }));
}
