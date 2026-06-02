import { mkdir, readdir, symlink } from "node:fs/promises";
import path from "node:path";

import { parseMarkdownSections } from "../markdown.js";
import { detectSimpleExactFileTask } from "../simple-file-task.js";
import { fileExists } from "../state.js";
import type { StageModule, StageOutcome, StageRuntime } from "../types.js";
import { dispatchLeaf, parseReviewStatus, readArtifact, requireMarkdownSection, writeArtifact } from "./utils.js";

export const planStage: StageModule = {
  stage: "plan",
  async run(runtime): Promise<StageOutcome> {
    const goals = await readArtifact(runtime.artifacts.goalsFile);
    const requirements = await readArtifact(runtime.artifacts.requirementsFile);
    const research = await readArtifact(runtime.artifacts.researchSummaryFile);
    const design = runtime.state.route === "full" ? await readArtifact(runtime.artifacts.designFile) : "N/A";
    const structure = runtime.state.route === "full" ? await readArtifact(runtime.artifacts.structureFile) : "N/A";
    const agentsGuidance = await safeRead(path.join(runtime.artifacts.workspaceRoot, "AGENTS.md"));
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const filesWritten = await writeSimplePlan(runtime, simpleTask.filePath, simpleTask.content);
      await ensurePhaseLayout(runtime, 1);
      return {
        status: "PASS",
        filesWritten,
        summary: "Simple exact-file plan generated deterministically.",
        telemetry: {
          review_rounds: 0,
          terminal_review_state: "clean",
          deterministic_fast_path: "simple-exact-file",
          child_agent_calls: {},
        },
      };
    }

    let reviewRound = 1;
    let latestPlanWriterOutput = "";
    while (reviewRound <= 5) {
      latestPlanWriterOutput = await runPlanWriter(runtime, {
        goals,
        requirements,
        research,
        design,
        structure,
        agentsGuidance,
      });
      const filesWritten = await writePlanArtifacts(runtime, latestPlanWriterOutput);
      const review = await runPlanReview(runtime, {
        runId: runtime.state.runId,
        goals,
        requirements,
        design,
        structure,
        agentsGuidance,
      });

      const reviewFile = path.join(runtime.artifacts.reviewsDir, `plan-review-round-${String(reviewRound).padStart(2, "0")}.md`);
      await writeArtifact(reviewFile, review.text);
      filesWritten.push(path.relative(runtime.artifacts.runDir, reviewFile));

      if (parseReviewStatus(review.text) === "PASS") {
        const specFiles = await writeTaskSpecs(runtime, agentsGuidance);
        const baseline = await dispatchLeaf(
          runtime,
          "qrspi-baseline-checker",
          [
            "=== PIPELINE CONFIG ===",
            await readArtifact(runtime.artifacts.configFile),
            "",
            "=== PLAN ===",
            await readArtifact(runtime.artifacts.planFile),
            "",
            "=== TASK SPECS ===",
            await readAllTaskSpecs(runtime),
          ].join("\n"),
        );
        await writeArtifact(runtime.artifacts.baselineResultsFile, baseline.text);
        filesWritten.push("baseline-results.md", ...specFiles);
        const totalPhases = parseTotalPhases(await readArtifact(runtime.artifacts.phaseManifestFile));
        await ensurePhaseLayout(runtime, totalPhases);

        return {
          status: "PASS",
          filesWritten,
          summary: "Implementation plan, task specs, and baseline were generated successfully.",
          telemetry: {
            review_rounds: reviewRound,
            terminal_review_state: "clean",
            child_agent_calls: {
              "qrspi-plan-writer": reviewRound,
              "qrspi-plan-reviewer": reviewRound,
              "qrspi-task-spec-writer": specFiles.length,
              "qrspi-task-spec-reviewer": specFiles.length,
              "qrspi-baseline-checker": 1,
            },
          },
        };
      }

      if (reviewRound === 5) {
        return {
          status: "FAIL",
          filesWritten,
          summary: "Plan review loop reached the unresolved review cap.",
          telemetry: {
            review_rounds: reviewRound,
            terminal_review_state: "unclean-cap",
          },
        };
      }

      reviewRound += 1;
    }

    return {
      status: "FAIL",
      filesWritten: [],
      summary: "Plan review did not converge.",
      telemetry: {
        review_rounds: 5,
        terminal_review_state: "unclean-cap",
      },
    };
  },
};

async function runPlanWriter(
  runtime: StageRuntime,
  inputs: {
    goals: string;
    requirements: string;
    research: string;
    design: string;
    structure: string;
    agentsGuidance: string;
  },
): Promise<string> {
  const result = await dispatchLeaf(
    runtime,
    "qrspi-plan-writer",
    [
      "=== GOALS ===",
      inputs.goals,
      "",
      "=== REQUIREMENTS ===",
      inputs.requirements,
      "",
      "=== RESEARCH SUMMARY ===",
      inputs.research,
      "",
      "=== DESIGN ===",
      inputs.design,
      "",
      "=== STRUCTURE ===",
      inputs.structure,
      "",
      "=== AGENTS GUIDANCE ===",
      inputs.agentsGuidance || "None.",
      "",
      "=== NEXT REMAINING PHASE ===",
      String(runtime.state.currentPhase),
      "",
      "=== ROUTE ===",
      runtime.state.route === "unknown" ? "full" : runtime.state.route,
    ].join("\n"),
  );
  return result.text;
}

export async function writePlanArtifacts(runtime: StageRuntime, output: string): Promise<string[]> {
  const filesWritten: string[] = [];
  const sections = parseMarkdownSections(output);
  const fallbackSections = extractLoosePlanSections(output);
  const plan = cleanArtifactMarkdown(sections["plan.md"] ?? sections["Implementation Plan"] ?? fallbackSections["plan.md"]);
  const manifest = cleanArtifactMarkdown(sections["phase-manifest.md"] ?? fallbackSections["phase-manifest.md"]);
  if (!plan || !manifest) {
    throw new Error("Plan writer output is missing required sections.");
  }

  await writeArtifact(runtime.artifacts.planFile, plan);
  await writeArtifact(runtime.artifacts.phaseManifestFile, manifest);
  filesWritten.push("plan.md", "phase-manifest.md");

  for (const [heading, content] of Object.entries({ ...fallbackSections, ...sections })) {
    if (!/^task-\d+\.outline$/i.test(heading)) {
      continue;
    }
    const outlinePath = path.join(runtime.artifacts.outlinesDir, heading);
    await writeArtifact(outlinePath, cleanArtifactMarkdown(content));
    filesWritten.push(path.relative(runtime.artifacts.runDir, outlinePath));
  }

  return filesWritten;
}

function cleanArtifactMarkdown(markdown: string | undefined): string {
  if (!markdown) {
    return "";
  }
  const trimmed = markdown.trim();
  const fence = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return (fence?.[1] ?? trimmed).trim();
}

function extractLoosePlanSections(output: string): Record<string, string> {
  const sections: Record<string, string> = {};
  for (const block of extractFencedBlocks(output)) {
    const cleaned = cleanArtifactMarkdown(block);
    if (/^#\s+Implementation Plan\b/m.test(cleaned)) {
      sections["plan.md"] = cleaned;
      continue;
    }
    if (/^---\s*\ntotal_phases:\s*\d+/m.test(cleaned) || /^total_phases:\s*\d+/m.test(cleaned)) {
      sections["phase-manifest.md"] = cleaned;
      continue;
    }
    const taskNumber = cleaned.match(/^Task:\s*(\d+)/m)?.[1];
    if (taskNumber) {
      sections[`task-${taskNumber.padStart(2, "0")}.outline`] = cleaned;
    }
  }
  return sections;
}

function extractFencedBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/gi)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
}

async function runPlanReview(
  runtime: StageRuntime,
  inputs: {
    runId: string;
    goals: string;
    requirements: string;
    design: string;
    structure: string;
    agentsGuidance: string;
  },
) {
  return dispatchLeaf(
    runtime,
    "qrspi-plan-reviewer",
    [
      "=== RUN ID ===",
      inputs.runId,
      "",
      "=== GOALS ===",
      inputs.goals,
      "",
      "=== REQUIREMENTS ===",
      inputs.requirements,
      "",
      "=== DESIGN ===",
      inputs.design,
      "",
      "=== STRUCTURE ===",
      inputs.structure,
      "",
      "=== AGENTS GUIDANCE ===",
      inputs.agentsGuidance || "None.",
      "",
      "=== NEXT REMAINING PHASE ===",
      String(runtime.state.currentPhase),
    ].join("\n"),
  );
}

async function writeTaskSpecs(runtime: StageRuntime, agentsGuidance: string): Promise<string[]> {
  const outlineFiles = (await readdir(runtime.artifacts.outlinesDir))
    .filter((entry) => /^task-\d+\.outline$/i.test(entry))
    .sort();
  const written: string[] = [];

  for (const outlineFile of outlineFiles) {
    const taskNumber = outlineFile.match(/task-(\d+)\.outline/i)?.[1];
    if (!taskNumber) {
      continue;
    }

    let reviewRound = 1;
    let reviewFeedback = "";
    while (reviewRound <= 3) {
      const writer = await dispatchLeaf(
        runtime,
        "qrspi-task-spec-writer",
        [
          "=== RUN ID ===",
          runtime.state.runId,
          "",
          "=== ROUTE ===",
          runtime.state.route === "unknown" ? "full" : runtime.state.route,
          "",
          "=== TASK NUMBER ===",
          taskNumber,
          "",
          "=== AGENTS GUIDANCE ===",
          agentsGuidance || "None.",
          reviewFeedback ? "\n=== TASK REVIEW FEEDBACK ===" : "",
          reviewFeedback || "",
        ].join("\n"),
        {
          tools: ["read", "bash", "grep", "find", "ls", "write", "edit"],
        },
      );
      if (/### Status\s+[—-]\s+FAIL\b/m.test(writer.text)) {
        throw new Error(`Task spec writer failed for task ${taskNumber}: ${writer.text}`);
      }

      const taskSpecPath = path.join(runtime.artifacts.tasksDir, `task-${taskNumber}.md`);
      const outline = await readArtifact(path.join(runtime.artifacts.outlinesDir, outlineFile));
      const taskSpec = await readArtifact(taskSpecPath);
      const review = await dispatchLeaf(
        runtime,
        "qrspi-task-spec-reviewer",
        [
          "=== RUN ID ===",
          runtime.state.runId,
          "",
          "=== CURRENT TASK NUMBER ===",
          taskNumber,
          "",
          "=== CURRENT TASK OUTLINE ===",
          outline,
          "",
          "=== CURRENT TASK SPEC ===",
          taskSpec,
          "",
          "=== GOALS ===",
          await readArtifact(runtime.artifacts.goalsFile),
          "",
          "=== PLAN ===",
          await readArtifact(runtime.artifacts.planFile),
          "",
          "=== DESIGN ===",
          runtime.state.route === "full" ? await readArtifact(runtime.artifacts.designFile) : "N/A",
          "",
          "=== STRUCTURE ===",
          runtime.state.route === "full" ? await readArtifact(runtime.artifacts.structureFile) : "N/A",
          "",
          "=== AGENTS GUIDANCE ===",
          agentsGuidance || "None.",
          "",
          "=== ROUND ===",
          String(reviewRound),
        ].join("\n"),
      );

      const reviewFile = path.join(runtime.artifacts.reviewsDir, `task-${taskNumber}-review-round-${String(reviewRound).padStart(2, "0")}.md`);
      await writeArtifact(reviewFile, review.text);
      written.push(path.relative(runtime.artifacts.runDir, reviewFile), path.relative(runtime.artifacts.runDir, taskSpecPath));

      if (parseReviewStatus(review.text) === "PASS") {
        break;
      }

      if (reviewRound === 3) {
        throw new Error(`Task spec review did not converge for task ${taskNumber}.`);
      }

      reviewFeedback = review.text;
      reviewRound += 1;
    }
  }

  return written;
}

async function ensurePhaseLayout(runtime: StageRuntime, totalPhases: number): Promise<void> {
  const effectiveTotal = Math.max(totalPhases, runtime.state.route === "quick-fix" ? 1 : 1);
  for (let phase = runtime.state.currentPhase; phase <= effectiveTotal; phase += 1) {
    const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    await mkdir(phaseDir, { recursive: true });
  }

  const phaseOneTasksLink = path.join(runtime.artifacts.phasesDir, "phase-01", "tasks");
  if (!(await fileExists(phaseOneTasksLink))) {
    await symlink(path.relative(path.join(runtime.artifacts.phasesDir, "phase-01"), runtime.artifacts.tasksDir), phaseOneTasksLink, "dir");
  }
}

async function writeSimplePlan(runtime: StageRuntime, filePath: string, content: string): Promise<string[]> {
  const plan = [
    "# Implementation Plan",
    "",
    "## Overview",
    `Create \`${filePath}\` with exactly \`${content}\` and no additional bytes.`,
    "",
    "## Phase Summary",
    "- **Phase 1 — Quick-fix:** Write and verify the exact file content.",
    "",
    "## Task Order",
    "| # | Task | Dependencies | Phase | Slice |",
    "| - | ---- | ------------ | ----- | ----- |",
    `| 01 | Create \`${filePath}\` | None | Quick-fix | quick-fix |`,
  ].join("\n");
  const manifest = [
    "---",
    "total_phases: 1",
    "---",
    "",
    "## Phase 1 — Quick-fix",
    "",
    "- **Tasks:** 01",
    "- **Acceptance Criteria:** AC-1, AC-2",
    "- **Replan Gate:** N/A (single-phase quick-fix route)",
  ].join("\n");
  const outline = [
    "Task: 01",
    `Title: Create ${filePath}`,
    "Phase: Quick-fix",
    "Route: quick-fix",
    "Slice: quick-fix",
    "Dependencies: None",
    `Scope: Create \`${filePath}\` with exact content.`,
    "Acceptance Criteria: AC-1, AC-2",
    "NFRs: None",
    "Gate Criteria: N/A",
    "Files:",
    `  - ${filePath} (CREATE) — exact content`,
  ].join("\n");
  const task = [
    `# Task 01: Create ${filePath}`,
    "",
    "## Metadata",
    "- **Task:** 01",
    "- **Phase:** Quick-fix",
    "- **Route:** quick-fix",
    "- **Slice:** quick-fix",
    "",
    "## Dependencies",
    "- None",
    "",
    "## Traceability",
    "- **Acceptance Criteria:** AC-1, AC-2",
    "- **NFRs:** None",
    "- **Replan Gate Criteria:** N/A",
    "",
    "## Description",
    `Create \`${filePath}\` in the repository root with exactly \`${content}\`. Do not add a trailing newline, leading/trailing whitespace, or any other characters.`,
    "",
    "## Files",
    `- \`${filePath}\` (CREATE) — exact content only`,
    "",
    "## Test Expectations",
    `- \`${filePath}\` exists as a regular file.`,
    `- Its content is exactly \`${content}\`.`,
    `- Its byte length is ${Buffer.byteLength(content, "utf8")}.`,
  ].join("\n");
  const baseline = [
    "### Baseline Status — CLEAN",
    "",
    "### Check Results",
    "No baseline commands are configured for this simple exact-file task.",
    "",
    "### Failure Inventory",
    "None.",
  ].join("\n");

  const outlinePath = path.join(runtime.artifacts.outlinesDir, "task-01.outline");
  const taskPath = path.join(runtime.artifacts.tasksDir, "task-01.md");
  await writeArtifact(runtime.artifacts.planFile, plan);
  await writeArtifact(runtime.artifacts.phaseManifestFile, manifest);
  await writeArtifact(outlinePath, outline);
  await writeArtifact(taskPath, task);
  await writeArtifact(runtime.artifacts.baselineResultsFile, baseline);

  return [
    "plan.md",
    "phase-manifest.md",
    path.relative(runtime.artifacts.runDir, outlinePath),
    path.relative(runtime.artifacts.runDir, taskPath),
    "baseline-results.md",
  ];
}

function parseTotalPhases(manifest: string): number {
  const match = manifest.match(/total_phases:\s*(\d+)/);
  return match?.[1] ? Number.parseInt(match[1], 10) : 1;
}

async function readAllTaskSpecs(runtime: StageRuntime): Promise<string> {
  const files = (await readdir(runtime.artifacts.tasksDir)).filter((entry) => /^task-\d+\.md$/i.test(entry)).sort();
  const contents = await Promise.all(files.map((file) => readArtifact(path.join(runtime.artifacts.tasksDir, file))));
  return contents.join("\n\n");
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "";
  }
}
