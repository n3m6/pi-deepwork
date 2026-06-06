import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isTestFile,
  isPipelineArtifact,
  runAcceptanceTesterSubstage,
} from "../../src/application/stage/acceptance-tester.js";
import type {
  CustomToolResult,
  DispatchRequest,
  DispatchResult,
  Dispatcher,
  VersionControl,
} from "../../src/application/port/index.js";
import {
  createStageReturnTool,
  normalizeStageReturn,
  type StageReturnPayload,
} from "../../src/infra/pi/stage-return-tool.js";
import { TestHarness } from "../support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

test("isTestFile returns true for __tests__ directory", () => {
  assert.equal(isTestFile("src/__tests__/foo.ts"), true);
  assert.equal(isTestFile("__tests__/bar.ts"), true);
});

test("isTestFile returns true for test directory", () => {
  assert.equal(isTestFile("test/foo.ts"), true);
  assert.equal(isTestFile("src/test/foo.ts"), true);
});

test("isTestFile returns true for spec directory", () => {
  assert.equal(isTestFile("spec/bar.ts"), true);
});

test("isTestFile returns true for .test.ts filename suffix", () => {
  assert.equal(isTestFile("src/foo.test.ts"), true);
  assert.equal(isTestFile("foo.test.js"), true);
});

test("isTestFile returns true for .spec.ts filename suffix", () => {
  assert.equal(isTestFile("src/foo.spec.ts"), true);
});

test("isTestFile returns true for _test suffix", () => {
  assert.equal(isTestFile("src/foo_test.ts"), true);
});

test("isTestFile returns false for regular source files", () => {
  assert.equal(isTestFile("src/controller.ts"), false);
  assert.equal(isTestFile("src/stages/implement.ts"), false);
});

test("isTestFile returns false for test-adjacent config files", () => {
  assert.equal(isTestFile("testconfig.ts"), false);
  assert.equal(isTestFile("src/attestation.ts"), false);
});

// ---------------------------------------------------------------------------
// isPipelineArtifact
// ---------------------------------------------------------------------------

test("isPipelineArtifact returns true for .pipeline/ paths", () => {
  assert.equal(isPipelineArtifact(".pipeline/run-id/state.json"), true);
  assert.equal(isPipelineArtifact(".pipeline/"), true);
});

test("isPipelineArtifact returns false for other paths", () => {
  assert.equal(isPipelineArtifact("src/foo.ts"), false);
  assert.equal(isPipelineArtifact("pipeline/foo.ts"), false);
});

// ---------------------------------------------------------------------------
// runAcceptanceTesterSubstage scenarios
// ---------------------------------------------------------------------------

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [], endReason: "agent_end" };
}

async function stageReturnResult(request: DispatchRequest, payload: Record<string, unknown>): Promise<DispatchResult> {
  const tool = request.customTools?.find((t) => t.name === "stage_return");
  if (!tool) {
    return { text: "", messages: [], customToolCalls: [] };
  }
  const callTool = tool as unknown as { execute(...args: unknown[]): Promise<CustomToolResult> };
  const result = await callTool.execute("tool-1", payload, undefined, undefined, {});
  return { text: "", messages: [], customToolCalls: [{ name: "stage_return", result }] };
}

async function writeCoreArtifacts(harness: TestHarness): Promise<void> {
  const phase = harness.state.currentPhase;
  const phaseDir = path.join(harness.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Example criterion.", "utf8");
  await writeFile(harness.artifacts.requirementsFile, "Example requirement.", "utf8");
  await writeFile(harness.artifacts.designFile, "# Design\n\nOne slice.", "utf8");
  await writeFile(harness.artifacts.structureFile, "# Structure\n\n- src/example.ts", "utf8");
  await writeFile(
    harness.artifacts.phaseManifestFile,
    "---\ntotal_phases: 1\n---\n\n## Phase 1\n- **Tasks:** 01\n",
    "utf8",
  );
  await writeFile(
    path.join(phaseDir, "execution-manifest.md"),
    "# Execution Manifest\n\n| Task | Title | Wave | Status | Evidence Summary |\n| 01 | Ex | 1 | PASS | ok |\n",
    "utf8",
  );
}

test("runAcceptanceTesterSubstage returns unclean-cap when plan reviewers fail for 3 cycles", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const dispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-coverage-planner") {
        return textResult("### Coverage Plan\n- Criterion 1: Example\n  - Action: new\n  - Test Type: unit");
      }
      if (request.target.name?.startsWith("qrspi-review-accept-")) {
        return textResult(
          "### Status — FAIL\n\n### Findings\n| 1 | HIGH | file | 1 | bug | issue | fix |\n\n### Summary\nPlan incomplete.",
        );
      }
      return textResult("### Status — PASS\n\n### Summary\nPass.");
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

  const result = await runAcceptanceTesterSubstage({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.telemetry?.terminal_review_state, "unclean-cap");
  assert.ok((result.telemetry?.planner_review_cycles as number) >= 3);
});

test("runAcceptanceTesterSubstage returns boundary_violation when non-test files appear after acceptance run", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  let changedFilesCallCount = 0;
  const mockVersionControl: VersionControl = {
    ...harness.services.versionControl,
    async changedFiles(_cwd: string): Promise<string[]> {
      changedFilesCallCount += 1;
      // Second call (after acceptance) adds a production file
      if (changedFilesCallCount >= 2) {
        return ["src/production-code.ts", "test/example.test.ts"];
      }
      return ["test/example.test.ts"];
    },
  };
  const runtimeWithBoundaryViolation = {
    ...harness.runtime(),
    services: {
      ...harness.services,
      versionControl: mockVersionControl,
      dispatcher: {
        async dispatch(request: DispatchRequest): Promise<DispatchResult> {
          if (request.target.name === "qrspi-coverage-planner") {
            return textResult("### Coverage Plan\n- Criterion 1: Example\n  - Action: new");
          }
          if (request.target.name?.startsWith("qrspi-review-accept-")) {
            return textResult("### Status — PASS\n\n### Summary\nPass.");
          }
          if (request.target.kind === "generic") {
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
          }
          return textResult("### Status — PASS\n\n### Summary\nPass.");
        },
        async dispatchParallel(requests: DispatchRequest[]) {
          return Promise.all(requests.map((r) => this.dispatch(r)));
        },
        async dispatchChain(requests: DispatchRequest[]) {
          const results: DispatchResult[] = [];
          for (const r of requests) results.push(await this.dispatch(r));
          return results;
        },
        async dispatchGenericCoding(prompt: string, options?: { cwd?: string; tools?: string[] }) {
          const sink: StageReturnPayload[] = [];
          const result = await this.dispatch({
            target: { kind: "generic", name: "generic-coding", tools: options?.tools ?? [], thinkingLevel: "high" },
            prompt,
            cwd: options?.cwd ?? ".",
            customTools: [createStageReturnTool(sink)],
          });
          return normalizeStageReturn(result);
        },
      },
    },
  };

  const result = await runAcceptanceTesterSubstage(runtimeWithBoundaryViolation);

  assert.equal(result.status, "FAIL");
  assert.equal(result.telemetry?.boundary_violation, true);
});

test("runAcceptanceTesterSubstage retries acceptance dispatch up to 3 rounds on FAIL", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  let acceptanceCalls = 0;

  const dispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-coverage-planner") {
        return textResult("### Coverage Plan\n- Criterion 1: Example");
      }
      if (request.target.name?.startsWith("qrspi-review-accept-")) {
        return textResult("### Status — PASS\n\n### Summary\nPass.");
      }
      if (request.target.kind === "generic") {
        acceptanceCalls += 1;
        if (acceptanceCalls < 3) {
          return stageReturnResult(request, { status: "FAIL", filesWritten: [], summary: "Not yet passing." });
        }
        const phase = harness.state.currentPhase;
        const phaseDir = path.join(harness.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
        await writeFile(
          path.join(phaseDir, "acceptance-results.md"),
          "# Acceptance Results\n\n| 1 | Ex | PASS | none |\n",
          "utf8",
        );
        await writeFile(
          path.join(phaseDir, "stage8-summary.md"),
          "### Status — PASS\n\n# Stage 8 Summary\nPassed.",
          "utf8",
        );
        return stageReturnResult(request, {
          status: "PASS",
          filesWritten: ["test/example.test.ts"],
          summary: "Tests passed.",
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
      }
      return textResult("### Status — PASS\n\n### Summary\nPass.");
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

  const result = await runAcceptanceTesterSubstage({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PASS");
  assert.equal(acceptanceCalls, 3);
  assert.equal(result.telemetry?.acceptance_loop_rounds, 3);
});
