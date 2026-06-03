import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { planStage, writePlanArtifacts } from "../../src/application/stage/plan.js";
import type { DispatchRequest, DispatchResult, Dispatcher } from "../../src/application/port/index.js";
import type { RunArtifacts } from "../../src/infrastructure/fs/artifact-repository.js";
import { TestHarness } from "../support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

test("writePlanArtifacts recovers loose fenced artifact blocks", async () => {
  const harness = await TestHarness.create({ route: "quick-fix", totalPhases: 1 });
  harnesses.push(harness);

  const filesWritten = await writePlanArtifacts(
    harness.runtime(),
    [
      "```markdown",
      "# Implementation Plan",
      "",
      "## Overview",
      "Create one smoke marker file.",
      "```",
      "",
      "```markdown",
      "---",
      "total_phases: 1",
      "---",
      "",
      "## Phase 1 — Quick-fix",
      "",
      "- **Tasks:** 01",
      "- **Acceptance Criteria:** AC-1",
      "- **Replan Gate:** N/A (single-phase route)",
      "```",
      "",
      "```",
      "Task: 01",
      "Title: Create SMOKE.md marker",
      "Phase: Quick-fix",
      "Route: quick-fix",
      "Slice: quick-fix",
      "Dependencies: None",
      "Scope: Create one file.",
      "Acceptance Criteria: AC-1",
      "NFRs: None",
      "Gate Criteria: None",
      "Files:",
      "  - SMOKE.md (CREATE) — write marker content",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(filesWritten, ["plan.md", "phase-manifest.md", "tasks/outlines/task-01.outline"]);
  assert.equal(await readFile(harness.artifacts.planFile, "utf8"), "# Implementation Plan\n\n## Overview\nCreate one smoke marker file.\n");
  assert.match(await readFile(harness.artifacts.phaseManifestFile, "utf8"), /^---\ntotal_phases: 1\n---/);
  assert.doesNotMatch(await readFile(`${harness.artifacts.outlinesDir}/task-01.outline`, "utf8"), /```/);
});

test("plan returns unclean-cap when task spec review does not converge", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 1 });
  harnesses.push(harness);
  await writeFile(harness.artifacts.requirementsFile, "Build a minimal CLI.", "utf8");
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. CLI exists.", "utf8");
  await writeFile(harness.artifacts.researchSummaryFile, "# Research Summary\n\nNo blocking findings.", "utf8");
  await writeFile(harness.artifacts.designFile, "# Design\n\nOne slice.", "utf8");
  await writeFile(harness.artifacts.structureFile, "# Structure\n\n- `src/index.ts`", "utf8");
  await writeFile(harness.artifacts.configFile, "---\nroute: full\n---", "utf8");

  const outcome = await planStage.run({
    ...harness.runtime(),
    services: {
      ...harness.services,
      dispatcher: new TaskReviewCapDispatcher(harness.artifacts),
    },
  });

  assert.equal(outcome.status, "FAIL");
  assert.equal(outcome.telemetry?.terminal_review_state, "unclean-cap");
  assert.match(outcome.summary, /Task spec review did not converge for task 01/);
  assert.match(await readFile(harness.artifacts.baselineResultsFile, "utf8"), /Baseline Status — PARTIAL/);
});

class TaskReviewCapDispatcher implements Dispatcher {
  constructor(private readonly artifacts: RunArtifacts) {}

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    switch (request.target.name) {
      case "qrspi-plan-writer":
        return textResult(renderPlanWriterOutput());
      case "qrspi-plan-reviewer":
        return textResult("### Status — PASS\n\n### Summary\nPlan is acceptable.");
      case "qrspi-task-spec-writer": {
        const taskNumber = request.prompt.match(/=== TASK NUMBER ===\n(\d+)/)?.[1] ?? "01";
        await writeFile(path.join(this.artifacts.tasksDir, `task-${taskNumber}.md`), renderTaskSpec(taskNumber), "utf8");
        return textResult("### Status — PASS\n\n### Summary\nTask spec written.");
      }
      case "qrspi-task-spec-reviewer":
        return textResult("### Status — FAIL\n\n### Fix Guidance\nStill incomplete.");
      default:
        return textResult("### Status — PASS\n\n### Summary\nPass.");
    }
  }

  async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((request) => this.dispatch(request)));
  }

  async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const request of requests) {
      results.push(await this.dispatch(request));
    }
    return results;
  }

  async dispatchGenericCoding(_prompt: string) {
    return { status: "PASS" as const, filesWritten: [], summary: "" };
  }
}

function renderPlanWriterOutput(): string {
  return [
    "### plan.md",
    "# Implementation Plan",
    "",
    "## Overview",
    "Create the CLI.",
    "",
    "### phase-manifest.md",
    "---",
    "total_phases: 1",
    "---",
    "",
    "## Phase 1",
    "- **Tasks:** 01",
    "",
    "### task-01.outline",
    "Task: 01",
    "Title: Create CLI entry",
    "Phase: 1",
    "Route: full",
    "Slice: cli",
    "Dependencies: None",
    "Scope: Add entry point.",
    "Acceptance Criteria: AC-1",
    "NFRs: None",
    "Gate Criteria: None",
    "Files:",
    "  - src/index.ts (CREATE)",
  ].join("\n");
}

function renderTaskSpec(taskNumber: string): string {
  return [
    `# Task ${taskNumber}: Create CLI entry`,
    "",
    "## Metadata",
    `- **Task:** ${taskNumber}`,
    "- **Phase:** 1",
    "- **Route:** full",
    "- **Slice:** cli",
    "",
    "## Dependencies",
    "- None",
    "",
    "## Files",
    "- `src/index.ts` (CREATE)",
  ].join("\n");
}

function textResult(text: string): DispatchResult {
  return {
    text,
    messages: [{ role: "assistant", content: text }],
    customToolCalls: [],
    endReason: "agent_end",
  };
}
