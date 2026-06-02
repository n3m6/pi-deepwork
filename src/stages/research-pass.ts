import path from "node:path";

import { dispatchFailureSummary, dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";
import type { StageRuntime } from "../types.js";

const RESEARCH_AGENT_TIMEOUT_MS = 600_000;

interface ResearchQuestion {
  id: string;
  title: string;
  tag: "codebase" | "web" | "hybrid";
  block: string;
}

export interface ResearchPassResult {
  status: "PASS" | "FAIL";
  filesWritten: string[];
  reviewRounds: number;
  summary?: string;
  dispatchFailure?: boolean;
}

export async function runResearchPassSubstage(runtime: StageRuntime, questionsMarkdown: string): Promise<ResearchPassResult> {
  const filesWritten: string[] = [];
  const questions = parseQuestions(questionsMarkdown);

  for (const question of questions) {
    const result = await writeQuestionResearch(runtime, question);
    if (!result.ok) {
      return {
        status: "FAIL",
        filesWritten,
        reviewRounds: 0,
        summary: result.summary,
        dispatchFailure: true,
      };
    }
    filesWritten.push(result.fileWritten);
  }

  const researchArtifactList = questions
    .map((question) => path.join(runtime.artifacts.researchDir, `${question.id.toLowerCase()}.md`))
    .map((filePath) => path.relative(runtime.artifacts.runDir, filePath))
    .join("\n");
  const summary = await dispatchLeaf(runtime, "qrspi-research-synthesizer", researchArtifactList, {
    tools: ["read", "bash", "grep", "find", "ls", "write", "edit"],
    timeoutMs: RESEARCH_AGENT_TIMEOUT_MS,
  });
  const summaryFailure = dispatchFailureSummary(summary, "Research synthesis failed");
  if (summaryFailure) {
    return {
      status: "FAIL",
      filesWritten,
      reviewRounds: 0,
      summary: summaryFailure,
      dispatchFailure: true,
    };
  }
  if (/### Status\s+[—-]\s+FAIL\b/m.test(summary.text)) {
    return {
      status: "FAIL",
      filesWritten,
      reviewRounds: 0,
    };
  }
  const summaryArtifactFailure = await ensureResearchSummaryArtifact(runtime, summary.text, "Research synthesis failed");
  if (summaryArtifactFailure) {
    return {
      status: "FAIL",
      filesWritten,
      reviewRounds: 0,
      summary: summaryArtifactFailure,
      dispatchFailure: true,
    };
  }

  let reviewRounds = 1;
  while (reviewRounds <= 3) {
    const questionArtifacts = await readQuestionArtifacts(runtime, questions);
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
      {
        tools: ["read", "bash", "grep", "find", "ls", "write", "edit"],
        timeoutMs: RESEARCH_AGENT_TIMEOUT_MS,
      },
    );
    const reviewFailure = dispatchFailureSummary(review, "Research review failed");
    if (reviewFailure) {
      return {
        status: "FAIL",
        filesWritten,
        reviewRounds,
        summary: reviewFailure,
        dispatchFailure: true,
      };
    }

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

    const questionsToRevise = questionsReferencedByReview(review.text, questions);
    for (const question of questionsToRevise) {
      const result = await writeQuestionResearch(runtime, question, review.text);
      if (!result.ok) {
        return {
          status: "FAIL",
          filesWritten,
          reviewRounds,
          summary: result.summary,
          dispatchFailure: true,
        };
      }
      filesWritten.push(result.fileWritten);
    }

    const revisedSummary = await dispatchLeaf(
      runtime,
      "qrspi-research-synthesizer",
      [
        researchArtifactList,
        "",
        "=== REVIEW FEEDBACK ===",
        review.text,
        "",
        "Revise `research/summary.md` to address every FAIL finding. Preserve only facts supported by the per-question artifacts.",
      ].join("\n"),
      {
        tools: ["read", "bash", "grep", "find", "ls", "write", "edit"],
        timeoutMs: RESEARCH_AGENT_TIMEOUT_MS,
      },
    );
    const revisionFailure = dispatchFailureSummary(revisedSummary, "Research synthesis revision failed");
    if (revisionFailure) {
      return {
        status: "FAIL",
        filesWritten,
        reviewRounds,
        summary: revisionFailure,
        dispatchFailure: true,
      };
    }
    if (/### Status\s+[—-]\s+FAIL\b/m.test(revisedSummary.text)) {
      return {
        status: "FAIL",
        filesWritten,
        reviewRounds,
      };
    }
    const revisedSummaryArtifactFailure = await ensureResearchSummaryArtifact(
      runtime,
      revisedSummary.text,
      "Research synthesis revision failed",
    );
    if (revisedSummaryArtifactFailure) {
      return {
        status: "FAIL",
        filesWritten,
        reviewRounds,
        summary: revisedSummaryArtifactFailure,
        dispatchFailure: true,
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
      block,
    };
  });
}

async function writeQuestionResearch(
  runtime: StageRuntime,
  question: ResearchQuestion,
  reviewFeedback?: string,
): Promise<{ ok: true; fileWritten: string } | { ok: false; summary: string }> {
  const findings: string[] = [];
  if (question.tag === "codebase" || question.tag === "hybrid") {
    const codebase = await dispatchLeaf(
      runtime,
      "qrspi-codebase-researcher",
      buildResearcherPrompt(question, reviewFeedback),
    );
    const codebaseFailure = dispatchFailureSummary(
      codebase,
      `${reviewFeedback ? "Codebase research revision" : "Codebase research"} failed for ${question.id}`,
    );
    if (codebaseFailure) {
      return { ok: false, summary: codebaseFailure };
    }
    findings.push(codebase.text);
  }
  if (question.tag === "web" || question.tag === "hybrid") {
    const web = await dispatchLeaf(
      runtime,
      "qrspi-web-researcher",
      buildResearcherPrompt(question, reviewFeedback),
      {
        timeoutMs: RESEARCH_AGENT_TIMEOUT_MS,
      },
    );
    const webFailure = dispatchFailureSummary(
      web,
      `${reviewFeedback ? "Web research revision" : "Web research"} failed for ${question.id}`,
    );
    if (webFailure) {
      return { ok: false, summary: webFailure };
    }
    findings.push(web.text);
  }

  const questionFile = path.join(runtime.artifacts.researchDir, `${question.id.toLowerCase()}.md`);
  await writeArtifact(questionFile, findings.join("\n\n"));
  return { ok: true, fileWritten: path.relative(runtime.artifacts.runDir, questionFile) };
}

function buildResearcherPrompt(question: ResearchQuestion, reviewFeedback?: string): string {
  return [
    "=== QUESTION ===",
    question.block.trim(),
    "",
    "=== RESEARCH SCOPE ===",
    "Treat `.pipeline/`, `.git/`, `node_modules/`, and other generated or VCS metadata as out of scope unless the question explicitly asks about those directories.",
    "Honor the question's Answer shape, scope boundary, and stop condition.",
    reviewFeedback ? "" : undefined,
    reviewFeedback ? "=== REVIEW FEEDBACK ===" : undefined,
    reviewFeedback,
    reviewFeedback ? "" : undefined,
    reviewFeedback ? "Revise the findings for this question only. Address every reviewer finding that names this question artifact." : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

async function readQuestionArtifacts(runtime: StageRuntime, questions: ResearchQuestion[]): Promise<string[]> {
  return Promise.all(
    questions.map(async (question) => {
      const questionFile = path.join(runtime.artifacts.researchDir, `${question.id.toLowerCase()}.md`);
      return readArtifact(questionFile);
    }),
  );
}

async function ensureResearchSummaryArtifact(runtime: StageRuntime, synthesizerText: string, label: string): Promise<string | undefined> {
  try {
    await readArtifact(runtime.artifacts.researchSummaryFile);
    return undefined;
  } catch {
    if (/^#\s+Research Summary\b/m.test(synthesizerText)) {
      await writeArtifact(runtime.artifacts.researchSummaryFile, synthesizerText);
      return undefined;
    }
    return `${label}: synthesizer returned without writing research/summary.md.`;
  }
}

function questionsReferencedByReview(reviewText: string, questions: ResearchQuestion[]): ResearchQuestion[] {
  const artifactFindings = extractReviewSection(reviewText, "Artifact Findings");
  const perQuestionIssues = extractReviewSection(reviewText, "Per-Question Issues");
  const normalizedPerQuestionIssues = perQuestionIssues.trim().toLowerCase();
  return questions.filter((question) => {
    const id = question.id.toLowerCase();
    const escapedId = escapeRegExp(id);
    const artifactNamePattern = `(?:research/)?${escapedId}\\.md`;
    const failedArtifactPattern = new RegExp(
      `(?:${artifactNamePattern}[^\\n|]*\\|\\s*FAIL\\b|\\bFAIL\\b[^\\n|]*${artifactNamePattern})`,
      "i",
    );
    if (failedArtifactPattern.test(artifactFindings)) {
      return true;
    }
    if (!normalizedPerQuestionIssues || normalizedPerQuestionIssues === "none." || normalizedPerQuestionIssues === "none") {
      return false;
    }
    return new RegExp(`\\b${escapedId}\\b|${artifactNamePattern}`, "i").test(perQuestionIssues);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractReviewSection(markdown: string, sectionName: string): string {
  const lines = markdown.split("\n");
  const headingPattern = new RegExp(`^#{2,3}\\s+${escapeRegExp(sectionName)}\\s*$`, "i");
  const nextHeadingPattern = /^#{2,3}\s+/;
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) {
    return "";
  }
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (nextHeadingPattern.test(lines[index]?.trim() ?? "")) {
      break;
    }
    body.push(lines[index] ?? "");
  }
  return body.join("\n");
}
