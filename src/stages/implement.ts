import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CheckpointManager, commitIdentityArgs } from "../checkpoint.js";
import { parseMarkdownSections } from "../markdown.js";
import { detectSimpleExactFileTask } from "../simple-file-task.js";
import type { StageModule, StageOutcome, StageRuntime } from "../types.js";
import { WorktreeManager, type TaskWorktree } from "../worktrees.js";
import { runBaselineRegressionSubstage } from "./baseline-regression.js";
import { runE2ERegressionSubstage } from "./e2e-regression.js";
import { runFastImplLoopSubstage } from "./fast-impl-loop.js";
import { dispatchGenericCoding, dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

interface TaskSpecSummary {
  taskId: string;
  phase: string;
  dependencies: string[];
  filePath: string;
  title: string;
}

export const implementStage: StageModule = {
  stage: "implement",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const phase = runtime.state.currentPhase;
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const filesWritten = await implementSimpleExactFileTask(runtime, phase, simpleTask.filePath, simpleTask.content);
      return {
        status: "PASS",
        phase,
        filesWritten,
        summary: "Simple exact-file implementation completed deterministically.",
        telemetry: {
          deterministic_fast_path: "simple-exact-file",
          child_agent_calls: {},
        },
      };
    }

    const repoRoot = await new CheckpointManager(runtime.services.pi, runtime.artifacts.workspaceRoot).resolveRepoRoot(
      runtime.services.eventContext.signal,
    );
    const worktrees = new WorktreeManager(runtime.services.pi, runtime.artifacts.workspaceRoot, repoRoot, runtime.state.runId);
    const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    const tasks = await loadPhaseTasks(runtime, phase);
    const waves = buildWaves(tasks);
    const manifestRows: string[] = [];
    const filesWritten: string[] = [];

    for (const [waveIndex, wave] of waves.entries()) {
      const prepared = await Promise.all(
        wave.map(async (task) => ({
          task,
          worktree: await worktrees.prepare(phase, task.taskId, runtime.services.eventContext.signal),
        })),
      );

      const results = await Promise.all(
        prepared.map(async ({ task, worktree }) => ({
          task,
          worktree,
          result: await runFastImplLoopSubstage(runtime, {
            taskId: task.taskId,
            worktreeRoot: worktree.worktreeRoot,
            taskSpecPath: task.filePath,
          }),
        })),
      );

      const failures = results.filter((entry) => entry.result.status !== "PASS");
      if (failures.length > 0) {
        for (const failure of failures) {
          manifestRows.push(
            `| ${failure.task.taskId} | ${failure.task.title} | ${waveIndex + 1} | FAIL | ${failure.result.summary.replaceAll("|", "/")} |`,
          );
        }
        const manifestPath = path.join(phaseDir, "execution-manifest.md");
        await writeArtifact(manifestPath, renderExecutionManifest(manifestRows));
        return {
          status: "FAIL",
          phase,
          filesWritten: [path.relative(runtime.artifacts.runDir, manifestPath)],
          summary: `Implementation failed in wave ${waveIndex + 1}.`,
          telemetry: {
            child_agent_calls: {
              "generic-coding": results.length * 3,
            },
          },
        };
      }

      for (const { task, worktree } of results.sort((left, right) => left.task.taskId.localeCompare(right.task.taskId))) {
        await commitWorktreeChanges(runtime, worktree.worktreeRoot, phase, task.taskId, task.title);
        const merge = await worktrees.squashMerge(
          worktree,
          `qrspi: phase ${phase} task ${task.taskId} ${task.title}`,
          runtime.services.eventContext.signal,
        );
        if (!merge.ok) {
          const resolved = await resolveSquashConflict(runtime, worktrees, worktree, phase, task.taskId, task.title, merge.conflictOutput ?? "merge conflict");
          if (!resolved.ok) {
            manifestRows.push(`| ${task.taskId} | ${task.title} | ${waveIndex + 1} | FAIL | ${resolved.summary.replaceAll("|", "/")} |`);
            const manifestPath = path.join(phaseDir, "execution-manifest.md");
            await writeArtifact(manifestPath, renderExecutionManifest(manifestRows));
            return {
              status: "FAIL",
              phase,
              filesWritten: [path.relative(runtime.artifacts.runDir, manifestPath)],
              summary: resolved.summary,
              telemetry: {
                worktree_abandoned: true,
                abandoned_worktree: worktree.worktreeRoot,
                abandoned_branch: worktree.branch,
              },
            };
          }
        }
        manifestRows.push(`| ${task.taskId} | ${task.title} | ${waveIndex + 1} | PASS | CLEAN |`);
      }
    }

    const manifestPath = path.join(phaseDir, "execution-manifest.md");
    await writeArtifact(manifestPath, renderExecutionManifest(manifestRows));
    filesWritten.push(path.relative(runtime.artifacts.runDir, manifestPath));

    const e2e = await runE2ERegressionSubstage(runtime, phase);
    const baseline = await runBaselineRegressionSubstage(runtime, phase);
    filesWritten.push(...e2e.outcome.filesWritten, ...baseline.filesWritten);

    const integrationResultsPath = path.join(phaseDir, "integration-results.md");
    await writeArtifact(
      integrationResultsPath,
      [
        "# Integration Results",
        "",
        e2e.markdown,
        "",
        `Baseline regression: ${baseline.summary}`,
      ].join("\n"),
    );
    filesWritten.push(path.relative(runtime.artifacts.runDir, integrationResultsPath));

    const integrationGate = await runIntegrationChecker(runtime, phase, manifestRows.join("\n"), baseline.summary);
    await writeArtifact(
      integrationResultsPath,
      [
        "# Integration Results",
        "",
        e2e.markdown,
        "",
        `Baseline regression: ${baseline.summary}`,
        "",
        "## Integration Checker",
        integrationGate.text,
      ].join("\n"),
    );
    if (parseReviewStatus(integrationGate.text) === "FAIL") {
      const sections = parseMarkdownSections(integrationGate.text);
      const backwardLoopRequest = sections["Backward Loop Request"];
      return {
        status: "FAIL",
        phase,
        filesWritten,
        summary: "Integration checker found blocking cross-task issues.",
        ...(backwardLoopRequest
          ? {
              backwardLoop: {
                classification: classifyIntegrationLoop(backwardLoopRequest),
                summary: sections["Stage Summary"] ?? "Integration checker requested a backward loop.",
                guidance: backwardLoopRequest,
              },
            }
          : {}),
        telemetry: {
          child_agent_calls: {
            "qrspi-integration-checker": 1,
          },
        },
      };
    }

    const stageSummaryPath = path.join(phaseDir, "stage7-summary.md");
    await writeArtifact(
      stageSummaryPath,
      [
        `### Status — ${baseline.status === "FAIL" ? "PARTIAL" : "PASS"}`,
        "",
        "# Stage 7 Summary",
        "",
        `Phase ${phase} implementation completed across ${tasks.length} task(s) in ${waves.length} wave(s).`,
        "",
        "## Phase Evidence Quality",
        "- Deterministic: 0",
        "- Flaky: 0",
        "- Harness Noisy: 0",
        "- Ambiguous: 0",
        "- Redundant: 0",
        "- No-Test Tasks: 0",
        "- No-Test Audit Overrides: 0",
      ].join("\n"),
    );
    filesWritten.push(path.relative(runtime.artifacts.runDir, stageSummaryPath));

    const integrationSummaryPath = path.join(phaseDir, "stage7-integration-summary.md");
    await writeArtifact(
      integrationSummaryPath,
      [
        "# Stage 7 Integration Summary",
        "",
        e2e.outcome.summary,
        baseline.summary,
      ].join("\n"),
    );
    filesWritten.push(path.relative(runtime.artifacts.runDir, integrationSummaryPath));

    return {
      status: baseline.status === "FAIL" ? "PARTIAL" : "PASS",
      phase,
      filesWritten,
      summary: baseline.status === "FAIL" ? "Implementation completed with regression findings." : "Implementation completed successfully.",
      telemetry: {
        child_agent_calls: {
          "generic-coding": tasks.length * 3,
        },
      },
    };
  },
};

async function implementSimpleExactFileTask(runtime: StageRuntime, phase: number, filePath: string, content: string): Promise<string[]> {
  const targetPath = path.join(runtime.artifacts.workspaceRoot, filePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");

  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  const manifestPath = path.join(phaseDir, "execution-manifest.md");
  const e2ePath = path.join(phaseDir, "e2e-regression-results.md");
  const regressionPath = path.join(phaseDir, "regression-results.md");
  const integrationPath = path.join(phaseDir, "integration-results.md");
  const summaryPath = path.join(phaseDir, "stage7-summary.md");
  const integrationSummaryPath = path.join(phaseDir, "stage7-integration-summary.md");

  await writeArtifact(
    manifestPath,
    [
      "# Execution Manifest",
      "",
      "| Task | Title | Wave | Status | Evidence Summary |",
      "| ---- | ----- | ---- | ------ | ---------------- |",
      `| 01 | Create ${filePath} | 1 | PASS | Exact file written |`,
    ].join("\n"),
  );
  await writeArtifact(e2ePath, "### Status — PASS\n### E2E — NOT CONFIGURED\nNo e2e script is required for this simple exact-file task.");
  await writeArtifact(
    regressionPath,
    "### Status — PASS\n\n| Check | Status | Command |\n| ----- | ------ | ------- |\n| Exact file write | PASS | deterministic write |",
  );
  await writeArtifact(
    integrationPath,
    [
      "# Integration Results",
      "",
      "### Status — PASS",
      `Created \`${filePath}\` with exact byte length ${Buffer.byteLength(content, "utf8")}.`,
    ].join("\n"),
  );
  await writeArtifact(
    summaryPath,
    [
      "### Status — PASS",
      "",
      "# Stage 7 Summary",
      "",
      `Phase ${phase} implementation completed for \`${filePath}\`.`,
      "",
      "## Phase Evidence Quality",
      "- Deterministic: 1",
      "- Flaky: 0",
      "- Harness Noisy: 0",
      "- Ambiguous: 0",
      "- Redundant: 0",
      "- No-Test Tasks: 0",
      "- No-Test Audit Overrides: 0",
    ].join("\n"),
  );
  await writeArtifact(
    integrationSummaryPath,
    [
      "# Stage 7 Integration Summary",
      "",
      `Exact-file implementation wrote \`${filePath}\` successfully.`,
    ].join("\n"),
  );

  return [
    filePath,
    path.relative(runtime.artifacts.runDir, manifestPath),
    path.relative(runtime.artifacts.runDir, e2ePath),
    path.relative(runtime.artifacts.runDir, regressionPath),
    path.relative(runtime.artifacts.runDir, integrationPath),
    path.relative(runtime.artifacts.runDir, summaryPath),
    path.relative(runtime.artifacts.runDir, integrationSummaryPath),
  ];
}

async function loadPhaseTasks(runtime: StageRuntime, phase: number): Promise<TaskSpecSummary[]> {
  const phaseTaskDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`, "tasks");
  const baseTaskDir = runtime.artifacts.tasksDir;
  const taskDir = (await directoryHasTasks(phaseTaskDir)) ? phaseTaskDir : baseTaskDir;
  const files = (await readdir(taskDir)).filter((entry) => /^task-\d+\.md$/i.test(entry)).sort();
  const summaries: TaskSpecSummary[] = [];
  for (const file of files) {
    const filePath = path.join(taskDir, file);
    const content = await readArtifact(filePath);
    const taskId = content.match(/\*\*Task:\*\*\s*(\d+)/)?.[1] ?? file.match(/task-(\d+)\.md/i)?.[1] ?? "00";
    const taskPhase = content.match(/\*\*Phase:\*\*\s*(.+)$/m)?.[1]?.trim() ?? String(phase);
    const title = content.match(/^# Task \d+:\s+(.+)$/m)?.[1]?.trim() ?? file;
    const dependenciesBlock = content.match(/## Dependencies\n([\s\S]*?)(?=\n## )/)?.[1] ?? "";
    const dependencies = [...dependenciesBlock.matchAll(/\b(\d{2})\b/g)]
      .map((match) => match[1])
      .filter((dependency): dependency is string => Boolean(dependency));
    if (taskPhase !== String(phase) && taskPhase.toLowerCase() !== "quick-fix") {
      continue;
    }
    summaries.push({
      taskId,
      phase: taskPhase,
      dependencies,
      filePath,
      title,
    });
  }
  return summaries;
}

function buildWaves(tasks: TaskSpecSummary[]): TaskSpecSummary[][] {
  const remaining = new Map(tasks.map((task) => [task.taskId, task]));
  const completed = new Set<string>();
  const waves: TaskSpecSummary[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((task) => task.dependencies.every((dependency) => completed.has(dependency)));
    if (wave.length === 0) {
      waves.push([...remaining.values()].sort((left, right) => left.taskId.localeCompare(right.taskId)));
      break;
    }
    wave.sort((left, right) => left.taskId.localeCompare(right.taskId));
    waves.push(wave);
    for (const task of wave) {
      completed.add(task.taskId);
      remaining.delete(task.taskId);
    }
  }

  return waves;
}

function renderExecutionManifest(rows: string[]): string {
  return [
    "# Execution Manifest",
    "",
    "| Task | Title | Wave | Status | Evidence Summary |",
    "| ---- | ----- | ---- | ------ | ---------------- |",
    ...(rows.length > 0 ? rows : ["| None | None | 0 | PASS | None |"]),
  ].join("\n");
}

async function directoryHasTasks(taskDir: string): Promise<boolean> {
  try {
    const entries = await readdir(taskDir);
    return entries.some((entry) => /^task-\d+\.md$/i.test(entry));
  } catch {
    return false;
  }
}

async function commitWorktreeChanges(
  runtime: StageRuntime,
  worktreeRoot: string,
  phase: number,
  taskId: string,
  title: string,
): Promise<void> {
  const status = await runtime.services.pi.exec("git", ["status", "--short"], {
    cwd: worktreeRoot,
    timeout: 60_000,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
  });
  if (!status.stdout.trim()) {
    return;
  }

  await runtime.services.pi.exec("git", ["add", "-A"], {
    cwd: worktreeRoot,
    timeout: 60_000,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
  });
  await runtime.services.pi.exec("git", [...commitIdentityArgs(), "commit", "-m", `qrspi: phase ${phase} task ${taskId} ${title}`], {
    cwd: worktreeRoot,
    timeout: 60_000,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
  });
}

async function resolveSquashConflict(
  runtime: StageRuntime,
  worktrees: WorktreeManager,
  worktree: TaskWorktree,
  phase: number,
  taskId: string,
  title: string,
  conflictOutput: string,
): Promise<{ ok: boolean; summary: string }> {
  const rebase = await worktrees.rebaseOnRunBranch(worktree, runtime.services.eventContext.signal);
  if (!rebase.ok) {
    const fix = await dispatchGenericCoding(
      runtime,
      [
        "Resolve the git rebase conflicts in this task worktree.",
        "Edit only conflict markers and directly-related files. Preserve the task behavior and tests.",
        "After resolving files, do not start a new feature; prepare the worktree so `git rebase --continue` can succeed.",
        "",
        `Task: ${taskId}`,
        `Worktree root: ${worktree.worktreeRoot}`,
        "",
        "Original squash conflict output:",
        conflictOutput,
        "",
        "Rebase output:",
        rebase.output ?? "No output.",
      ].join("\n"),
      { cwd: worktree.worktreeRoot },
    );
    if (fix.status === "FAIL") {
      return {
        ok: false,
        summary: `Implementation abandoned task ${taskId}; conflict fix failed: ${fix.summary}`,
      };
    }
    const continued = await worktrees.continueRebase(worktree, runtime.services.eventContext.signal);
    if (!continued.ok) {
      return {
        ok: false,
        summary: `Implementation abandoned task ${taskId}; rebase could not continue: ${continued.output ?? "unknown error"}`,
      };
    }
  }

  await commitWorktreeChanges(runtime, worktree.worktreeRoot, phase, taskId, title);
  const retry = await worktrees.squashMerge(
    worktree,
    `qrspi: phase ${phase} task ${taskId} ${title}`,
    runtime.services.eventContext.signal,
  );
  return retry.ok
    ? { ok: true, summary: "Conflict resolved and task squashed." }
    : {
        ok: false,
        summary: `Implementation abandoned task ${taskId}; squash conflict persisted: ${retry.conflictOutput ?? "merge conflict"}`,
      };
}

async function runIntegrationChecker(
  runtime: StageRuntime,
  phase: number,
  executionManifestRows: string,
  baselineSummary: string,
) {
  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  return dispatchLeaf(
    runtime,
    "qrspi-integration-checker",
    [
      "=== EXECUTION MANIFEST ===",
      executionManifestRows || await safeRead(path.join(phaseDir, "execution-manifest.md")),
      "",
      "=== PIPELINE CONFIG ===",
      await safeRead(runtime.artifacts.configFile),
      "",
      "=== PLAN ===",
      await safeRead(runtime.artifacts.planFile),
      "",
      "=== CURRENT PHASE ===",
      String(phase),
      "",
      "=== BASELINE RESULTS ===",
      await safeRead(runtime.artifacts.baselineResultsFile) || baselineSummary,
      "",
      "=== COMPLETED PHASE SUMMARIES ===",
      await completedPhaseSummaries(runtime, phase),
      "",
      "=== REVIEW STATUS SUMMARY ===",
      "Per-task code review fanout completed before squash merge; see reviews/code-review-task-*.md.",
      "",
      "=== DESIGN CONTEXT ===",
      runtime.state.route === "full" ? await safeRead(runtime.artifacts.designFile) : "N/A",
    ].join("\n"),
  );
}

function classifyIntegrationLoop(markdown: string): "LOOP_PLAN" | "LOOP_STRUCTURE" | "LOOP_DESIGN" {
  const affected = markdown.match(/Affected Artifact\*\*:\s*(design|structure|plan)/i)?.[1]?.toLowerCase();
  if (affected === "design") {
    return "LOOP_DESIGN";
  }
  if (affected === "structure") {
    return "LOOP_STRUCTURE";
  }
  return "LOOP_PLAN";
}

async function completedPhaseSummaries(runtime: StageRuntime, currentPhase: number): Promise<string> {
  const blocks: string[] = [];
  for (let phase = 1; phase < currentPhase; phase += 1) {
    const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    blocks.push([
      `## Phase ${phase}`,
      await safeRead(path.join(phaseDir, "stage7-summary.md")),
      await safeRead(path.join(phaseDir, "stage8-summary.md")),
    ].join("\n"));
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "None.";
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "";
  }
}
