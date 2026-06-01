import path from "node:path";

import { parseMarkdownSections } from "../markdown.js";
import type { BackwardLoopClassification, StageModule, StageOutcome, StageRuntime } from "../types.js";
import { readArtifact } from "./utils.js";
import { runAcceptanceTesterSubstage } from "./acceptance-tester.js";
import { dispatchLeaf } from "./utils.js";

export const acceptStage: StageModule = {
  stage: "accept",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const phase = runtime.state.currentPhase;
    const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    const acceptance = await runAcceptanceTesterSubstage(runtime);
    const acceptanceResults = await safeRead(path.join(phaseDir, "acceptance-results.md"));
    const coveragePlan = await safeRead(path.join(phaseDir, "coverage-plan.md"));

    if (acceptance.status === "PASS") {
      return {
        status: "PASS",
        phase,
        filesWritten: acceptance.filesWritten,
        summary: "Acceptance coverage and phase validation succeeded.",
        telemetry: {
          ...acceptance.telemetry,
          child_agent_calls: {
            "qrspi-coverage-planner": 1,
          },
        },
      };
    }

    const detector = await dispatchLeaf(
      runtime,
      "qrspi-backward-loop-detector",
      [
        "=== GOALS ===",
        await readArtifact(runtime.artifacts.goalsFile),
        "",
        "=== EXECUTION MANIFEST ===",
        await safeRead(path.join(phaseDir, "execution-manifest.md")),
        "",
        "=== INTEGRATION RESULTS ===",
        await safeRead(path.join(phaseDir, "integration-results.md")),
        "",
        "=== DESIGN CONTEXT ===",
        runtime.state.route === "full" ? await safeRead(runtime.artifacts.designFile) : "N/A",
        "",
        "=== STRUCTURE CONTEXT ===",
        runtime.state.route === "full" ? await safeRead(runtime.artifacts.structureFile) : "N/A",
        "",
        "=== COVERAGE PLAN ===",
        coveragePlan,
        "",
        "=== ACCEPTANCE RESULTS ===",
        acceptanceResults,
        "",
        "=== PERSISTENT FAILURES ===",
        acceptance.summary,
        "",
        "=== CURRENT PHASE ===",
        String(phase),
        "",
        "=== PHASE MANIFEST ===",
        await readArtifact(runtime.artifacts.phaseManifestFile),
        "",
        "=== COMPLETED PHASE SUMMARIES ===",
        "None.",
      ].join("\n"),
    );

    const sections = parseMarkdownSections(detector.text);
    const recommendation = sections["Overall Recommendation"]?.trim() as BackwardLoopClassification | "NO_LOOP" | "DEFER_REPLAN" | undefined;
    const backwardLoop =
      recommendation && recommendation !== "NO_LOOP"
        ? {
            classification: recommendation as BackwardLoopClassification,
            summary: sections.Rationale ?? acceptance.summary,
            guidance: sections["Backward Loop Request"] ?? detector.text,
          }
        : undefined;

    return {
      status: "FAIL",
      phase,
      filesWritten: acceptance.filesWritten,
      summary: acceptance.summary,
      ...(acceptance.telemetry ? { telemetry: acceptance.telemetry } : {}),
      ...(backwardLoop ? { backwardLoop } : {}),
    };
  },
};

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "None.";
  }
}
