import { readdir } from "node:fs/promises";
import path from "node:path";

import { parseKeyValueLines } from "../markdown.js";
import { detectSimpleExactFileTask } from "../simple-file-task.js";
import type { StageModule, StageOutcome, StageRuntime } from "../types.js";
import { dispatchLeaf, readArtifact, writeArtifact } from "./utils.js";

export const reportStage: StageModule = {
  stage: "report",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const report = [
        "## QRSPI Pipeline Complete",
        "",
        "### Overall Status: PASS",
        "",
        `Created \`${simpleTask.filePath}\` with exactly \`${simpleTask.content}\`.`,
      ].join("\n");
      await writeArtifact(runtime.artifacts.stage10SummaryFile, report);
      return {
        status: "PASS",
        filesWritten: ["stage10-summary.md"],
        summary: "Final report generated deterministically.",
        reportContent: report,
        route: "quick-fix",
        telemetry: {
          deterministic_fast_path: "simple-exact-file",
        },
      };
    }

    const config = await readArtifact(runtime.artifacts.configFile);
    const goals = await readArtifact(runtime.artifacts.goalsFile);
    const baseline = await readArtifact(runtime.artifacts.baselineResultsFile);
    const verification = await readArtifact(runtime.artifacts.stage9SummaryFile);
    const perPhase = await readPerPhaseResults(runtime);

    const report = await dispatchLeaf(
      runtime,
      "qrspi-reporter",
      [
        "=== CONFIG ===",
        config,
        "",
        "=== GOALS ===",
        goals,
        "",
        "=== BASELINE RESULTS ===",
        baseline,
        "",
        "=== PER-PHASE RESULTS ===",
        perPhase,
        "",
        "=== VERIFICATION RESULT ===",
        verification,
      ].join("\n"),
    );

    await writeArtifact(runtime.artifacts.stage10SummaryFile, report.text);
    const route = parseKeyValueLines(config).route ?? runtime.state.route;
    return {
      status: "PASS",
      filesWritten: ["stage10-summary.md"],
      summary: "Final report generated.",
      reportContent: report.text,
      route: route === "quick-fix" ? "quick-fix" : route === "unknown" ? "unknown" : "full",
    };
  },
};

async function readPerPhaseResults(runtime: StageRuntime): Promise<string> {
  const phases = await readdir(runtime.artifacts.phasesDir).catch(() => []);
  const directories = phases.filter((entry) => /^phase-\d+$/i.test(entry)).sort();
  const blocks: string[] = [];
  for (const phase of directories) {
    const phaseDir = path.join(runtime.artifacts.phasesDir, phase);
    blocks.push(
      [
        `## ${phase}`,
        `### Implementation`,
        await safeRead(path.join(phaseDir, "stage7-summary.md")),
        "",
        `### Integration`,
        await safeRead(path.join(phaseDir, "stage7-integration-summary.md")),
        "",
        `### Acceptance`,
        await safeRead(path.join(phaseDir, "stage8-summary.md")),
        "",
        `### Replan`,
        await safeRead(path.join(phaseDir, "replan", `${phase}-replan.md`)),
        "",
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "N/A";
  }
}
