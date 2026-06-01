import { readFile } from "node:fs/promises";
import path from "node:path";

import type { StageOutcome, StageRuntime } from "../types.js";
import { writeArtifact } from "./utils.js";

export async function runBaselineRegressionSubstage(runtime: StageRuntime, phase: number): Promise<StageOutcome> {
  const packageJson = await readPackageJson(runtime.artifacts.workspaceRoot);
  const commands: Array<{ label: string; script: string }> = [];
  if (packageJson?.scripts?.build) {
    commands.push({ label: "Build", script: "build" });
  }
  if (packageJson?.scripts?.lint) {
    commands.push({ label: "Lint", script: "lint" });
  }
  if (packageJson?.scripts?.typecheck) {
    commands.push({ label: "Typecheck", script: "typecheck" });
  }
  if (packageJson?.scripts?.test) {
    commands.push({ label: "Tests", script: "test" });
  }

  const rows: string[] = [];
  let overall: StageOutcome["status"] = "PASS";
  for (const command of commands) {
    const result = await runtime.services.pi.exec("npm", ["run", command.script], {
      cwd: runtime.artifacts.workspaceRoot,
      timeout: 120_000,
      ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
    });
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

async function readPackageJson(workspaceRoot: string): Promise<{ scripts?: Record<string, string> } | undefined> {
  try {
    const raw = await readFile(path.join(workspaceRoot, "package.json"), "utf8");
    return JSON.parse(raw) as { scripts?: Record<string, string> };
  } catch {
    return undefined;
  }
}
