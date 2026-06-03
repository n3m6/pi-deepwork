import path from "node:path";

import type { StageRuntime } from "../types.js";
import { readArtifact } from "./utils.js";

export async function renderAcceptanceRepairContext(runtime: StageRuntime): Promise<string> {
  if (runtime.state.acceptFixAttempts <= 0) {
    return "";
  }

  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(runtime.state.currentPhase).padStart(2, "0")}`);
  const [coveragePlan, acceptanceResults, stageSummary] = await Promise.all([
    safeRead(path.join(phaseDir, "coverage-plan.md")),
    safeRead(path.join(phaseDir, "acceptance-results.md")),
    safeRead(path.join(phaseDir, "stage8-summary.md")),
  ]);

  return [
    "=== ACCEPTANCE REPAIR CONTEXT ===",
    `This implementation pass is retry ${runtime.state.acceptFixAttempts} after Stage 8 acceptance failed.`,
    "Use the evidence below to repair the current phase while staying within the task specs and existing plan.",
    "",
    "=== COVERAGE PLAN ===",
    coveragePlan,
    "",
    "=== ACCEPTANCE RESULTS ===",
    acceptanceResults,
    "",
    "=== STAGE 8 SUMMARY ===",
    stageSummary,
  ].join("\n");
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "None.";
  }
}
