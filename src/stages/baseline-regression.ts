import path from "node:path";

import type { BuildToolPort, StageOutcome, StageRuntime } from "../types.js";
import { writeArtifact } from "./utils.js";

const BASELINE_SCRIPTS = [
  { label: "Build", script: "build" },
  { label: "Lint", script: "lint" },
  { label: "Typecheck", script: "typecheck" },
  { label: "Tests", script: "test" },
] as const;

export async function runBaselineRegressionSubstage(runtime: StageRuntime, phase: number): Promise<StageOutcome> {
  const buildTool = requireBuildTool(runtime);
  const cwd = runtime.artifacts.workspaceRoot;
  const available = new Set(await buildTool.availableScripts(cwd));
  const commands = BASELINE_SCRIPTS.filter((cmd) => available.has(cmd.script));

  const rows: string[] = [];
  let overall: StageOutcome["status"] = "PASS";

  for (const command of commands) {
    const result = await buildTool.runScript(command.script, cwd);
    const status = result.code === 0 ? "PASS" : "FAIL";
    if (status === "FAIL") {
      overall = "FAIL";
    }
    rows.push(`| ${command.label} | ${status} | \`npm run ${command.script}\` |`);
  }

  if (rows.length === 0) {
    rows.push("| Checks | NOT CONFIGURED | None. |");
  }

  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  const filePath = path.join(phaseDir, "regression-results.md");
  const markdown = [
    `### Status — ${overall}`,
    "",
    "| Check | Status | Command |",
    "| ----- | ------ | ------- |",
    ...rows,
  ].join("\n");
  await writeArtifact(filePath, markdown);

  return {
    status: overall,
    filesWritten: [path.relative(runtime.artifacts.runDir, filePath)],
    summary: `Baseline regression check ${overall.toLowerCase()}.`,
  };
}

function requireBuildTool(runtime: StageRuntime): BuildToolPort {
  if (!runtime.services.buildTool) {
    throw new Error("BuildToolPort is not wired; ensure the composition root initialises it.");
  }
  return runtime.services.buildTool;
}
