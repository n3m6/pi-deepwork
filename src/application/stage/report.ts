import { parseKeyValueLines } from "../../infrastructure/codec/markdown-codec.js";
import { detectSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import type { StageModule, StageOutcome, StageRuntime } from "../port/index.js";
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
      await writeArtifact(runtime, { kind: "stage10Summary" }, report);
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

    const config = await readArtifact(runtime, { kind: "config" });
    const goals = await readArtifact(runtime, { kind: "goals" });
    const baseline = await readArtifact(runtime, { kind: "baselineResults" });
    const verification = await readArtifact(runtime, { kind: "stage9Summary" });
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

    await writeArtifact(runtime, { kind: "stage10Summary" }, report.text);
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
  const repo = runtime.services.artifactRepo!;
  const phases = await repo.listPhases();
  const blocks: string[] = [];
  for (const phase of phases) {
    const label = `phase-${String(phase).padStart(2, "0")}`;
    blocks.push(
      [
        `## ${label}`,
        `### Implementation`,
        (await repo.read({ kind: "phaseFile", phase, name: "stage7-summary.md" })) ?? "N/A",
        "",
        `### Integration`,
        (await repo.read({ kind: "phaseFile", phase, name: "stage7-integration-summary.md" })) ?? "N/A",
        "",
        `### Acceptance`,
        (await repo.read({ kind: "phaseFile", phase, name: "stage8-summary.md" })) ?? "N/A",
        "",
        `### Replan`,
        (await repo.read({ kind: "phaseFile", phase, name: `replan/${label}-replan.md` })) ?? "N/A",
        "",
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}
