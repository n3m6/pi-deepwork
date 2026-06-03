import { detectSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import type { StageModule, StageOutcome, StageRuntime } from "../port/index.js";
import { runQuestionsSubstage } from "./questions.js";
import { runResearchPassSubstage } from "./research-pass.js";
import { writeArtifact } from "./utils.js";

export const researchStage: StageModule = {
  stage: "research",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const filesWritten = await writeSimpleResearchArtifacts(runtime, simpleTask.filePath, simpleTask.content);
      return {
        status: "PASS",
        filesWritten,
        summary: "Simple exact-file research completed deterministically.",
        telemetry: {
          review_rounds: 0,
          terminal_review_state: "clean",
          deterministic_fast_path: "simple-exact-file",
          child_agent_calls: {},
        },
      };
    }

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

async function writeSimpleResearchArtifacts(runtime: StageRuntime, filePath: string, content: string): Promise<string[]> {
  const question = [
    "# Research Questions",
    "",
    `### Q1: Does \`${filePath}\` already exist, and what exact content must be written?`,
    "**Tag**: codebase",
    "**Covers**: AC-1 [file existence]; AC-2 [exact content]",
    "**Answer shape**: Confirm path safety, collision state, and byte-exact content requirement.",
    "**Decision unblocked**: Whether the file can be created directly with exact bytes.",
  ].join("\n");
  const q1 = [
    "## Findings for Q1",
    "",
    "### Summary",
    `The requested path \`${filePath}\` is a safe relative file path for a quick-fix task. The required content is exactly \`${content}\`.`,
    "",
    "### Implementation Fact",
    "Use a byte-preserving write with no implicit trailing newline.",
  ].join("\n");
  const summary = [
    "# Research Summary",
    "",
    "## Overview",
    `This is a simple exact-file quick fix: create \`${filePath}\` with exactly \`${content}\` and no additional bytes.`,
    "",
    "## Constraints and Risks",
    "- The file write must not append a trailing newline.",
    "- No other repository content is required for this task.",
  ].join("\n");
  const ledger = `- Q1: Does \`${filePath}\` already exist, and what exact content must be written? [codebase]`;

  const repo = runtime.services.artifactRepo!;
  await writeArtifact(runtime, { kind: "questions" }, question);
  await writeArtifact(runtime, { kind: "researchFile", name: "q1.md" }, q1);
  await writeArtifact(runtime, { kind: "researchSummary" }, summary);
  await writeArtifact(runtime, { kind: "researchFile", name: "question-ledger.md" }, ledger);
  await writeArtifact(runtime, { kind: "researchOpenQuestions" }, "None.");
  return [
    "questions.md",
    repo.relPath({ kind: "researchFile", name: "q1.md" }),
    "research/summary.md",
    repo.relPath({ kind: "researchFile", name: "question-ledger.md" }),
    "research/open-questions.md",
  ];
}
