import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseOverallStatus, verifyStage } from "../../src/application/stage/verify.js";
import type { DispatchRequest, DispatchResult, Dispatcher } from "../../src/application/port/index.js";
import { TestHarness } from "../support/harness.js";
import { markStageCompleted } from "../../src/domain/run/index.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

// ---------------------------------------------------------------------------
// parseOverallStatus — pure unit tests
// ---------------------------------------------------------------------------

test("parseOverallStatus returns PASS for markdown containing ### Overall Status — PASS", () => {
  assert.equal(parseOverallStatus("### Overall Status — PASS\n\nAll good."), "PASS");
});

test("parseOverallStatus returns PARTIAL for markdown containing ### Overall Status — PARTIAL", () => {
  assert.equal(parseOverallStatus("### Overall Status — PARTIAL\n\nSome failed."), "PARTIAL");
});

test("parseOverallStatus returns FAIL for markdown containing ### Overall Status — FAIL", () => {
  assert.equal(parseOverallStatus("### Overall Status — FAIL\n\nAll failed."), "FAIL");
});

test("parseOverallStatus returns PASS via /PASS\\b/ fallback when no Overall Status heading", () => {
  assert.equal(parseOverallStatus("Verification complete. Status: PASS for all checks."), "PASS");
});

test("parseOverallStatus returns FAIL as default when no match", () => {
  assert.equal(parseOverallStatus("The system is unclear."), "FAIL");
});

test("parseOverallStatus matches lowercase status via case-insensitive regex", () => {
  // The regex uses /i so lowercase "pass" also matches
  assert.equal(parseOverallStatus("### Overall Status — pass"), "PASS");
});

test("parseOverallStatus prefers PARTIAL over PASS fallback", () => {
  assert.equal(parseOverallStatus("### Overall Status — PARTIAL\n\nSome PASS, some fail."), "PARTIAL");
});

// ---------------------------------------------------------------------------
// verifyStage scenarios
// ---------------------------------------------------------------------------

async function writeCoreArtifacts(harness: TestHarness): Promise<void> {
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. Everything works.", "utf8");
  await writeFile(harness.artifacts.requirementsFile, "Build a minimal CLI.", "utf8");
  await writeFile(harness.artifacts.designFile, "# Design\n\nSimple CLI design.", "utf8");
  await writeFile(harness.artifacts.structureFile, "# Structure\n\n- `src/cli.ts` (CREATE)", "utf8");
  await writeFile(harness.artifacts.planFile, "# Plan\n\n## Overview\nOne phase.", "utf8");
  await writeFile(harness.artifacts.baselineResultsFile, "### Baseline Status — PASS\n\nAll checks passed.", "utf8");

  const phase = harness.state.currentPhase;
  const phaseDir = path.join(harness.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(path.join(phaseDir, "execution-manifest.md"), "# Execution Manifest\n\nAll tasks PASS.", "utf8");
  await writeFile(path.join(phaseDir, "stage8-summary.md"), "### Status — PASS\n\n# Stage 8 Summary\n\nAll tests passed.", "utf8");
}

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [], endReason: "agent_end" };
}

function makeVerifyDispatcher(verifyText: string): Dispatcher {
  return {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-overall-verifier" || request.target.name === "qrspi-verifier") {
        return textResult(verifyText);
      }
      return textResult("### Status — PASS\n\n### Summary\nPass.");
    },
    async dispatchParallel(requests) { return Promise.all(requests.map((r) => this.dispatch(r))); },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
  };
}

test("verify stage returns PASS with verify_status PASS when verifier reports PASS", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "accept", "verify");
  await writeCoreArtifacts(harness);

  const verifyText = "### Overall Status — PASS\n\n### Stage Summary\nAll acceptance criteria met.";
  const dispatcher = makeVerifyDispatcher(verifyText);

  const result = await verifyStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.telemetry?.verify_status, "PASS");
});

test("verify stage returns FAIL with verify_status FAIL when verifier reports FAIL", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "accept", "verify");
  await writeCoreArtifacts(harness);

  const verifyText = "### Overall Status — FAIL\n\n### Failures\n- Criterion 1 not met.\n\n### Stage Summary\nFailed.";
  const dispatcher = makeVerifyDispatcher(verifyText);

  const result = await verifyStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.telemetry?.verify_status, "FAIL");
});

test("verify stage returns PARTIAL with verify_status PARTIAL when verifier reports PARTIAL", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "accept", "verify");
  await writeCoreArtifacts(harness);

  const verifyText = "### Overall Status — PARTIAL\n\n### Failures\n- Criterion 2 partial.\n\n### Stage Summary\nPartial.";
  const dispatcher = makeVerifyDispatcher(verifyText);

  const result = await verifyStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.telemetry?.verify_status, "PARTIAL");
});

test("verify stage uses simple exact-file fast path for quick-fix route with exact-content task", async () => {
  const harness = await TestHarness.create({ route: "quick-fix" });
  harnesses.push(harness);
  harness.state = markStageCompleted(harness.state, "accept", "verify");
  // Set userTask to a pattern that detectSimpleExactFileTask can parse
  harness.state = {
    ...harness.state,
    userTask: 'Create a SMOKE.md file containing exactly one sentence: "Deepwork smoke test."',
  };

  // Write the file so it matches exactly what the task specifies
  await writeFile(path.join(harness.workspaceRoot, "SMOKE.md"), "Deepwork smoke test.", "utf8");

  const dispatchedNames: string[] = [];
  const dispatcher: Dispatcher = {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      dispatchedNames.push(request.target.name ?? "generic");
      return textResult("### Overall Status — FAIL");
    },
    async dispatchParallel(requests) { return Promise.all(requests.map((r) => this.dispatch(r))); },
    async dispatchChain(requests) {
      const results: DispatchResult[] = [];
      for (const r of requests) results.push(await this.dispatch(r));
      return results;
    },
  };

  const result = await verifyStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PASS");
  assert.equal(dispatchedNames.length, 0, "Fast path should not dispatch to any agent");
  assert.equal(result.telemetry?.deterministic_fast_path, "simple-exact-file");
});
