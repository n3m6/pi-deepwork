import { runSynthesizeReviewGate } from "../workflow/synthesize-review-gate-workflow.js";
import { readArtifact } from "./utils.js";
import type { StageModule, StageOutcome } from "../port/index.js";

export const structureStage: StageModule = {
  stage: "structure",
  async run(runtime): Promise<StageOutcome> {
    const goals = await readArtifact(runtime, { kind: "goals" });
    const requirements = await readArtifact(runtime, { kind: "requirements" });
    const research = await readArtifact(runtime, { kind: "researchSummary" });
    const design = await readArtifact(runtime, { kind: "design" });

    return runSynthesizeReviewGate(runtime, {
      stageName: "structure",
      synthesizerAgent: "qrspi-structure-mapper",
      reviewerAgent: "qrspi-structure-reviewer",
      artifactId: { kind: "structure" },
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
