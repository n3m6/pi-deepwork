import { getPipelineDir } from "./paths";
import { getRouteStages } from "./stages";
import type { ExecutableRoute } from "./state";

const DRY_RUN_STAGE_ARTIFACTS: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    goals: ["config.md", "requirements.md", "goals.md", "goal-inventory.md"],
    research: [
      "goal-inventory.md",
      "questions.md",
      "question-leakage-review.md",
      "question-quality-review.md",
      "research/iterations/round-01/questions.md",
      "research/iterations/round-01/q-01.md",
      "research/iterations/round-01/summary.md",
      "research/question-ledger.md",
      "research/open-questions.md",
      "research/summary.md",
      "reviews/research/round-01/research-pass-review-round-01.md",
      "reviews/research-review-round-01.md",
    ],
    design: ["design.md"],
    structure: ["structure.md"],
    plan: ["plan.md", "phase-manifest.md", "baseline-results.md"],
    implement: [
      "phases/phase-01/execution-manifest.md",
      "phases/phase-01/stage7-summary.md",
    ],
    accept: [
      "phases/phase-01/acceptance-results.md",
      "phases/phase-01/stage8-summary.md",
    ],
    replan: ["phases/phase-01/replan/phase-01-replan.md"],
    verify: ["stage9-summary.md"],
    report: [
      "stage10-summary.md",
      "telemetry/run-log.md",
      "telemetry/metrics-summary.md",
    ],
  };

export function getDryRunStageArtifactPaths(
  runId: string,
  stage: string,
): string[] {
  const artifacts = DRY_RUN_STAGE_ARTIFACTS[stage.toLowerCase()] ?? [];
  return artifacts.map((artifact) => `${getPipelineDir(runId)}/${artifact}`);
}

export function getDryRunArtifactPaths(
  runId: string,
  route: ExecutableRoute,
): string[] {
  const artifactPaths = new Set<string>();

  for (const stage of getRouteStages(route)) {
    for (const artifact of getDryRunStageArtifactPaths(runId, stage)) {
      artifactPaths.add(artifact);
    }
  }

  return [...artifactPaths];
}
