import { mkdir, readdir, symlink } from "node:fs/promises";
import path from "node:path";

import { parseMarkdownSections } from "../markdown.js";
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

async function writePlanArtifacts(runtime: StageRuntime, output: string): Promise<string[]> {
  const filesWritten: string[] = [];
  const sections = parseMarkdownSections(output);
  const plan = sections["plan.md"] ?? sections["Implementation Plan"];
  const manifest = sections["phase-manifest.md"];
  if (!plan || !manifest) {
    throw new Error("Plan writer output is missing required sections.");
  }

  await writeArtifact(runtime.artifacts.planFile, plan);
  await writeArtifact(runtime.artifacts.phaseManifestFile, manifest);
  filesWritten.push("plan.md", "phase-manifest.md");

  for (const [heading, content] of Object.entries(sections)) {
    if (!/^task-\d+\.outline$/i.test(heading)) {
      continue;
    }
    const outlinePath = path.join(runtime.artifacts.outlinesDir, heading);
    await writeArtifact(outlinePath, content);
    filesWritten.push(path.relative(runtime.artifacts.runDir, outlinePath));
  }

  return filesWritten;
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
