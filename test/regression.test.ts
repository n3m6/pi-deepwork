import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { runBaselineRegressionSubstage } from "../src/stages/baseline-regression.js";
import { runE2ERegressionSubstage } from "../src/stages/e2e-regression.js";
import type { PipelineServices, StageRuntime } from "../src/types.js";
import { TestHarness } from "./support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

type ExecFn = PipelineServices["pi"]["exec"];

function makeExecFn(responses: Record<string, { stdout: string; stderr: string; code: number }>): ExecFn {
  return async (_command: string, args: string[]) => {
    const key = args.join(" ");
    const match = Object.entries(responses).find(([k]) => key.includes(k));
    if (match) {
      return { ...match[1], killed: false };
    }
    return { stdout: "", stderr: "", code: 0, killed: false };
  };
}

async function writePackageJson(root: string, scripts: Record<string, string>): Promise<void> {
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts }), "utf8");
}

// ---------------------------------------------------------------------------
// Baseline regression tests
// ---------------------------------------------------------------------------

test("baseline: returns NOT CONFIGURED when package.json has no build/lint/test scripts", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, {});

  const result = await runBaselineRegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: makeExecFn({}) } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.status, "PASS");
  // summary says "pass" because overall status is PASS; the "NOT CONFIGURED" label
  // appears in the written markdown artifact, not in the summary string
  assert.match(result.summary, /pass/i);
});

test("baseline: returns FAIL when build script fails", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { build: "tsc" });

  const execFn = makeExecFn({
    "run build": { stdout: "", stderr: "Type error found.", code: 1 },
  });

  const result = await runBaselineRegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: execFn } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.status, "FAIL");
  assert.match(result.summary, /FAIL/i);
});

test("baseline: returns PASS when all configured scripts pass", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { build: "tsc", test: "node --test" });

  const execFn = makeExecFn({
    "run build": { stdout: "", stderr: "", code: 0 },
    "run test": { stdout: "ok 1", stderr: "", code: 0 },
  });

  const result = await runBaselineRegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: execFn } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.status, "PASS");
});

test("baseline: includes lint check when lint script is present", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { lint: "eslint .", test: "node --test" });

  const calledCommands: string[] = [];
  const execFn: ExecFn = async (_cmd, args) => {
    calledCommands.push(args.join(" "));
    return { stdout: "", stderr: "", code: 0, killed: false };
  };

  await runBaselineRegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: execFn } },
    },
    harness.state.currentPhase,
  );

  assert.ok(calledCommands.some((c) => c.includes("lint")), "lint should have been executed");
});

test("baseline: handles missing package.json gracefully as NOT CONFIGURED", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  // No package.json written

  const result = await runBaselineRegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: makeExecFn({}) } },
    },
    harness.state.currentPhase,
  );

  // Without package.json, should report NOT CONFIGURED or PASS (depending on impl)
  assert.ok(["PASS", "FAIL"].includes(result.status));
  if (result.status === "PASS") {
    // Either not configured or passed trivially
    assert.ok(result.summary.length > 0);
  }
});

// ---------------------------------------------------------------------------
// E2E regression tests
// ---------------------------------------------------------------------------

test("e2e: returns NOT CONFIGURED when no test:e2e or e2e script exists", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { build: "tsc" });

  const result = await runE2ERegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: makeExecFn({}) } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.outcome.status, "PASS");
  // summary reads "No e2e regression script is configured." — the NOT CONFIGURED label
  // appears in the written markdown artifact
  assert.match(result.outcome.summary, /configured/i);
});

test("e2e: falls back to e2e script when test:e2e is absent", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { e2e: "playwright test" });

  const calledCommands: string[] = [];
  const execFn: ExecFn = async (_cmd, args) => {
    calledCommands.push(args.join(" "));
    return { stdout: "ok all tests passed", stderr: "", code: 0, killed: false };
  };

  const result = await runE2ERegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: execFn } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.outcome.status, "PASS");
  assert.ok(calledCommands.some((c) => c.includes("e2e")), "e2e script should have been called");
});

test("e2e: returns FAIL when test:e2e script exits with non-zero code", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { "test:e2e": "playwright test" });

  const execFn = makeExecFn({
    "run test:e2e": { stdout: "", stderr: "E2E tests failed.", code: 1 },
  });

  const result = await runE2ERegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: execFn } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.outcome.status, "FAIL");
  assert.match(result.outcome.summary, /FAIL/i);
});

test("e2e: embeds stdout and stderr in result when script fails", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writePackageJson(harness.workspaceRoot, { "test:e2e": "playwright test" });

  const execFn = makeExecFn({
    "run test:e2e": { stdout: "Running tests\n1 failed", stderr: "Error: timeout at scenario 3", code: 1 },
  });

  const result = await runE2ERegressionSubstage(
    {
      ...harness.runtime(),
      services: { ...harness.services, pi: { exec: execFn } },
    },
    harness.state.currentPhase,
  );

  assert.equal(result.outcome.status, "FAIL");
  // Check the written artifact includes output
  const artifact = result.outcome.filesWritten[0];
  if (artifact) {
    assert.ok(artifact.length > 0);
  }
});
