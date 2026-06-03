import { runSynthesizeReviewGate } from "../application/workflow/synthesize-review-gate-workflow.js";
import { readArtifact } from "./utils.js";
import type { StageModule, StageOutcome, StageRuntime } from "../types.js";

export const structureStage: StageModule = {
  stage: "structure",
  async run(runtime): Promise<StageOutcome> {
    const goals = await readArtifact(runtime.artifacts.goalsFile);
    const requirements = await readArtifact(runtime.artifacts.requirementsFile);
    const research = await readArtifact(runtime.artifacts.researchSummaryFile);
    const design = await readArtifact(runtime.artifacts.designFile);

    return runSynthesizeReviewGate(runtime, {
      stageName: "structure",
      synthesizerAgent: "qrspi-structure-mapper",
      reviewerAgent: "qrspi-structure-reviewer",
      artifactFile: (rt) => rt.artifacts.structureFile,
      reviewsDir: (rt) => rt.artifacts.reviewsDir,
      artifactDisplayName: "structure.md",
      approveLabel: "Approve structure",
      feedbackLabel: "Provide structure feedback",
      feedbackQuestion: "Describe the required structure revisions.",
      buildSynthesizerPrompt: (_ctx, feedbackHistory) =>
        [
          "=== GOALS ===",
          goals,
          "",
          "=== REQUIREMENTS ===",
          requirements,
          "",
          "=== RESEARCH SUMMARY ===",
          research,
          "",
          "=== DESIGN ===",
          design,
          ...(feedbackHistory.length > 0 ? ["\n=== FEEDBACK HISTORY ===", feedbackHistory.join("\n\n")] : []),
        ]
          .filter(Boolean)
          .join("\n"),
      buildReviewerPrompt: (_ctx, artifactText) =>
        [
          "=== GOALS ===",
          goals,
          "",
          "=== REQUIREMENTS ===",
          requirements,
          "",
          "=== RESEARCH SUMMARY ===",
          research,
          "",
          "=== DESIGN ===",
          design,
          "",
          "=== STRUCTURE ===",
          artifactText,
        ].join("\n"),
    }, { runtime });
  },
};
