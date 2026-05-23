import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  generateRunId,
  getTelemetryDir,
  getStatePath,
  getEventsPath,
  makeInitialState,
} from "./pipeline";
import type { PipelineState } from "./pipeline";
import { createDispatchTool, createQuestionTool, setPi } from "./shared-tools";
import type {
  ExtensionAPI,
  ExtensionContext,
  CommandHandler,
} from "./types/pi-extensions";

function yamlify(state: PipelineState): string {
  return `---
run_id: ${state.run_id}
route: "${state.route}"
current_phase: ${state.current_phase}
total_phases: ${state.total_phases}
last_completed_stage: "${state.last_completed_stage}"
next_stage: "${state.next_stage}"
stages_completed: []
phase_history: []
backward_loops: ${state.backward_loops}
resume_source: "${state.resume_source}"
---
`;
}

function parseStateYaml(raw: string): {
  run_id: string;
  next_stage: string;
  last_completed_stage: string;
  route: string;
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
  if (!map.run_id || !map.next_stage || !map.last_completed_stage || map.route === undefined) {
    return null;
  }
  return {
    run_id: map.run_id,
    next_stage: map.next_stage,
    last_completed_stage: map.last_completed_stage,
    route: map.route,
  };
}

function isGitAvailable(): boolean {
  try {
    const result = spawnSync("git", ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function tryCreateGitBranch(runId: string): { ok: boolean; error?: string } {
  try {
    const result = spawnSync("git", ["checkout", "-b", `qrspi/${runId}`, "main"], {
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      const err = (result.stderr ?? result.stdout ?? "").trim();
      return { ok: false, error: err || `git checkout exited with status ${result.status}` };
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

const deepworkHandler: CommandHandler = async (
  args: Record<string, unknown>,
  ctx: ExtensionContext
) => {
  let task: string | undefined = typeof args.task === "string" ? args.task : undefined;

  if (!task || task.trim().length === 0) {
    const confirmed = await ctx.ui.confirm(
      "Deepwork Task",
      "No task description provided. Run a generic deepwork pipeline?",
      { signal: ctx.signal }
    );
    if (!confirmed) {
      await ctx.ui.confirm("Deepwork Task", "Deepwork aborted — no task description provided.");
      return;
    }
    task = "Unspecified task — generic deepwork run";
  }

  const runId = generateRunId();
  const telemetryDir = getTelemetryDir(runId);

  try {
    fs.mkdirSync(telemetryDir, { recursive: true });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await ctx.ui.confirm("Deepwork Error", `Failed to create pipeline directory: ${errMsg}`);
    return;
  }

  if (isGitAvailable()) {
    const branchResult = tryCreateGitBranch(runId);
    if (!branchResult.ok) {
      console.warn(
        `Failed to create git branch qrspi/${runId}: ${branchResult.error ?? "unknown error"}`
      );
    }
  } else {
    console.warn(
      "git not found in PATH — proceeding without git branching. Pipeline state will be tracked in .pipeline/ files only."
    );
  }

  const state = makeInitialState(runId);
  const stateYaml = yamlify(state);
  try {
    fs.writeFileSync(getStatePath(runId), stateYaml, "utf-8");
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await ctx.ui.confirm("Deepwork Error", `Failed to write state.md: ${errMsg}`);
    return;
  }

  try {
    fs.writeFileSync(getEventsPath(runId), "\n", "utf-8");
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await ctx.ui.confirm("Deepwork Error", `Failed to create events.jsonl: ${errMsg}`);
    return;
  }

  await ctx.ui.confirm(
    "Deepwork Started",
    `=== RUN ID ===\n${runId}\n\n=== USER TASK ===\n${task}\n\nDeepwork pipeline starting. Stage 1 (Goals) will begin.`
  );
};

const deepworkResumeHandler: CommandHandler = async (
  args: Record<string, unknown>,
  ctx: ExtensionContext
) => {
  const runId: string | undefined = typeof args["run-id"] === "string" ? args["run-id"] : undefined;

  if (!runId || runId.trim().length === 0) {
    await ctx.ui.confirm(
      "Resume Error",
      "No run ID provided. Usage: /deepwork-resume qrspi-YYYYMMDD-HHMMSS"
    );
    return;
  }

  const statePath = getStatePath(runId);
  if (!fs.existsSync(statePath)) {
    await ctx.ui.confirm(
      "Resume Error",
      `Run ID "${runId}" not found. Check .pipeline/ for valid run IDs.`
    );
    return;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(statePath, "utf-8");
  } catch (e: unknown) {
    await ctx.ui.confirm(
      "Resume Error",
      `state.md for run "${runId}" is corrupted. Cannot resume.`
    );
    return;
  }

  const parsed = parseStateYaml(raw);
  if (!parsed) {
    await ctx.ui.confirm(
      "Resume Error",
      `state.md for run "${runId}" is corrupted. Cannot resume.`
    );
    return;
  }

  await ctx.ui.confirm(
    "Resume Pipeline",
    `=== RESUME RUN ID ===\n${parsed.run_id}\n\n=== RESUME FROM STAGE ===\nStage ${parsed.next_stage} (last completed: Stage ${parsed.last_completed_stage})\n\n=== ROUTE ===\n${parsed.route}\n\nResuming deepwork pipeline. The orchestrator will pick up from the recorded next stage.`
  );
};

export default function activate(pi: ExtensionAPI): void {
  setPi(pi);

  pi.registerCommand("deepwork", {
    description:
      "Start a full QRSPI deepwork pipeline through all 11 stages (Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report)",
    getArgumentCompletions: async () => ({ task: [] }),
    handler: deepworkHandler,
  });

  pi.registerCommand("deepwork-resume", {
    description:
      "Resume a paused or interrupted deepwork pipeline run from the next stage recorded in state.md",
    getArgumentCompletions: async () => ({ "run-id": scanPipelineRunIds() }),
    handler: deepworkResumeHandler,
  });

  pi.registerTool(createDispatchTool());
  pi.registerTool(createQuestionTool());

  pi.on("resources_discover", () => ({
    skillPaths: [path.join(__dirname, "..", "skills")],
  }));
}
