import { runSynthesizeReviewGate } from "../application/workflow/synthesize-review-gate-workflow.js";
import { readArtifact } from "./utils.js";
import type { StageModule, StageOutcome, StageRuntime } from "../types.js";

export const designStage: StageModule = {
  stage: "design",
  async run(runtime): Promise<StageOutcome> {
    const goals = await readArtifact(runtime.artifacts.goalsFile);
    const requirements = await readArtifact(runtime.artifacts.requirementsFile);
    const research = await readArtifact(runtime.artifacts.researchSummaryFile);

    return runSynthesizeReviewGate(runtime, {
      stageName: "design",
      synthesizerAgent: "qrspi-design-synthesizer",
      reviewerAgent: "qrspi-design-reviewer",
      artifactFile: (rt) => rt.artifacts.designFile,
      reviewsDir: (rt) => rt.artifacts.reviewsDir,
      artifactDisplayName: "design.md",
      approveLabel: "Approve design",
      feedbackLabel: "Provide design feedback",
      feedbackQuestion: "Describe the required design revisions.",
      buildSynthesizerPrompt: (ctx, feedbackHistory) =>
        [
          "=== GOALS ===",
          goals,
          "",
          "=== REQUIREMENTS ===",
          requirements,
          "",
          "=== RESEARCH SUMMARY ===",
          research,
          ...(typeof ctx["designDiscussion"] === "string"
            ? ["", "=== DESIGN DISCUSSION ===", ctx["designDiscussion"]]
            : []),
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
          artifactText,
        ].join("\n"),
    }, { runtime });
  },
};
