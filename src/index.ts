import * as fs from "node:fs";
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
  looksLikeWorkspaceRoot,
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
  ensureRegisteredSubagents,
  getProjectAgentsDir,
  REQUIRED_QRSPI_STAGE_AGENTS,
} from "./subagent-catalog";
import {
  ensureRuntimeSkillCompatInstall,
  getRuntimePackageRoot,
} from "./skill-compat";
import type { SkillCompatInstallResult } from "./skill-compat";
import type {
  ExtensionAPI,
  ExtensionContext,
  CommandHandler,
  ResourcesDiscoverEvent,
  ToolDefinition,
} from "./types/pi-extensions";

type AgentPrepResult =
  | { ok: true; discovery: RuntimeDiscoverySnapshot }
  | { ok: false; error: string };

interface MirrorAttempt {
  cwd: string;
  ok: boolean;
  projectAgentsDir: string;
  mirroredFileCount: number;
  registeredQrspiCount: number;
  error?: string;
  at: string;
}

interface DiagnosticsRecord {
  extensionVersion: string;
  runtimePackageRoot: string;
  bundledSkillPath: string;
  bundledSkillExists: boolean;
  skillCompat: SkillCompatInstallResult & { skillPathReadable?: boolean };
  activateMirror: MirrorAttempt | null;
  lastDiscover: (MirrorAttempt & { reason?: string }) | null;
}

let diagnosticsRecord: DiagnosticsRecord | null = null;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readExtensionVersion(packageRoot: string): string {
  try {
    const raw = fs.readFileSync(
      path.join(packageRoot, "package.json"),
      "utf-8",
    );
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function countMirroredAgentFiles(workspaceRoot: string): number {
  try {
    return fs
      .readdirSync(getProjectAgentsDir(workspaceRoot))
      .filter((fileName) => fileName.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

function runMirrorAttempt(
  workspaceRoot: string,
  extraFields: { reason?: string } = {},
): MirrorAttempt & { reason?: string } {
  const projectAgentsDir = getProjectAgentsDir(workspaceRoot);
  const at = new Date().toISOString();
  try {
    const registration = ensureRegisteredSubagents(
      workspaceRoot,
      REQUIRED_QRSPI_STAGE_AGENTS,
    );
    const mirroredFileCount = countMirroredAgentFiles(workspaceRoot);
    const registeredQrspiCount =
      registration.refreshResult?.agentNames.filter((agentName) =>
        agentName.startsWith("qrspi-"),
      ).length ?? 0;
    const base: MirrorAttempt & { reason?: string } = {
      cwd: workspaceRoot,
      ok: registration.ok,
      projectAgentsDir: registration.projectAgentsDir ?? projectAgentsDir,
      mirroredFileCount,
      registeredQrspiCount,
      at,
    };
    if (!registration.ok && registration.error) {
      base.error = registration.error;
    }
    if (typeof extraFields.reason === "string") {
      base.reason = extraFields.reason;
    }
    return base;
  } catch (e: unknown) {
    const attempt: MirrorAttempt & { reason?: string } = {
      cwd: workspaceRoot,
      ok: false,
      projectAgentsDir,
      mirroredFileCount: countMirroredAgentFiles(workspaceRoot),
      registeredQrspiCount: 0,
      error: describeError(e),
      at,
    };
    if (typeof extraFields.reason === "string") {
      attempt.reason = extraFields.reason;
    }
    return attempt;
  }
}

function formatAgentsBlock(
  prep: AgentPrepResult,
  workspaceRoot: string,
): string {
  if (!prep.ok) {
    return `=== AGENTS ===\nstatus=error\nerror=${prep.error}`;
  }
  const discovery = prep.discovery;
  const mirroredFileCount = countMirroredAgentFiles(workspaceRoot);
  return [
    "=== AGENTS ===",
    `status=ok`,
    `mirrored_files=${mirroredFileCount}`,
    `synced=${discovery.syncedAgents}`,
    `skipped=${discovery.skippedAgents}`,
    `registered_qrspi=${discovery.registeredQrspiAgents.length}`,
    `dir=${discovery.projectAgentsDir}`,
  ].join("\n");
}

function formatRuntimeBlock(branchOutcome: string | null): string {
  const gitLine = isGitAvailable()
    ? (branchOutcome ?? "git=available, branch=created")
    : "git=missing, branch=skipped (pipeline tracked in .pipeline/ files only)";
  const skill = diagnosticsRecord?.skillCompat;
  const skillLine = skill
    ? skill.error
      ? `skill_compat=error (${skill.error})`
      : skill.applied
        ? `skill_compat=${skill.mode ?? "applied"} (${skill.targetRoot ?? "?"})`
        : `skill_compat=not-applied`
    : "skill_compat=unknown";
  return `=== RUNTIME ===\n${gitLine}\n${skillLine}`;
}

function appendBootstrapTelemetry(
  telemetryDir: string,
  payload: Record<string, unknown>,
): void {
  try {
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(
      path.join(telemetryDir, "bootstrap.json"),
      JSON.stringify(payload, null, 2) + "\n",
      "utf-8",
    );
  } catch (e: unknown) {
    console.warn(
      `[pi-deepwork] Failed to write bootstrap telemetry: ${describeError(e)}`,
    );
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

  // Defense-in-depth post-condition: even though `ensureRegisteredSubagents`
  // validates the required set internally, re-read the workspace directory and
  // fail if the file count is below the required floor. This catches cases
  // where the mirror "succeeded" but a concurrent process or filesystem issue
  // produced an empty or partial `.pi/agents/` between calls.
  const mirroredFileCount = countMirroredAgentFiles(workspaceRoot);
  if (mirroredFileCount < REQUIRED_QRSPI_STAGE_AGENTS.length) {
    return {
      ok: false,
      error: `Mirror sanity check failed: only ${mirroredFileCount} agent files under ${registration.projectAgentsDir}; expected at least ${REQUIRED_QRSPI_STAGE_AGENTS.length}.`,
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

  const bundledSkillFile = path.join(bundledSkillsRoot, "deepwork", "SKILL.md");
  if (!fileExists(bundledSkillFile)) {
    console.warn(
      `[pi-deepwork] Bundled SKILL.md not found at ${bundledSkillFile}. pi will still receive the path, but the skill cannot be invoked until the bundle is repaired.`,
    );
  }

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

    let branchOutcome: string | null = null;
    const gitAvailable = isGitAvailable();
    if (gitAvailable) {
      const branchResult = tryCreateGitBranch(runId, ctx.cwd);
      if (branchResult.ok) {
        branchOutcome = `git=available, branch=qrspi/${runId} created`;
      } else {
        branchOutcome = `git=available, branch=qrspi/${runId} failed (${branchResult.error ?? "unknown error"})`;
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

    // Bootstrap telemetry sidecar: written before handoff so post-mortems show
    // whether the extension command path ran agent mirroring + scaffolding,
    // independent of the skill's `events.jsonl` seq counter.
    appendBootstrapTelemetry(paths.telemetryDir, {
      run_id: runId,
      at: new Date().toISOString(),
      cwd: ctx.cwd,
      extension_version: diagnosticsRecord?.extensionVersion ?? "unknown",
      agents: {
        mirrored_files: countMirroredAgentFiles(ctx.cwd),
        synced: agentPrep.discovery.syncedAgents,
        skipped: agentPrep.discovery.skippedAgents,
        registered_qrspi: agentPrep.discovery.registeredQrspiAgents.length,
        dir: agentPrep.discovery.projectAgentsDir,
      },
      runtime: {
        git_available: gitAvailable,
        branch_outcome: branchOutcome,
        skill_compat: diagnosticsRecord?.skillCompat ?? null,
      },
      interaction_mode: parsedInteractionMode,
      failure_policy: parsedFailurePolicy,
    });

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
      `=== RUN ID ===\n${runId}\n\n=== INTERACTION MODE ===\n${parsedInteractionMode}\n\n=== FAILURE POLICY ===\n${parsedFailurePolicy}\n\n=== USER TASK ===\n${task}\n\n${formatAgentsBlock(agentPrep, ctx.cwd)}\n\n${formatRuntimeBlock(branchOutcome)}\n\n${handoffSummary}`,
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
      `=== RESUME RUN ID ===\n${parsed.run_id}\n\n=== MODE ===\n${parsed.mode}\n\n=== RESUME FROM STAGE ===\nStage ${parsed.next_stage} (last completed: Stage ${parsed.last_completed_stage})\n\n=== ROUTE ===\n${parsed.route}\n\n=== INTERACTION MODE ===\n${parsed.interaction_mode}\n\n=== FAILURE POLICY ===\n${parsed.failure_policy}\n\n${formatAgentsBlock(agentPrep, ctx.cwd)}\n\n${handoffSummary}`,
    );
  };
}

function formatDoctorReport(workspaceRoot: string): string {
  const record = diagnosticsRecord;
  const liveMirror = runMirrorAttempt(workspaceRoot, { reason: "doctor" });

  const lines: string[] = [];
  lines.push("=== EXTENSION ===");
  lines.push(`version=${record?.extensionVersion ?? "unknown"}`);
  lines.push(`runtime_package_root=${record?.runtimePackageRoot ?? "unknown"}`);

  lines.push("");
  lines.push("=== BUNDLED SKILL ===");
  lines.push(`path=${record?.bundledSkillPath ?? "unknown"}`);
  lines.push(
    `exists=${record?.bundledSkillExists ? "true" : "false (the bundled SKILL.md is missing; pi cannot invoke the deepwork skill until the install is repaired)"}`,
  );

  lines.push("");
  lines.push("=== SKILL COMPAT ===");
  const skill = record?.skillCompat;
  if (!skill || !skill.applied) {
    lines.push(
      `applied=false${skill?.error ? ` (error: ${skill.error})` : " (not a git-install layout; no compat mirror needed)"}`,
    );
  } else {
    lines.push(`applied=true`);
    lines.push(`mode=${skill.mode ?? "unknown"}`);
    lines.push(`target_root=${skill.targetRoot ?? "unknown"}`);
    lines.push(`skill_path=${skill.skillPath ?? "unknown"}`);
    lines.push(
      `skill_path_readable=${skill.skillPathReadable === false ? "false (compat SKILL.md is missing on disk; rebuild the install)" : "true"}`,
    );
    if (skill.error) {
      lines.push(`error=${skill.error}`);
    }
  }

  lines.push("");
  lines.push("=== AGENTS ===");
  lines.push(`workspace_cwd=${workspaceRoot}`);
  lines.push(`project_agents_dir=${liveMirror.projectAgentsDir}`);
  lines.push(`mirrored_files=${liveMirror.mirroredFileCount}`);
  lines.push(`registered_qrspi=${liveMirror.registeredQrspiCount}`);
  lines.push(`required_qrspi=${REQUIRED_QRSPI_STAGE_AGENTS.length}`);
  lines.push(`status=${liveMirror.ok ? "ok" : "error"}`);
  if (liveMirror.error) {
    lines.push(`error=${liveMirror.error}`);
  }

  lines.push("");
  lines.push("=== GIT ===");
  lines.push(`available=${isGitAvailable() ? "true" : "false"}`);

  lines.push("");
  lines.push("=== LAST DISCOVER EVENT ===");
  if (record?.lastDiscover) {
    lines.push(`at=${record.lastDiscover.at}`);
    lines.push(`cwd=${record.lastDiscover.cwd}`);
    lines.push(`reason=${record.lastDiscover.reason ?? "unknown"}`);
    lines.push(`status=${record.lastDiscover.ok ? "ok" : "error"}`);
    if (record.lastDiscover.error) {
      lines.push(`error=${record.lastDiscover.error}`);
    }
  } else {
    lines.push("(no resources_discover events recorded since activate)");
  }

  lines.push("");
  lines.push("=== LAST ACTIVATE-TIME MIRROR ===");
  if (record?.activateMirror) {
    lines.push(`at=${record.activateMirror.at}`);
    lines.push(`cwd=${record.activateMirror.cwd}`);
    lines.push(`status=${record.activateMirror.ok ? "ok" : "error"}`);
    if (record.activateMirror.error) {
      lines.push(`error=${record.activateMirror.error}`);
    }
  } else {
    lines.push("(diagnostics record not initialized)");
  }

  return lines.join("\n");
}

function createDeepworkDoctorHandler(): CommandHandler {
  return async (_args: Record<string, unknown>, ctx: ExtensionContext) => {
    const report = formatDoctorReport(ctx.cwd);
    const reportPath = path.join(ctx.cwd, ".pi", "deepwork-doctor-report.md");
    let writeNote = `Report also written to ${reportPath} so the assistant can read it.`;
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, report + "\n", "utf-8");
    } catch (e: unknown) {
      writeNote = `Note: failed to write report to ${reportPath} (${describeError(e)}).`;
    }
    await ctx.ui.confirm("Deepwork Doctor", `${report}\n\n${writeNote}`);
  };
}

function formatSkillBlock(): string {
  const skill = diagnosticsRecord?.skillCompat;
  const bundledPath = diagnosticsRecord?.bundledSkillPath ?? "unknown";
  const bundledExists = diagnosticsRecord?.bundledSkillExists
    ? "true"
    : "false";
  const lines = [
    "=== SKILL ===",
    `bundled_path=${bundledPath}`,
    `bundled_exists=${bundledExists}`,
  ];
  if (skill?.applied) {
    lines.push(`compat_mode=${skill.mode ?? "unknown"}`);
    lines.push(`compat_skill_path=${skill.skillPath ?? "unknown"}`);
    lines.push(
      `compat_skill_path_readable=${skill.skillPathReadable === false ? "false" : "true"}`,
    );
  } else {
    lines.push(
      `compat_applied=false${skill?.error ? ` (error: ${skill.error})` : ""}`,
    );
  }
  return lines.join("\n");
}

function createDeepworkBootstrapTool(): ToolDefinition {
  return {
    name: "deepwork_bootstrap",
    label: "Deepwork Bootstrap",
    description:
      "Idempotently mirror the bundled qrspi-* subagents into <workspace>/.pi/agents/ and refresh the pi-subagents registry. Call this FIRST in the deepwork skill pre-flight before any subagent inventory check or stage dispatch. Returns the AGENTS/RUNTIME/SKILL diagnostic blocks. The pi-deepwork extension owns <workspace>/.pi/agents/ — call this tool instead of mirroring manually.",
    parameters: {
      type: "object",
      properties: {
        workspace_cwd: {
          type: "string",
          description:
            "Absolute path to the workspace root. Defaults to ctx.cwd when omitted.",
        },
      },
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal,
      _onUpdate: (update: { content: string }) => void,
      ctx: ExtensionContext,
    ): Promise<{ content: string; details?: Record<string, unknown> }> {
      const rawCwd = params["workspace_cwd"];
      const cwd =
        typeof rawCwd === "string" && rawCwd.trim().length > 0
          ? rawCwd
          : ctx.cwd;

      const attempt = runMirrorAttempt(cwd, {
        reason: "tool:deepwork_bootstrap",
      });
      if (diagnosticsRecord) {
        diagnosticsRecord.lastDiscover = attempt;
      }

      const prep = ensureWorkspaceQrsiAgents(cwd);

      if (!prep.ok) {
        const errorContent = [
          "=== AGENTS ===",
          "status=error",
          `cwd=${cwd}`,
          `mirrored_files=${attempt.mirroredFileCount}`,
          `error=${prep.error}`,
          "",
          formatRuntimeBlock(null),
          "",
          formatSkillBlock(),
        ].join("\n");
        return {
          content: errorContent,
          details: {
            ok: false,
            error: prep.error,
            cwd,
            mirrored_files: attempt.mirroredFileCount,
          },
        };
      }

      const content = [
        formatAgentsBlock(prep, cwd),
        "",
        formatRuntimeBlock(null),
        "",
        formatSkillBlock(),
      ].join("\n");

      return {
        content,
        details: {
          ok: true,
          cwd,
          mirrored_files: countMirroredAgentFiles(cwd),
          synced: prep.discovery.syncedAgents,
          skipped: prep.discovery.skippedAgents,
          registered_qrspi: prep.discovery.registeredQrspiAgents.length,
          project_agents_dir: prep.discovery.projectAgentsDir,
          skill_path: prep.discovery.skillPath,
        },
      };
    },
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

  const bundledSkillPath = path.join(
    runtimePackageRoot,
    "skills",
    "deepwork",
    "SKILL.md",
  );
  const bundledSkillExists = fileExists(bundledSkillPath);
  if (!bundledSkillExists) {
    console.warn(
      `[pi-deepwork] Bundled SKILL.md missing at ${bundledSkillPath}. /deepwork-doctor will report this.`,
    );
  }

  const skillCompatWithReadable: SkillCompatInstallResult & {
    skillPathReadable?: boolean;
  } = { ...skillCompat };
  if (skillCompat.skillPath) {
    skillCompatWithReadable.skillPathReadable = fileExists(
      skillCompat.skillPath,
    );
  }

  // Best-effort agent mirror + registry refresh on activation so qrspi-* agents
  // are visible before the user invokes /deepwork for the first time.
  //
  // IMPORTANT: pi often launches the runtime from a directory that is NOT the
  // active workspace (e.g. `$HOME`). Mirroring to `process.cwd()` in that case
  // pollutes the parent directory with `.pi/agents/` and leaves the real
  // workspace empty. Guard with `looksLikeWorkspaceRoot` and skip otherwise;
  // the `resources_discover` event and the `deepwork_bootstrap` tool will
  // mirror to the correct cwd later.
  const activateCwd = process.cwd();
  let activateMirror: MirrorAttempt & { reason?: string };
  if (looksLikeWorkspaceRoot(activateCwd)) {
    activateMirror = runMirrorAttempt(activateCwd, { reason: "activate" });
    if (!activateMirror.ok && activateMirror.error) {
      console.warn(
        `[pi-deepwork] Best-effort agent registration on activate() failed: ${activateMirror.error}`,
      );
    }
  } else {
    activateMirror = {
      cwd: activateCwd,
      ok: false,
      projectAgentsDir: getProjectAgentsDir(activateCwd),
      mirroredFileCount: 0,
      registeredQrspiCount: 0,
      error:
        "skipped: process.cwd() does not look like a workspace root (no package.json/.git/.pi/etc.); deferring mirror to resources_discover or deepwork_bootstrap tool",
      at: new Date().toISOString(),
      reason: "activate",
    };
  }

  diagnosticsRecord = {
    extensionVersion: readExtensionVersion(runtimePackageRoot),
    runtimePackageRoot,
    bundledSkillPath,
    bundledSkillExists,
    skillCompat: skillCompatWithReadable,
    activateMirror,
    lastDiscover: null,
  };

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

  pi.registerCommand("deepwork-doctor", {
    description:
      "Print a diagnostic report (extension version, resolved paths, agent mirror status, skill compat, git availability, last resources_discover event) without starting or resuming a run. The report is also written to <workspace>/.pi/deepwork-doctor-report.md so the assistant can read it.",
    getArgumentCompletions: async () => ({}),
    handler: createDeepworkDoctorHandler(),
  });

  pi.registerTool(createDeepworkBootstrapTool());

  pi.on("resources_discover", (...args: unknown[]) => {
    // Re-mirror agents and refresh registry on every session start so qrspi-*
    // are visible even when the user invokes the deepwork skill without running
    // the /deepwork slash command first.
    //
    // IMPORTANT: pi runtimes deliver the active workspace `cwd` on the event
    // payload. Falling back to `process.cwd()` mirrors agents to the directory
    // pi was *launched* from, which is frequently not the workspace pi is
    // operating on, leaving `.pi/agents/` empty in the project.
    const event = args[0] as Partial<ResourcesDiscoverEvent> | undefined;
    const eventCwd =
      typeof event?.cwd === "string" && event.cwd.trim().length > 0
        ? event.cwd
        : process.cwd();
    const reason =
      typeof event?.reason === "string" ? event.reason : "resources_discover";
    const attempt = runMirrorAttempt(eventCwd, { reason });
    if (!attempt.ok && attempt.error) {
      console.warn(
        `[pi-deepwork] Best-effort agent registration on resources_discover failed: ${attempt.error}`,
      );
    }
    if (diagnosticsRecord) {
      diagnosticsRecord.lastDiscover = attempt;
    }

    return {
      skillPaths: getDiscoveredSkillPaths(
        path.join(runtimePackageRoot, "skills"),
        skillCompat,
      ),
    };
  });
}
