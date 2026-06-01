import { parseMarkdownSections } from "../markdown.js";
import type { StageRuntime } from "../types.js";
import { dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

export interface QuestionBatchResult {
  status: "PASS" | "FAIL";
  questionsMarkdown: string;
  filesWritten: string[];
  reviewRounds: number;
}

export async function runQuestionsSubstage(runtime: StageRuntime): Promise<QuestionBatchResult> {
  const goals = await readArtifact(runtime.artifacts.goalsFile);
  const requirements = await readArtifact(runtime.artifacts.requirementsFile);
  const inventory = buildGoalInventory(goals);
  const filesWritten: string[] = [];

  await writeArtifact(`${runtime.artifacts.runDir}/goal-inventory.md`, inventory);
  filesWritten.push("goal-inventory.md");

  let reviewRound = 1;
  let feedback = "";
  while (reviewRound <= 3) {
    const generated = await dispatchLeaf(
      runtime,
      "qrspi-question-generator",
      [
        "=== MODE ===",
        "initial",
        "",
        "=== BATCH LABEL ===",
        `round-${String(reviewRound).padStart(2, "0")}`,
        "",
        "=== GOALS ===",
        goals,
        "",
        "=== REQUIREMENTS ===",
        requirements,
        "",
        "=== NORMALIZED GOAL INVENTORY ===",
        inventory,
        feedback ? "\n=== REVIEW FEEDBACK ===" : "",
        feedback || "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    await writeArtifact(runtime.artifacts.researchQuestionsFile, generated.text);

    const signal = runtime.services.eventContext.signal;
    const reviewResults = await runtime.services.dispatcher.dispatchParallel([
      {
        target: runtime.services.agentDefinitions.get("qrspi-question-leakage-reviewer")!,
        prompt: generated.text,
        cwd: runtime.artifacts.workspaceRoot,
        ...(signal ? { signal } : {}),
      },
      {
        target: runtime.services.agentDefinitions.get("qrspi-question-quality-reviewer")!,
        prompt: [
          "=== GOALS ===",
          goals,
          "",
          "=== INVENTORY ===",
          inventory,
          "",
          "=== QUESTIONS ===",
          generated.text,
        ].join("\n"),
        cwd: runtime.artifacts.workspaceRoot,
        ...(signal ? { signal } : {}),
      },
    ]);
    const leakage = reviewResults[0];
    const quality = reviewResults[1];
    if (!leakage || !quality) {
      return {
        status: "FAIL",
        questionsMarkdown: generated.text,
        filesWritten,
        reviewRounds: reviewRound,
      };
    }

    await writeArtifact(`${runtime.artifacts.runDir}/question-leakage-review.md`, leakage.text);
    await writeArtifact(`${runtime.artifacts.runDir}/question-quality-review.md`, quality.text);
    filesWritten.push("questions.md", "question-leakage-review.md", "question-quality-review.md");

    if (parseReviewStatus(leakage.text) === "PASS" && parseReviewStatus(quality.text) === "PASS") {
      return {
        status: "PASS",
        questionsMarkdown: generated.text,
        filesWritten,
        reviewRounds: reviewRound,
      };
    }

    feedback = [
      "### Leakage Review",
      leakage.text,
      "",
      "### Quality Review",
      quality.text,
    ].join("\n");
    reviewRound += 1;
  }

  return {
    status: "FAIL",
    questionsMarkdown: await readArtifact(runtime.artifacts.researchQuestionsFile),
    filesWritten,
    reviewRounds: 3,
  };
}

function buildGoalInventory(goalsMarkdown: string): string {
  const sections = parseMarkdownSections(goalsMarkdown);
  return [
    renderInventorySection("FR", sections["Functional Requirements"]),
    renderInventorySection("NFR", sections["Non-Functional Requirements"]),
    renderInventorySection("C", sections["Constraints"]),
    renderInventorySection("AC", sections["Acceptance Criteria"], true),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function renderInventorySection(prefix: string, body: string | undefined, numbered = false): string {
  if (!body) {
    return "";
  }
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || (numbered && /^\d+\./.test(line)));
  return lines.map((line, index) => `${prefix}-${index + 1}: ${line.replace(/^[-\d.\s]+/, "").trim()}`).join("\n");
}
