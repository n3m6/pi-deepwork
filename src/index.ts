import * as path from "node:path";

import {
  createDirectory,
  fileExists,
  readTextFile,
  writeTextFile,
} from "./adapters/node/file-system";
import { isGitAvailable, tryCreateGitBranch } from "./adapters/node/git-cli";
import { scanPipelineRunIds } from "./adapters/node/pipeline-runs";
import {
  resolveWorkspacePath,
  resolveWorkspacePaths,
} from "./adapters/node/workspace-paths";
import { handoffToSession } from "./adapters/pi/runtime-handoff";
import {
  parseDryRunArg,
  parseFailurePolicyArg,
  parseInteractionModeArg,
  parseRouteArg,
} from "./application/command-args";
import {
  buildLiveRunHandoffPrompt,
  buildResumeHandoffPrompt,
  formatResumeHandoffFailure,
  formatStartHandoffFailure,
} from "./application/handoff-prompts";
import type { RuntimeDiscoverySnapshot } from "./application/handoff-prompts";
import { parseStateYaml, yamlify } from "./application/pipeline-state-codec";
import { runDryRun } from "./application/use-cases/run-dry-run";
import { generateRunId, getStatePath, makeInitialState } from "./pipeline";
import {
  createDispatchTool,
  createGetSubagentResultTool,
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

type AgentPrepResult =
  | { ok: true; discovery: RuntimeDiscoverySnapshot }
  | { ok: false; error: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  if (skillCompat.skillPath && fileExists(skillCompat.skillPath)) {
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
        {
          workspaceRoot: ctx.cwd,
          task,
          route,
          interactionMode: parsedInteractionMode,
          failurePolicy: parsedFailurePolicy,
        },
        {
          createDirectory,
          writeTextFile,
          resolveWorkspacePath,
          resolveWorkspacePaths,
          generateRunId,
        },
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
      createDirectory(paths.telemetryDir);
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
      writeTextFile(paths.statePath, stateYaml);
    } catch (e: unknown) {
      const errMsg = describeError(e);
      await ctx.ui.confirm(
        "Deepwork Error",
        `Failed to write state.md: ${errMsg}`,
      );
      return;
    }

    try {
      writeTextFile(paths.eventsPath, "\n");
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
    if (!fileExists(statePath)) {
      await ctx.ui.confirm(
        "Resume Error",
        `Run ID "${runId}" not found. Check .pipeline/ for valid run IDs.`,
      );
      return;
    }

    let raw: string;
    try {
      raw = readTextFile(statePath);
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

  pi.on("resources_discover", () => ({
    skillPaths: getDiscoveredSkillPaths(
      path.join(runtimePackageRoot, "skills"),
      skillCompat,
    ),
  }));
}
