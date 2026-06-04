import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { FileSystemArtifactRepository } from "../../src/infrastructure/fs/artifact-repository.js";
import { renderAcceptanceRepairContext } from "../../src/application/stage/acceptance-feedback.js";
import { runFastImplCodeSubstage } from "../../src/application/stage/fast-impl-code.js";
import { runFastImplTestSubstage } from "../../src/application/stage/fast-impl-test.js";
import { ensureRunDirectories, getRunArtifacts } from "../../src/infrastructure/fs/artifact-repository.js";
import { Run } from "../../src/domain/run/index.js";
import type {
  CustomToolResult,
  DispatchRequest,
  DispatchResult,
  Dispatcher,
  PipelineServices,
} from "../../src/application/port/index.js";
import {
  createStageReturnTool,
  normalizeStageReturn,
  type StageReturnPayload,
} from "../../src/infrastructure/pi/stage-return-tool.js";
import { TestHarness } from "../support/harness.js";
import os from "node:os";
import { mkdtemp } from "node:fs/promises";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

// ---------------------------------------------------------------------------
// renderAcceptanceRepairContext
// ---------------------------------------------------------------------------

test("renderAcceptanceRepairContext returns empty string when acceptFixAttempts is 0", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-feedback-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);

  const state = Run.start({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();

  const services = {
    commandContext: { signal: undefined },
    artifactRepo: FileSystemArtifactRepository.fromPaths(artifacts),
  } as unknown as PipelineServices;
  const result = await renderAcceptanceRepairContext({ state, workspaceRoot: workspace, services });
  assert.equal(result, "");
});

test("renderAcceptanceRepairContext returns repair context when acceptFixAttempts > 0", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-feedback-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000001");
  await ensureRunDirectories(artifacts);

  const phase = 1;
  const phaseDir = path.join(artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(path.join(phaseDir, "coverage-plan.md"), "# Coverage Plan\n\nCriterion 1: example.", "utf8");
  await writeFile(
    path.join(phaseDir, "acceptance-results.md"),
    "# Acceptance Results\n\n| 1 | Ex | FAIL | missing |",
    "utf8",
  );
  await writeFile(path.join(phaseDir, "stage8-summary.md"), "# Stage 8 Summary\n\nTests failed.", "utf8");

  const state = {
    ...Run.start({
      runId: "qrspi-20260601-000001",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      route: "full",
    }).toSnapshot(),
    acceptFixAttempts: 1,
  };

  const services = {
    commandContext: { signal: undefined },
    artifactRepo: FileSystemArtifactRepository.fromPaths(artifacts),
  } as unknown as PipelineServices;
  const result = await renderAcceptanceRepairContext({ state, workspaceRoot: workspace, services });

  assert.match(result, /ACCEPTANCE REPAIR CONTEXT/);
  assert.match(result, /retry 1/);
  assert.match(result, /COVERAGE PLAN/);
  assert.match(result, /ACCEPTANCE RESULTS/);
  assert.match(result, /STAGE 8 SUMMARY/);
  assert.match(result, /Tests failed/);
});

test("renderAcceptanceRepairContext uses None. for missing artifact files", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-feedback-missing-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000002");
  await ensureRunDirectories(artifacts);

  const state = {
    ...Run.start({
      runId: "qrspi-20260601-000002",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      route: "full",
    }).toSnapshot(),
    acceptFixAttempts: 2,
  };

  const services = {
    commandContext: { signal: undefined },
    artifactRepo: FileSystemArtifactRepository.fromPaths(artifacts),
  } as unknown as PipelineServices;
  const result = await renderAcceptanceRepairContext({ state, workspaceRoot: workspace, services });

  assert.match(result, /ACCEPTANCE REPAIR CONTEXT/);
  assert.match(result, /None\./);
});

// ---------------------------------------------------------------------------
// fast-impl-code and fast-impl-test embed the repair context when attempts > 0
// ---------------------------------------------------------------------------

async function stageReturnResult(request: DispatchRequest, payload: Record<string, unknown>): Promise<DispatchResult> {
  const tool = request.customTools?.find((t) => t.name === "stage_return");
  if (!tool) return { text: "", messages: [], customToolCalls: [] };
  const callTool = tool as unknown as { execute(...args: unknown[]): Promise<CustomToolResult> };
  const result = await callTool.execute("tool-1", payload, undefined, undefined, {});
  return { text: "", messages: [], customToolCalls: [{ name: "stage_return", result }] };
}

test("runFastImplCodeSubstage embeds repair context in prompt when acceptFixAttempts > 0", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);

  const phase = harness.state.currentPhase;
  const phaseDir = path.join(harness.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(path.join(phaseDir, "coverage-plan.md"), "# Coverage Plan\n\nCriterion 1: check output.", "utf8");
  await writeFile(
    path.join(phaseDir, "acceptance-results.md"),
    "# Acceptance Results\n\n| 1 | Ex | FAIL | missing output |",
    "utf8",
  );
  await writeFile(path.join(phaseDir, "stage8-summary.md"), "# Stage 8\n\nOutput missing.", "utf8");

  await writeFile(
    path.join(harness.artifacts.tasksDir, "task-01.md"),
    "# Task 01: Example\n\n## Metadata\n- **Task:** 01\n- **Phase:** 1\n- **Route:** full\n\n## Files\n- `src/example.ts` (MODIFY)\n",
    "utf8",
  );

  const capturedPrompts: string[] = [];
  const dispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      capturedPrompts.push(request.prompt);
      return stageReturnResult(request, { status: "PASS", filesWritten: ["src/example.ts"], summary: "Done." });
    },
    async dispatchParallel(requests) {
      return Promise.all(requests.map((r) => this.dispatch(r)));
    },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
    async dispatchGenericCoding(prompt, options) {
      const sink: StageReturnPayload[] = [];
      const result = await this.dispatch({
        target: { kind: "generic", name: "generic-coding", tools: options?.tools ?? [], thinkingLevel: "high" },
        prompt,
        cwd: options?.cwd ?? ".",
        customTools: [createStageReturnTool(sink)],
      });
      return normalizeStageReturn(result);
    },
  };

  const stateWithAttempts = { ...harness.state, acceptFixAttempts: 1 };

  await runFastImplCodeSubstage(
    { ...harness.runtime(), state: stateWithAttempts, services: { ...harness.services, dispatcher } },
    {
      taskId: "01",
      worktreeRoot: harness.workspaceRoot,
      taskSpecId: { kind: "baseTaskSpec", taskId: "01" },
      attempt: 2,
    },
  );

  assert.ok(capturedPrompts.length > 0);
  assert.match(capturedPrompts[0] ?? "", /ACCEPTANCE REPAIR CONTEXT/);
  assert.match(capturedPrompts[0] ?? "", /Output missing/);
});

test("runFastImplTestSubstage embeds repair context in prompt when acceptFixAttempts > 0", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);

  const phase = harness.state.currentPhase;
  const phaseDir = path.join(harness.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(
    path.join(phaseDir, "acceptance-results.md"),
    "# Acceptance Results\n\n| 1 | Ex | FAIL | assertion failed |",
    "utf8",
  );
  await writeFile(path.join(phaseDir, "stage8-summary.md"), "# Stage 8\n\nAssertion failed.", "utf8");

  await writeFile(
    path.join(harness.artifacts.tasksDir, "task-01.md"),
    "# Task 01: Example\n\n## Metadata\n- **Task:** 01\n- **Phase:** 1\n- **Route:** full\n\n## Files\n- `src/example.ts` (MODIFY)\n",
    "utf8",
  );

  const capturedPrompts: string[] = [];
  const dispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      capturedPrompts.push(request.prompt);
      return stageReturnResult(request, {
        status: "PASS",
        filesWritten: ["test/example.test.ts"],
        summary: "Tests written.",
        telemetry: {
          evidence_quality: {
            deterministic: 1,
            flaky: 0,
            harnessNoisy: 0,
            ambiguous: 0,
            redundant: 0,
            noTestTasks: 0,
            noTestAuditOverrides: 0,
          },
        },
      });
    },
    async dispatchParallel(requests) {
      return Promise.all(requests.map((r) => this.dispatch(r)));
    },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
    async dispatchGenericCoding(prompt, options) {
      const sink: StageReturnPayload[] = [];
      const result = await this.dispatch({
        target: { kind: "generic", name: "generic-coding", tools: options?.tools ?? [], thinkingLevel: "high" },
        prompt,
        cwd: options?.cwd ?? ".",
        customTools: [createStageReturnTool(sink)],
      });
      return normalizeStageReturn(result);
    },
  };

  const stateWithAttempts = { ...harness.state, acceptFixAttempts: 1 };

  await runFastImplTestSubstage(
    { ...harness.runtime(), state: stateWithAttempts, services: { ...harness.services, dispatcher } },
    {
      taskId: "01",
      worktreeRoot: harness.workspaceRoot,
      taskSpecId: { kind: "baseTaskSpec", taskId: "01" },
      attempt: 2,
    },
  );

  assert.ok(capturedPrompts.length > 0);
  assert.match(capturedPrompts[0] ?? "", /ACCEPTANCE REPAIR CONTEXT/);
  assert.match(capturedPrompts[0] ?? "", /Assertion failed/);
});

test("runFastImplCodeSubstage does not embed repair context when acceptFixAttempts is 0", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);

  await writeFile(
    path.join(harness.artifacts.tasksDir, "task-01.md"),
    "# Task 01: Example\n\n## Metadata\n- **Task:** 01\n- **Phase:** 1\n\n## Files\n- `src/example.ts` (MODIFY)\n",
    "utf8",
  );

  const capturedPrompts: string[] = [];
  const dispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      capturedPrompts.push(request.prompt);
      return stageReturnResult(request, { status: "PASS", filesWritten: [], summary: "Done." });
    },
    async dispatchParallel(requests) {
      return Promise.all(requests.map((r) => this.dispatch(r)));
    },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
    async dispatchGenericCoding(prompt, options) {
      const sink: StageReturnPayload[] = [];
      const result = await this.dispatch({
        target: { kind: "generic", name: "generic-coding", tools: options?.tools ?? [], thinkingLevel: "high" },
        prompt,
        cwd: options?.cwd ?? ".",
        customTools: [createStageReturnTool(sink)],
      });
      return normalizeStageReturn(result);
    },
  };

  await runFastImplCodeSubstage(
    { ...harness.runtime(), services: { ...harness.services, dispatcher } },
    {
      taskId: "01",
      worktreeRoot: harness.workspaceRoot,
      taskSpecId: { kind: "baseTaskSpec", taskId: "01" },
      attempt: 1,
    },
  );

  assert.ok(capturedPrompts.length > 0);
  assert.ok(!(capturedPrompts[0] ?? "").includes("ACCEPTANCE REPAIR CONTEXT"));
});
