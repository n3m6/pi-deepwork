import { readFile } from "node:fs/promises";
import path from "node:path";

import type { StageOutcome, StageRuntime } from "../types.js";
import { writeArtifact } from "./utils.js";

export interface RegressionCheckResult {
  outcome: StageOutcome;
  markdown: string;
}

export async function runE2ERegressionSubstage(runtime: StageRuntime, phase: number): Promise<RegressionCheckResult> {
  const packageJson = await readPackageJson(runtime.artifacts.workspaceRoot);
  const scriptName = packageJson?.scripts?.["test:e2e"] ? "test:e2e" : packageJson?.scripts?.e2e ? "e2e" : undefined;
  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  const filePath = path.join(phaseDir, "e2e-regression-results.md");

  if (!scriptName) {
    const markdown = [
      "### Status — PASS",
      "### E2E — NOT CONFIGURED",
      "No e2e script is defined in package.json.",
    ].join("\n");
    await writeArtifact(filePath, markdown);
    return {
      markdown,
      outcome: {
        status: "PASS",
        filesWritten: [path.relative(runtime.artifacts.runDir, filePath)],
        summary: "No e2e regression script is configured.",
      },
    };
  }

  const result = await runtime.services.pi.exec("npm", ["run", scriptName], {
    cwd: runtime.artifacts.workspaceRoot,
    timeout: 120_000,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
  });
  const status = result.code === 0 ? "PASS" : "FAIL";
  const markdown = [
    `### Status — ${status}`,
    `### E2E — ${status}`,
    "```text",
    [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    "```",
  ].join("\n");
  await writeArtifact(filePath, markdown);

  return {
    markdown,
    outcome: {
      status,
      filesWritten: [path.relative(runtime.artifacts.runDir, filePath)],
      summary: `E2E regression check ${status.toLowerCase()}.`,
    },
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
