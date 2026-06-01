import path from "node:path";

import { dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";
import type { StageRuntime } from "../types.js";

interface ResearchQuestion {
  id: string;
  title: string;
  tag: "codebase" | "web" | "hybrid";
}

export interface ResearchPassResult {
  status: "PASS" | "FAIL";
  filesWritten: string[];
  reviewRounds: number;
}

export async function runResearchPassSubstage(runtime: StageRuntime, questionsMarkdown: string): Promise<ResearchPassResult> {
  const filesWritten: string[] = [];
  const questions = parseQuestions(questionsMarkdown);

  for (const question of questions) {
    const findings: string[] = [];
    if (question.tag === "codebase" || question.tag === "hybrid") {
      const codebase = await dispatchLeaf(
        runtime,
        "qrspi-codebase-researcher",
        [`=== QUESTION ===`, `${question.id}: ${question.title}`].join("\n"),
      );
      findings.push(codebase.text);
    }
    if (question.tag === "web" || question.tag === "hybrid") {
      const web = await dispatchLeaf(
        runtime,
        "qrspi-web-researcher",
        [`=== QUESTION ===`, `${question.id}: ${question.title}`].join("\n"),
      );
      findings.push(web.text);
    }

    const questionFile = path.join(runtime.artifacts.researchDir, `${question.id.toLowerCase()}.md`);
    await writeArtifact(questionFile, findings.join("\n\n"));
    filesWritten.push(path.relative(runtime.artifacts.runDir, questionFile));
  }

  const summary = await dispatchLeaf(
    runtime,
    "qrspi-research-synthesizer",
    questions
      .map((question) => path.join(runtime.artifacts.researchDir, `${question.id.toLowerCase()}.md`))
      .map((filePath) => path.relative(runtime.artifacts.runDir, filePath))
      .join("\n"),
  );
  if (/### Status\s+[—-]\s+FAIL\b/m.test(summary.text)) {
    return {
      status: "FAIL",
      filesWritten,
      reviewRounds: 0,
    };
  }

  const questionArtifacts = await Promise.all(
    questions.map(async (question) => {
      const questionFile = path.join(runtime.artifacts.researchDir, `${question.id.toLowerCase()}.md`);
      return readArtifact(questionFile);
    }),
  );

  let reviewRounds = 1;
  while (reviewRounds <= 3) {
    const review = await dispatchLeaf(
      runtime,
      "qrspi-research-reviewer",
      [
        "=== QUESTIONS ===",
        await readArtifact(runtime.artifacts.researchQuestionsFile),
        "",
        ...questionArtifacts.flatMap((artifact, index) => [
          `=== ${questions[index]?.id ?? `Q${index + 1}`} ===`,
          artifact,
          "",
        ]),
        "=== SUMMARY ===",
        await readArtifact(runtime.artifacts.researchSummaryFile),
      ].join("\n"),
    );

    const reviewFile = path.join(runtime.artifacts.reviewsDir, `research-review-round-${String(reviewRounds).padStart(2, "0")}.md`);
    await writeArtifact(reviewFile, review.text);
    filesWritten.push(path.relative(runtime.artifacts.runDir, reviewFile));

    if (parseReviewStatus(review.text) === "PASS") {
      const ledger = questions
        .map((question) => `- ${question.id}: ${question.title} [${question.tag}]`)
        .join("\n");
      await writeArtifact(path.join(runtime.artifacts.researchDir, "question-ledger.md"), ledger);
      await writeArtifact(runtime.artifacts.researchOpenQuestionsFile, "None.");
      filesWritten.push("research/question-ledger.md", "research/open-questions.md", "research/summary.md");
      return {
        status: "PASS",
        filesWritten,
        reviewRounds,
      };
    }

    if (reviewRounds === 3) {
      return {
        status: "FAIL",
        filesWritten,
        reviewRounds,
      };
    }

    reviewRounds += 1;
  }

  return {
    status: "FAIL",
    filesWritten,
    reviewRounds,
  };
}

function parseQuestions(markdown: string): ResearchQuestion[] {
  const matches = [...markdown.matchAll(/^###\s+(Q\d+):\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const id = match[1] ?? `Q${index + 1}`;
    const title = match[2]?.trim() ?? `Question ${index + 1}`;
    const nextStart = matches[index + 1]?.index;
    const block = markdown.slice(match.index ?? 0, nextStart);
    const tag = block.match(/\*\*Tag\*\*:\s*(codebase|web|hybrid)/i)?.[1]?.toLowerCase() as ResearchQuestion["tag"] | undefined;
    return {
      id,
      title,
      tag: tag ?? "codebase",
    };
  });
}
