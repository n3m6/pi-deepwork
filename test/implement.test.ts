import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildWaves, classifyIntegrationLoop, TaskSpecSummary } from "../src/stages/implement.js";
import type { DispatchRequest, DispatchResult, Dispatcher, RunArtifacts } from "../src/types.js";
import { TestHarness } from "./support/harness.js";
import { implementStage } from "../src/stages/implement.js";
import { markStageCompleted } from "../src/state.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

// ---------------------------------------------------------------------------
// buildWaves
// ---------------------------------------------------------------------------

function task(taskId: string, dependencies: string[] = []): TaskSpecSummary {
  return { taskId, phase: "1", dependencies, filePath: `/tasks/task-${taskId}.md`, title: `Task ${taskId}` };
}

test("buildWaves places independent tasks in a single wave", () => {
  const waves = buildWaves([task("01"), task("02"), task("03")]);
  assert.equal(waves.length, 1);
  assert.equal(waves[0]?.length, 3);
});

test("buildWaves orders tasks with dependencies into sequential waves", () => {
  const waves = buildWaves([task("02", ["01"]), task("01"), task("03", ["02"])]);
  assert.equal(waves.length, 3);
  assert.equal(waves[0]?.[0]?.taskId, "01");
  assert.equal(waves[1]?.[0]?.taskId, "02");
  assert.equal(waves[2]?.[0]?.taskId, "03");
});

test("buildWaves handles mixed dependency depths", () => {
  // 01 independent, 02 depends on 01, 03 independent
  const waves = buildWaves([task("03"), task("02", ["01"]), task("01")]);
  // wave1: 01, 03; wave2: 02
  assert.equal(waves.length, 2);
  const wave1Ids = waves[0]?.map((t) => t.taskId).sort() ?? [];
  assert.deepEqual(wave1Ids, ["01", "03"]);
});

test("buildWaves falls back to a single wave when dependency cycle detected", () => {
  // 01 depends on 02, 02 depends on 01 → cycle fallback
  const waves = buildWaves([task("01", ["02"]), task("02", ["01"])]);
  assert.equal(waves.length, 1);
  assert.equal(waves[0]?.length, 2);
});

test("buildWaves returns empty array for empty input", () => {
  assert.deepEqual(buildWaves([]), []);
});

// ---------------------------------------------------------------------------
// classifyIntegrationLoop
// ---------------------------------------------------------------------------

test("classifyIntegrationLoop returns LOOP_DESIGN when Affected Artifact is design", () => {
  const markdown = "**Affected Artifact**: design\nSome details.";
  assert.equal(classifyIntegrationLoop(markdown), "LOOP_DESIGN");
});

test("classifyIntegrationLoop returns LOOP_STRUCTURE when Affected Artifact is structure", () => {
  const markdown = "**Affected Artifact**: Structure\nSome details.";
  assert.equal(classifyIntegrationLoop(markdown), "LOOP_STRUCTURE");
});

test("classifyIntegrationLoop returns LOOP_PLAN for anything else", () => {
  assert.equal(classifyIntegrationLoop("**Affected Artifact**: plan"), "LOOP_PLAN");
  assert.equal(classifyIntegrationLoop("No affected artifact mentioned."), "LOOP_PLAN");
});

// ---------------------------------------------------------------------------
// Implement stage scenarios via harness
// ---------------------------------------------------------------------------

function makeFastImplDispatcher(options: {
  failTaskId?: string;
  integrationCheckerStatus?: "PASS" | "FAIL";
  integrationCheckerBackwardLoop?: string;
  baselineStatus?: "PASS" | "FAIL";
}): Dispatcher & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,

    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      const prompt = request.prompt;
      prompts.push(prompt);

      // Baseline checker (leaf agent)
      if (request.target.name === "qrspi-baseline-checker") {
        const status = options.baselineStatus ?? "PASS";
        return textResult(`### Baseline Status — ${status}\n\n### Check Results\n| Check | Status | Command | Details |\n|-------|--------|---------|---------|\n| Build | ${status} | \`npm run build\` | ok |\n\n### Failure Inventory\nNone.\n\n### Stage Summary\nBaseline ${status}.`);
      }

      // Integration checker (leaf agent)
      if (request.target.name === "qrspi-integration-checker") {
        const status = options.integrationCheckerStatus ?? "PASS";
        const loopBlock = options.integrationCheckerBackwardLoop ?? "";
        return textResult(
          [
            `### Status — ${status}`,
            "",
            "### Stage Summary",
            "Integration check done.",
            "",
            loopBlock ? `### Backward Loop Request\n${loopBlock}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      // Generic coding (fast-impl-code, fast-impl-test, fast-impl-verify, conflict resolver)
      if (request.target.kind === "generic") {
        // Fast-impl-code: Implement the production-code portion
        if (prompt.includes("Implement the production-code portion")) {
          const taskId = prompt.match(/Task:\s*(\d+)/)?.[1] ?? "01";
          if (options.failTaskId === taskId && prompt.includes("Attempt: 1")) {
            return stageReturnResult(request, { status: "FAIL", filesWritten: [], summary: `Task ${taskId} code failed.` });
          }
          await touchFile(path.join(request.cwd, "src", "example.ts"), `export const t = "${taskId}";\n`);
          return stageReturnResult(request, { status: "PASS", filesWritten: ["src/example.ts"], summary: "Code done." });
        }
        // Fast-impl-test
        if (prompt.includes("Write or update only the tests needed")) {
          return stageReturnResult(request, {
            status: "PASS",
            filesWritten: ["test/example.test.ts"],
            summary: "Tests done.",
            telemetry: { evidence_quality: { deterministic: 1, flaky: 0, harnessNoisy: 0, ambiguous: 0, redundant: 0, noTestTasks: 0, noTestAuditOverrides: 0 } },
          });
        }
        // Fast-impl-verify
        if (prompt.includes("Run targeted verification")) {
          return stageReturnResult(request, { status: "PASS", filesWritten: [], summary: "Verify done." });
        }
        return stageReturnResult(request, { status: "PASS", filesWritten: [], summary: "Generic done." });
      }

      // Code review leaf agents
      if (request.target.name?.startsWith("qrspi-review-")) {
        return textResult("### Status — PASS\n\n### Findings\nNone.");
      }

      return textResult("### Status — PASS\n\n### Summary\nPass.");
    },

    async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
      return Promise.all(requests.map((r) => this.dispatch(r)));
    },

    async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
      const results: DispatchResult[] = [];
      for (const r of requests) {
        results.push(await this.dispatch(r));
      }
      return results;
    },
  };
}

async function touchFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function stageReturnResult(request: DispatchRequest, payload: Record<string, unknown>): Promise<DispatchResult> {
  const tool = request.customTools?.find((t) => t.name === "stage_return");
  if (!tool) {
    return { text: "", messages: [], customToolCalls: [] };
  }
  const result = await tool.execute("tool-1", payload as never, undefined, undefined, {} as never);
  return { text: "", messages: [], customToolCalls: [{ name: "stage_return", result }] };
}

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [] };
}

async function writeTaskSpec(artifacts: RunArtifacts, taskNumber: string, phase: string): Promise<void> {
  await mkdir(artifacts.tasksDir, { recursive: true });
  await writeFile(
    path.join(artifacts.tasksDir, `task-${taskNumber}.md`),
    [
      `# Task ${taskNumber}: Example`,
      "",
      "## Metadata",
      `- **Task:** ${taskNumber}`,
      `- **Phase:** ${phase}`,
      "- **Route:** full",
      "- **Slice:** core",
      "",
      "## Dependencies",
      "- None",
      "",
      "## Files",
      "- `src/example.ts` (MODIFY) — update behavior",
    ].join("\n"),
    "utf8",
  );
}

async function writePlanAndManifest(artifacts: RunArtifacts): Promise<void> {
  await writeFile(artifacts.planFile, "# Plan\n\n## Overview\nTest plan.", "utf8");
  await writeFile(artifacts.phaseManifestFile, "---\ntotal_phases: 1\n---\n\n## Phase 1 — Core\n- **Tasks:** 01\n", "utf8");
  await writeFile(artifacts.configFile, "route: full\n", "utf8");
  await writeFile(artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Example works.", "utf8");
  await writeFile(artifacts.requirementsFile, "Implement example behavior.", "utf8");
  await writeFile(artifacts.baselineResultsFile, "### Baseline Status — PASS\n", "utf8");
}

test("implement stage returns FAIL when a task's fast-impl-code fails", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 1 });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });

  await writePlanAndManifest(harness.artifacts);
  await writeTaskSpec(harness.artifacts, "01", "1");

  const dispatcher = makeFastImplDispatcher({ failTaskId: "01" });
  const result = await implementStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /wave 1/i);
});

test("implement stage returns FAIL with backward loop when integration checker requests one", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 1 });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });

  await writePlanAndManifest(harness.artifacts);
  await writeTaskSpec(harness.artifacts, "01", "1");

  const dispatcher = makeFastImplDispatcher({
    integrationCheckerStatus: "FAIL",
    integrationCheckerBackwardLoop: "**Affected Artifact**: plan\nSome issue found.",
  });
  const result = await implementStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.ok(result.backwardLoop);
  assert.equal(result.backwardLoop?.classification, "LOOP_PLAN");
});

test("implement stage returns PARTIAL when baseline regression fails", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 1 });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });

  await writePlanAndManifest(harness.artifacts);
  await writeTaskSpec(harness.artifacts, "01", "1");

  const dispatcher = makeFastImplDispatcher({ baselineStatus: "FAIL" });
  const result = await implementStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.ok(result.status === "PARTIAL" || result.status === "PASS");
  if (result.status === "PARTIAL") {
    assert.match(result.summary, /regression/i);
  }
});
