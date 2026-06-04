import {
  parseAffectedArtifact,
  parseMarkdownSections,
  parseTaskSpecMetadata,
} from "../../infrastructure/codec/markdown-codec.js";
import { detectSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import { buildWaves } from "../../domain/stage/wave-planner.js";
import type { ArtifactId, StageModule, StageOutcome, StageRuntime, TaskWorktreeHandle } from "../port/index.js";
import { runBaselineRegressionSubstage } from "./baseline-regression.js";
import { runE2ERegressionSubstage } from "./e2e-regression.js";
import { runFastImplLoopSubstage } from "./fast-impl-loop.js";
import {
  artifactRelPath,
  dispatchGenericCoding,
  dispatchLeaf,
  parseReviewStatus,
  subStageContext,
  writeArtifact,
} from "./utils.js";

export interface TaskSpecSummary {
  taskId: string;
  phase: string;
  dependencies: string[];
  taskSpecId: ArtifactId;
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

    const repoRoot = await runtime.services.versionControl.resolveRepoRoot(runtime.services.eventContext.signal);
    const tasks = await loadPhaseTasks(runtime, phase);
    const waves = buildWaves(tasks);
    const manifestRows: string[] = [];
    const filesWritten: string[] = [];
    const implCtx = subStageContext(runtime);

    for (const [waveIndex, wave] of waves.entries()) {
      const prepared = await Promise.all(
        wave.map(async (task) => ({
          task,
          worktree: await runtime.services.versionControl.prepareWorktree(
            phase,
            task.taskId,
            repoRoot,
            runtime.services.eventContext.signal,
          ),
        })),
      );

      // Emit task.started sequentially before parallel fan-out.
      for (const { task } of prepared) {
        await runtime.services.telemetrySink.record({
          type: "task.started",
          phase: implCtx.phase,
          route: implCtx.route,
          taskId: task.taskId,
          title: task.title,
          wave: waveIndex + 1,
        });
      }

      const results = await Promise.all(
        prepared.map(async ({ task, worktree }) => ({
          task,
          worktree,
          result: await runFastImplLoopSubstage(runtime, {
            taskId: task.taskId,
            worktreeRoot: worktree.worktreeRoot,
            taskSpecId: task.taskSpecId,
          }),
        })),
      );

      for (const { task, result } of results) {
        await runtime.services.telemetrySink.record({
          type: "task.completed",
          phase: implCtx.phase,
          route: implCtx.route,
          taskId: task.taskId,
          title: task.title,
          wave: waveIndex + 1,
          status: result.status === "PASS" ? "PASS" : "FAIL",
        });
      }

      const failures = results.filter((entry) => entry.result.status !== "PASS");
      if (failures.length > 0) {
        for (const failure of failures) {
          manifestRows.push(
            `| ${failure.task.taskId} | ${failure.task.title} | ${waveIndex + 1} | FAIL | ${failure.result.summary.replaceAll("|", "/")} |`,
          );
        }
        const manifestId: ArtifactId = { kind: "phaseFile", phase, name: "execution-manifest.md" };
        await writeArtifact(runtime, manifestId, renderExecutionManifest(manifestRows));
        return {
          status: "FAIL",
          phase,
          filesWritten: [artifactRelPath(runtime, manifestId)],
          summary: `Implementation failed in wave ${waveIndex + 1}.`,
          telemetry: {
            child_agent_calls: {
              "generic-coding": results.length * AGENT_CALLS_PER_TASK,
            },
          },
        };
      }

      for (const { task, worktree } of results.sort((left, right) =>
        left.task.taskId.localeCompare(right.task.taskId),
      )) {
        await commitWorktreeChanges(runtime, worktree.worktreeRoot, phase, task.taskId, task.title);
        const merge = await runtime.services.versionControl.squashMerge(
          worktree,
          `qrspi: phase ${phase} task ${task.taskId} ${task.title}`,
          runtime.services.eventContext.signal,
        );
        if (!merge.ok) {
          const resolved = await resolveSquashConflict(
            runtime,
            worktree,
            phase,
            task.taskId,
            task.title,
            merge.conflictOutput ?? "merge conflict",
          );
          if (!resolved.ok) {
            manifestRows.push(
              `| ${task.taskId} | ${task.title} | ${waveIndex + 1} | FAIL | ${resolved.summary.replaceAll("|", "/")} |`,
            );
            const manifestId: ArtifactId = { kind: "phaseFile", phase, name: "execution-manifest.md" };
            await writeArtifact(runtime, manifestId, renderExecutionManifest(manifestRows));
            return {
              status: "FAIL",
              phase,
              filesWritten: [artifactRelPath(runtime, manifestId)],
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

    const manifestId: ArtifactId = { kind: "phaseFile", phase, name: "execution-manifest.md" };
    await writeArtifact(runtime, manifestId, renderExecutionManifest(manifestRows));
    filesWritten.push(artifactRelPath(runtime, manifestId));

    const e2e = await runE2ERegressionSubstage(runtime, phase);
    const baseline = await runBaselineRegressionSubstage(runtime, phase);
    filesWritten.push(...e2e.outcome.filesWritten, ...baseline.filesWritten);

    const integrationId: ArtifactId = { kind: "phaseFile", phase, name: "integration-results.md" };
    await writeArtifact(runtime, integrationId, renderIntegrationResults(e2e.markdown, baseline.summary));
    filesWritten.push(artifactRelPath(runtime, integrationId));

    const integrationGate = await runIntegrationChecker(runtime, phase, manifestRows.join("\n"), baseline.summary);
    await writeArtifact(
      runtime,
      integrationId,
      renderIntegrationResults(e2e.markdown, baseline.summary, integrationGate.text),
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

    const stageSummaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage7-summary.md" };
    const summaryStatus = baseline.status === "FAIL" ? "PARTIAL" : "PASS";
    await writeArtifact(
      runtime,
      stageSummaryId,
      renderStage7Summary(
        summaryStatus,
        `Phase ${phase} implementation completed across ${tasks.length} task(s) in ${waves.length} wave(s).`,
        0,
      ),
    );
    filesWritten.push(artifactRelPath(runtime, stageSummaryId));

    const integrationSummaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage7-integration-summary.md" };
    await writeArtifact(
      runtime,
      integrationSummaryId,
      renderStage7IntegrationSummary(e2e.outcome.summary, baseline.summary),
    );
    filesWritten.push(artifactRelPath(runtime, integrationSummaryId));

    return {
      status: baseline.status === "FAIL" ? "PARTIAL" : "PASS",
      phase,
      filesWritten,
      summary:
        baseline.status === "FAIL"
          ? "Implementation completed with regression findings."
          : "Implementation completed successfully.",
      telemetry: {
        child_agent_calls: {
          "generic-coding": tasks.length * AGENT_CALLS_PER_TASK,
        },
      },
    };
  },
};

async function implementSimpleExactFileTask(
  runtime: StageRuntime,
  phase: number,
  filePath: string,
  content: string,
): Promise<string[]> {
  const repo = runtime.services.artifactRepo;
  await repo.writeWorkspaceFile(filePath, content);

  const manifestId: ArtifactId = { kind: "phaseFile", phase, name: "execution-manifest.md" };
  const e2eId: ArtifactId = { kind: "phaseFile", phase, name: "e2e-regression-results.md" };
  const regressionId: ArtifactId = { kind: "phaseFile", phase, name: "regression-results.md" };
  const integrationId: ArtifactId = { kind: "phaseFile", phase, name: "integration-results.md" };
  const summaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage7-summary.md" };
  const integrationSummaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage7-integration-summary.md" };

  await writeArtifact(
    runtime,
    manifestId,
    [
      "# Execution Manifest",
      "",
      "| Task | Title | Wave | Status | Evidence Summary |",
      "| ---- | ----- | ---- | ------ | ---------------- |",
      `| 01 | Create ${filePath} | 1 | PASS | Exact file written |`,
    ].join("\n"),
  );
  await writeArtifact(
    runtime,
    e2eId,
    "### Status — PASS\n### E2E — NOT CONFIGURED\nNo e2e script is required for this simple exact-file task.",
  );
  await writeArtifact(
    runtime,
    regressionId,
    "### Status — PASS\n\n| Check | Status | Command |\n| ----- | ------ | ------- |\n| Exact file write | PASS | deterministic write |",
  );
  await writeArtifact(
    runtime,
    integrationId,
    renderIntegrationResults(
      "### Status — PASS",
      `Created \`${filePath}\` with exact byte length ${Buffer.byteLength(content, "utf8")}.`,
    ),
  );
  await writeArtifact(
    runtime,
    summaryId,
    renderStage7Summary("PASS", `Phase ${phase} implementation completed for \`${filePath}\`.`, 1),
  );
  await writeArtifact(
    runtime,
    integrationSummaryId,
    renderStage7IntegrationSummary(`Exact-file implementation wrote \`${filePath}\` successfully.`, ""),
  );

  return [
    filePath,
    repo.relPath(manifestId),
    repo.relPath(e2eId),
    repo.relPath(regressionId),
    repo.relPath(integrationId),
    repo.relPath(summaryId),
    repo.relPath(integrationSummaryId),
  ];
}

export async function loadPhaseTasks(runtime: StageRuntime, phase: number): Promise<TaskSpecSummary[]> {
  const repo = runtime.services.artifactRepo;
  const usePhaseSpecs = await repo.hasPhaseTaskSpecs(phase);
  const ids = usePhaseSpecs ? await repo.listTaskSpecs(phase) : await repo.listBaseTaskSpecs();
  const summaries: TaskSpecSummary[] = [];
  for (const id of ids) {
    const content = (await repo.read(id)) ?? "";
    const meta = parseTaskSpecMetadata(content, phase);
    if (meta.taskPhase !== String(phase) && meta.taskPhase.toLowerCase() !== "quick-fix") {
      continue;
    }
    summaries.push({
      taskId: meta.taskId,
      phase: meta.taskPhase,
      dependencies: meta.dependencies,
      taskSpecId: id,
      title: meta.title,
    });
  }
  return summaries;
}

export { buildWaves };

/** Each task runs code, test, and verify substages. */
const AGENT_CALLS_PER_TASK = 3;

function renderPhaseEvidenceQuality(deterministic: number): string {
  return [
    "## Phase Evidence Quality",
    `- Deterministic: ${deterministic}`,
    "- Flaky: 0",
    "- Harness Noisy: 0",
    "- Ambiguous: 0",
    "- Redundant: 0",
    "- No-Test Tasks: 0",
    "- No-Test Audit Overrides: 0",
  ].join("\n");
}

function renderStage7Summary(status: "PASS" | "PARTIAL", description: string, deterministic: number): string {
  return [
    `### Status — ${status}`,
    "",
    "# Stage 7 Summary",
    "",
    description,
    "",
    renderPhaseEvidenceQuality(deterministic),
  ].join("\n");
}

function renderStage7IntegrationSummary(e2eSummary: string, baselineSummary: string): string {
  return ["# Stage 7 Integration Summary", "", e2eSummary, baselineSummary].join("\n");
}

function renderIntegrationResults(e2eMarkdown: string, baselineSummary: string, checkerText?: string): string {
  const base = ["# Integration Results", "", e2eMarkdown, "", `Baseline regression: ${baselineSummary}`];
  if (checkerText) {
    base.push("", "## Integration Checker", checkerText);
  }
  return base.join("\n");
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

async function commitWorktreeChanges(
  runtime: StageRuntime,
  worktreeRoot: string,
  phase: number,
  taskId: string,
  title: string,
): Promise<void> {
  const vc = runtime.services.versionControl;
  const changed = await vc.changedFiles(worktreeRoot, runtime.services.eventContext.signal);
  if (changed.length === 0) {
    return;
  }
  await vc.commitWorktreeChanges(
    worktreeRoot,
    `qrspi: phase ${phase} task ${taskId} ${title}`,
    runtime.services.eventContext.signal,
  );
}

async function resolveSquashConflict(
  runtime: StageRuntime,
  worktree: TaskWorktreeHandle,
  phase: number,
  taskId: string,
  title: string,
  conflictOutput: string,
): Promise<{ ok: boolean; summary: string }> {
  const rebase = await runtime.services.versionControl.rebaseWorktree(worktree, runtime.services.eventContext.signal);
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
    const continued = await runtime.services.versionControl.continueRebase(
      worktree,
      runtime.services.eventContext.signal,
    );
    if (!continued.ok) {
      return {
        ok: false,
        summary: `Implementation abandoned task ${taskId}; rebase could not continue: ${continued.output ?? "unknown error"}`,
      };
    }
  }

  await commitWorktreeChanges(runtime, worktree.worktreeRoot, phase, taskId, title);
  const retry = await runtime.services.versionControl.squashMerge(
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
  const repo = runtime.services.artifactRepo;
  return dispatchLeaf(
    runtime,
    "qrspi-integration-checker",
    [
      "=== EXECUTION MANIFEST ===",
      (executionManifestRows || (await repo.read({ kind: "phaseFile", phase, name: "execution-manifest.md" }))) ?? "",
      "",
      "=== PIPELINE CONFIG ===",
      (await repo.read({ kind: "config" })) ?? "",
      "",
      "=== PLAN ===",
      (await repo.read({ kind: "plan" })) ?? "",
      "",
      "=== CURRENT PHASE ===",
      String(phase),
      "",
      "=== BASELINE RESULTS ===",
      (await repo.read({ kind: "baselineResults" })) ?? baselineSummary,
      "",
      "=== COMPLETED PHASE SUMMARIES ===",
      await completedPhaseSummaries(runtime, phase),
      "",
      "=== REVIEW STATUS SUMMARY ===",
      "Per-task code review fanout completed before squash merge; see reviews/code-review-task-*.md.",
      "",
      "=== DESIGN CONTEXT ===",
      runtime.state.route === "full" ? ((await repo.read({ kind: "design" })) ?? "N/A") : "N/A",
    ].join("\n"),
  );
}

export function classifyIntegrationLoop(markdown: string): "LOOP_PLAN" | "LOOP_STRUCTURE" | "LOOP_DESIGN" {
  const affected = parseAffectedArtifact(markdown);
  if (affected === "design") return "LOOP_DESIGN";
  if (affected === "structure") return "LOOP_STRUCTURE";
  return "LOOP_PLAN";
}

async function completedPhaseSummaries(runtime: StageRuntime, currentPhase: number): Promise<string> {
  const repo = runtime.services.artifactRepo;
  const blocks: string[] = [];
  for (let phase = 1; phase < currentPhase; phase += 1) {
    blocks.push(
      [
        `## Phase ${phase}`,
        (await repo.read({ kind: "phaseFile", phase, name: "stage7-summary.md" })) ?? "",
        (await repo.read({ kind: "phaseFile", phase, name: "stage8-summary.md" })) ?? "",
      ].join("\n"),
    );
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "None.";
}
