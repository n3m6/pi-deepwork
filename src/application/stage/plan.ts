import { parseMarkdownSections, parseTotalPhases } from "../../infrastructure/codec/markdown-codec.js";
import { detectSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import type { ArtifactId, StageModule, StageOutcome, StageRuntime } from "../port/index.js";
import { artifactRelPath, dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

interface TaskSpecsResult {
  status: "PASS" | "FAIL";
  filesWritten: string[];
  summary?: string;
}

const PLAN_AGENT_TIMEOUT_MS = 600_000;

export const planStage: StageModule = {
  stage: "plan",
  async run(runtime): Promise<StageOutcome> {
    const repo = runtime.services.artifactRepo;
    const goals = await readArtifact(runtime, { kind: "goals" });
    const requirements = await readArtifact(runtime, { kind: "requirements" });
    const research = await readArtifact(runtime, { kind: "researchSummary" });
    const design = runtime.state.route === "full" ? await readArtifact(runtime, { kind: "design" }) : "N/A";
    const structure = runtime.state.route === "full" ? await readArtifact(runtime, { kind: "structure" }) : "N/A";
    const agentsGuidance = (await repo.readWorkspaceFile("AGENTS.md")) ?? "";
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const filesWritten = await writeSimplePlan(runtime, simpleTask.filePath, simpleTask.content);
      await repo.ensurePhaseLayout(1, 1);
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

      const reviewId: ArtifactId = { kind: "reviewFile", name: `plan-review-round-${String(reviewRound).padStart(2, "0")}.md` };
      await writeArtifact(runtime, reviewId, review.text);
      filesWritten.push(artifactRelPath(runtime, reviewId));

      if (parseReviewStatus(review.text) === "PASS") {
        const specResult = await writeTaskSpecs(runtime, agentsGuidance);
        if (specResult.status === "FAIL") {
          await writeArtifact(runtime, { kind: "baselineResults" }, renderBaselineUnavailable(specResult.summary ?? "Task spec review did not converge."));
          filesWritten.push("baseline-results.md", ...specResult.filesWritten);
          const totalPhases = parseTotalPhases(await readArtifact(runtime, { kind: "phaseManifest" }));
          await repo.ensurePhaseLayout(runtime.state.currentPhase, totalPhases);

          return {
            status: "FAIL",
            filesWritten,
            summary: specResult.summary ?? "Task spec review did not converge.",
            telemetry: {
              review_rounds: reviewRound,
              terminal_review_state: "unclean-cap",
              child_agent_calls: {
                "qrspi-plan-writer": reviewRound,
                "qrspi-plan-reviewer": reviewRound,
              },
            },
          };
        }
        const baseline = await dispatchLeaf(
          runtime,
          "qrspi-baseline-checker",
          [
            "=== PIPELINE CONFIG ===",
            await readArtifact(runtime, { kind: "config" }),
            "",
            "=== PLAN ===",
            await readArtifact(runtime, { kind: "plan" }),
            "",
            "=== GOALS ===",
            goals,
            "",
            "=== REQUIREMENTS ===",
            requirements,
          ].join("\n"),
        );
        await writeArtifact(runtime, { kind: "baselineResults" }, baseline.text);
        filesWritten.push("baseline-results.md");
        const totalPhases = parseTotalPhases(await readArtifact(runtime, { kind: "phaseManifest" }));
        await repo.ensurePhaseLayout(runtime.state.currentPhase, totalPhases);

        return {
          status: "PASS",
          filesWritten: [...filesWritten, ...specResult.filesWritten],
          summary: "Plan reviewed, task specs written, and baseline recorded.",
          telemetry: {
            review_rounds: reviewRound,
            terminal_review_state: "clean",
            child_agent_calls: {
              "qrspi-plan-writer": reviewRound,
              "qrspi-plan-reviewer": reviewRound,
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
            child_agent_calls: {
              "qrspi-plan-writer": reviewRound,
              "qrspi-plan-reviewer": reviewRound,
            },
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

export async function writePlanArtifacts(runtime: StageRuntime, output: string): Promise<string[]> {
  const filesWritten: string[] = [];
  const repo = runtime.services.artifactRepo;
  const sections = parseMarkdownSections(output);
  const fallbackSections = extractLoosePlanSections(output);
  const plan = cleanArtifactMarkdown(sections["plan.md"] ?? sections["Implementation Plan"] ?? fallbackSections["plan.md"]);
  const manifest = cleanArtifactMarkdown(sections["phase-manifest.md"] ?? fallbackSections["phase-manifest.md"]);
  if (!plan || !manifest) {
    throw new Error("Plan writer output is missing required sections.");
  }

  await writeArtifact(runtime, { kind: "plan" }, plan);
  await writeArtifact(runtime, { kind: "phaseManifest" }, manifest);
  filesWritten.push("plan.md", "phase-manifest.md");

  for (const [heading, content] of Object.entries({ ...fallbackSections, ...sections })) {
    if (!/^task-\d+\.outline$/i.test(heading)) {
      continue;
    }
    const outlineId: ArtifactId = { kind: "taskOutlineFile", name: heading };
    await repo.write(outlineId, cleanArtifactMarkdown(content));
    filesWritten.push(repo.relPath(outlineId));
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
) {
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
    ].join("\n"),
    {
      tools: ["read", "bash", "grep", "find", "ls", "write", "edit"],
      timeoutMs: PLAN_AGENT_TIMEOUT_MS,
    },
  );
  return result.text;
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
    {
      timeoutMs: PLAN_AGENT_TIMEOUT_MS,
    },
  );
}

async function writeTaskSpecs(runtime: StageRuntime, agentsGuidance: string): Promise<TaskSpecsResult> {
  const repo = runtime.services.artifactRepo;
  const outlineFiles = await repo.listOutlineFiles();
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
          timeoutMs: PLAN_AGENT_TIMEOUT_MS,
        },
      );
      if (/### Status\s+[—-]\s+FAIL\b/m.test(writer.text)) {
        return {
          status: "FAIL",
          filesWritten: written,
          summary: `Task spec writer failed for task ${taskNumber}: ${writer.text}`,
        };
      }

      const taskSpecId: ArtifactId = { kind: "baseTaskSpec", taskId: taskNumber };
      const outlineContent = await repo.read({ kind: "taskOutlineFile", name: outlineFile }) ?? "";
      const taskSpec = (await repo.read(taskSpecId)) ?? "";
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
          outlineContent,
          "",
          "=== CURRENT TASK SPEC ===",
          taskSpec,
          "",
          "=== GOALS ===",
          await readArtifact(runtime, { kind: "goals" }),
          "",
          "=== PLAN ===",
          await readArtifact(runtime, { kind: "plan" }),
          "",
          "=== DESIGN ===",
          runtime.state.route === "full" ? await readArtifact(runtime, { kind: "design" }) : "N/A",
          "",
          "=== STRUCTURE ===",
          runtime.state.route === "full" ? await readArtifact(runtime, { kind: "structure" }) : "N/A",
          "",
          "=== AGENTS GUIDANCE ===",
          agentsGuidance || "None.",
          "",
          "=== ROUND ===",
          String(reviewRound),
        ].join("\n"),
        {
          timeoutMs: PLAN_AGENT_TIMEOUT_MS,
        },
      );

      const reviewId: ArtifactId = { kind: "reviewFile", name: `task-${taskNumber}-review-round-${String(reviewRound).padStart(2, "0")}.md` };
      await repo.write(reviewId, review.text);
      written.push(repo.relPath(reviewId), repo.relPath(taskSpecId));

      if (parseReviewStatus(review.text) === "PASS") {
        break;
      }

      if (reviewRound === 3) {
        return {
          status: "FAIL",
          filesWritten: written,
          summary: `Task spec review did not converge for task ${taskNumber}.`,
        };
      }

      reviewFeedback = review.text;
      reviewRound += 1;
    }
  }

  return {
    status: "PASS",
    filesWritten: written,
  };
}

function renderBaselineUnavailable(summary: string): string {
  return [
    "### Baseline Status — PARTIAL",
    "",
    "### Check Results",
    "| Check | Status | Command |",
    "| ----- | ------ | ------- |",
    "| Task spec review | PARTIAL | N/A |",
    "",
    "### Failure Inventory",
    summary,
  ].join("\n");
}

async function writeSimplePlan(runtime: StageRuntime, filePath: string, content: string): Promise<string[]> {
  const repo = runtime.services.artifactRepo;
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

  const outlineId: ArtifactId = { kind: "taskOutlineFile", name: "task-01.outline" };
  const taskId: ArtifactId = { kind: "baseTaskSpec", taskId: "01" };
  await writeArtifact(runtime, { kind: "plan" }, plan);
  await writeArtifact(runtime, { kind: "phaseManifest" }, manifest);
  await repo.write(outlineId, outline);
  await repo.write(taskId, task);
  await writeArtifact(runtime, { kind: "baselineResults" }, baseline);

  return [
    "plan.md",
    "phase-manifest.md",
    repo.relPath(outlineId),
    repo.relPath(taskId),
    "baseline-results.md",
  ];
}

