import type { StageModule, StageOutcome, StageRuntime } from "../types.js";
import { runQuestionsSubstage } from "./questions.js";
import { runResearchPassSubstage } from "./research-pass.js";

export const researchStage: StageModule = {
  stage: "research",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const questions = await runQuestionsSubstage(runtime);
    if (questions.status === "FAIL") {
      return {
        status: "FAIL",
        filesWritten: questions.filesWritten,
        summary: questions.summary ?? "Question generation/review did not converge; research cannot continue without approved questions.",
        telemetry: {
          review_rounds: questions.reviewRounds,
        },
      };
    }

    const researchPass = await runResearchPassSubstage(runtime, questions.questionsMarkdown);
    if (researchPass.status === "FAIL") {
      return {
        status: "FAIL",
        filesWritten: [...questions.filesWritten, ...researchPass.filesWritten],
        summary: researchPass.summary ?? "Research synthesis/review did not converge.",
        telemetry: {
          review_rounds: researchPass.reviewRounds,
          ...(researchPass.dispatchFailure ? {} : { terminal_review_state: "unclean-cap" as const }),
          child_agent_calls: {
            "qrspi-question-generator": 1,
            "qrspi-codebase-researcher": 1,
            "qrspi-web-researcher": 1,
          },
        },
      };
    }

    return {
      status: "PASS",
      filesWritten: [...questions.filesWritten, ...researchPass.filesWritten],
      summary: "Research questions, findings, and synthesized summary are complete.",
      telemetry: {
        review_rounds: Math.max(questions.reviewRounds, researchPass.reviewRounds),
        terminal_review_state: "clean",
        child_agent_calls: {
          "qrspi-question-generator": 1,
          "qrspi-question-leakage-reviewer": 1,
          "qrspi-question-quality-reviewer": 1,
          "qrspi-codebase-researcher": 1,
          "qrspi-web-researcher": 1,
          "qrspi-research-synthesizer": 1,
          "qrspi-research-reviewer": researchPass.reviewRounds,
        },
      },
    };
  },
};
