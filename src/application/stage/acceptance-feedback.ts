import type { StageRuntime } from "../port/index.js";

export async function renderAcceptanceRepairContext(runtime: StageRuntime): Promise<string> {
  if (runtime.state.acceptFixAttempts <= 0) {
    return "";
  }

  const phase = runtime.state.currentPhase;
  const repo = runtime.services.artifactRepo!;
  const [coveragePlan, acceptanceResults, stageSummary] = await Promise.all([
    repo.read({ kind: "phaseFile", phase, name: "coverage-plan.md" }),
    repo.read({ kind: "phaseFile", phase, name: "acceptance-results.md" }),
    repo.read({ kind: "phaseFile", phase, name: "stage8-summary.md" }),
  ]);

  return [
    "=== ACCEPTANCE REPAIR CONTEXT ===",
    `This implementation pass is retry ${runtime.state.acceptFixAttempts} after Stage 8 acceptance failed.`,
    "Use the evidence below to repair the current phase while staying within the task specs and existing plan.",
    "",
    "=== COVERAGE PLAN ===",
    coveragePlan ?? "None.",
    "",
    "=== ACCEPTANCE RESULTS ===",
    acceptanceResults ?? "None.",
    "",
    "=== STAGE 8 SUMMARY ===",
    stageSummary ?? "None.",
  ].join("\n");
}
