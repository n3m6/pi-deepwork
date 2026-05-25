import test from "node:test";
import assert from "node:assert/strict";

import { ENABLED_AGENT_FIELDS, getBody, parseFrontmatter } from "./helpers";

const stage6Agents = [
  "qrspi-implement.md",
  "qrspi-fast-impl-loop.md",
  "qrspi-fast-impl-code.md",
  "qrspi-fast-impl-test.md",
  "qrspi-fast-impl-verify.md",
  "qrspi-e2e-regression-checker.md",
  "qrspi-integration-checker.md",
  "qrspi-baseline-regression-checker.md",
] as const;

const frontmatter: Record<(typeof stage6Agents)[number], Record<string, string>> = {
  "qrspi-implement.md": parseFrontmatter("qrspi-implement.md"),
  "qrspi-fast-impl-loop.md": parseFrontmatter("qrspi-fast-impl-loop.md"),
  "qrspi-fast-impl-code.md": parseFrontmatter("qrspi-fast-impl-code.md"),
  "qrspi-fast-impl-test.md": parseFrontmatter("qrspi-fast-impl-test.md"),
  "qrspi-fast-impl-verify.md": parseFrontmatter("qrspi-fast-impl-verify.md"),
  "qrspi-e2e-regression-checker.md": parseFrontmatter("qrspi-e2e-regression-checker.md"),
  "qrspi-integration-checker.md": parseFrontmatter("qrspi-integration-checker.md"),
  "qrspi-baseline-regression-checker.md": parseFrontmatter("qrspi-baseline-regression-checker.md"),
};
const implementBody = getBody("qrspi-implement.md");
const loopBody = getBody("qrspi-fast-impl-loop.md");
const codeBody = getBody("qrspi-fast-impl-code.md");
const testBody = getBody("qrspi-fast-impl-test.md");
const verifyBody = getBody("qrspi-fast-impl-verify.md");
const e2eBody = getBody("qrspi-e2e-regression-checker.md");
const integrationBody = getBody("qrspi-integration-checker.md");
const baselineBody = getBody("qrspi-baseline-regression-checker.md");

test("stage 6 implementation agent files have parseable frontmatter with enabled schema", () => {
  for (const name of stage6Agents) {
    assert.deepEqual(Object.keys(frontmatter[name]).sort(), ENABLED_AGENT_FIELDS, `${name} frontmatter schema mismatch`);
  }
});

test("stage 6 implementation agents use the expected model profile", () => {
  assert.equal(frontmatter["qrspi-implement.md"].model, "deepseek-v4-pro");
  assert.equal(frontmatter["qrspi-implement.md"].thinking, "high");

  for (const name of [
    "qrspi-fast-impl-loop.md",
    "qrspi-fast-impl-code.md",
    "qrspi-fast-impl-test.md",
    "qrspi-fast-impl-verify.md",
  ] as const) {
    assert.equal(frontmatter[name].model, "deepseek-v4-pro", `${name} must use deepseek-v4-pro`);
    assert.equal(frontmatter[name].thinking, "high", `${name} must use high thinking`);
  }

  for (const name of [
    "qrspi-e2e-regression-checker.md",
    "qrspi-integration-checker.md",
    "qrspi-baseline-regression-checker.md",
  ] as const) {
    assert.equal(frontmatter[name].model, "deepseek-v4-pro", `${name} must use deepseek-v4-pro`);
    assert.equal(frontmatter[name].thinking, "high", `${name} must use high thinking`);
  }
});

test("stage 6 agents that dispatch subagents have extensions: true", () => {
  const dispatchingAgents = [
    "qrspi-implement.md",
    "qrspi-fast-impl-loop.md",
    "qrspi-e2e-regression-checker.md",
    "qrspi-baseline-regression-checker.md",
  ] as const;

  for (const name of dispatchingAgents) {
    assert.equal(frontmatter[name].extensions, "true", `${name} must have extensions: true to use native Agent tool`);
  }
});

test("stage 6 implementation orchestrator uses background join semantics for batch work", () => {
  assert.match(implementBody, /run_in_background: true/);
  assert.match(implementBody, /get_subagent_result/);
});

test("qrspi-implement documents the Stage 6 orchestration contract", () => {
  assert.match(implementBody, /Stage 6 implementation orchestrator/i);
  assert.match(implementBody, /verify-fix/);
  assert.match(implementBody, /qrspi-fast-impl-loop/);
  assert.match(implementBody, /qrspi-e2e-regression-checker/);
  assert.match(implementBody, /qrspi-integration-checker/);
  assert.match(implementBody, /qrspi-baseline-regression-checker/);
  assert.match(implementBody, /WORKTREE ROOT/);
  assert.match(implementBody, /### Status — PASS/);
  assert.match(implementBody, /### Status — FAIL/);
  assert.match(implementBody, /### Backward Loop Request/);
  assert.match(implementBody, /"evidence_quality": \{"deterministic": <n>/);
});

test("qrspi-fast-impl-loop routes exclusively by explicit verify route hints", () => {
  assert.match(loopBody, /qrspi-fast-impl-code/);
  assert.match(loopBody, /qrspi-fast-impl-test/);
  assert.match(loopBody, /qrspi-fast-impl-verify/);
  assert.match(loopBody, /### Route Hint/);
  assert.match(loopBody, /CODE_REPAIR/);
  assert.match(loopBody, /TEST_REPAIR/);
  assert.match(loopBody, /CODE_AND_TEST_REPAIR/);
  assert.match(loopBody, /BACKWARD_LOOP/);
  assert.match(loopBody, /### Unresolved Findings/);
});

test("qrspi-fast-impl-code delegates implementation to general-purpose and never writes tests", () => {
  assert.match(codeBody, /`general-purpose`/);
  assert.match(codeBody, /general-purpose child worker/i);
  assert.match(codeBody, /subagent_type: "general-purpose"/);
  assert.match(codeBody, /Production code only/);
  assert.match(codeBody, /never author tests/i);
  assert.match(codeBody, /### Files Modified/);
  assert.match(codeBody, /### Files Created/);
  assert.match(codeBody, /### Backward Loop Request/);
});

test("qrspi-fast-impl-test and qrspi-fast-impl-verify use the shared general-purpose child-worker template", () => {
  assert.match(testBody, /subagent_type: "general-purpose"/);
  assert.match(testBody, /general-purpose child worker/i);
  assert.match(verifyBody, /subagent_type: "general-purpose"/);
  assert.match(verifyBody, /general-purpose child worker/i);
  assert.match(verifyBody, /for `qrspi-fast-impl-verify`/);
});

test("qrspi-fast-impl-test classifies evidence and supports no-task-authored-tests", () => {
  assert.match(testBody, /DETERMINISTIC/);
  assert.match(testBody, /FLAKY/);
  assert.match(testBody, /HARNESS_NOISY/);
  assert.match(testBody, /AMBIGUOUS/);
  assert.match(testBody, /REDUNDANT/);
  assert.match(testBody, /NO_TASK_AUTHORED_TESTS/);
  assert.match(testBody, /### Evidence Classification/);
  assert.match(testBody, /### Backward Loop Request/);
});

test("qrspi-fast-impl-verify returns final verification status plus explicit repair routing", () => {
  assert.match(verifyBody, /### Route Hint — PASS \| CODE_REPAIR \| TEST_REPAIR \| CODE_AND_TEST_REPAIR \| BACKWARD_LOOP/);
  assert.match(verifyBody, /### Final Verification Status/);
  assert.match(verifyBody, /### Review Status/);
  assert.match(verifyBody, /NO_TASK_AUTHORED_TESTS/);
  assert.match(verifyBody, /### Backward Loop Request/);
});

test("stage 6 gate checkers expose their regression and integration contracts", () => {
  assert.match(e2eBody, /subagent_type: "general-purpose"/);
  assert.match(e2eBody, /general-purpose child worker/i);
  assert.match(e2eBody, /### E2E Gate Status/);
  assert.match(e2eBody, /### Regressions/);

  assert.match(integrationBody, /Build sanity/);
  assert.match(integrationBody, /Interfaces/);
  assert.match(integrationBody, /Artifact parity/);
  assert.match(integrationBody, /Smoke checks/);
  assert.match(integrationBody, /### Backward Loop Request/);

  assert.match(baselineBody, /subagent_type: "general-purpose"/);
  assert.match(baselineBody, /general-purpose child worker/i);
  assert.match(baselineBody, /### Regression List/);
  assert.match(baselineBody, /### Skipped Checks/);
  assert.match(baselineBody, /### Coverage/);
  assert.match(baselineBody, /Phase Introduced/);
  assert.match(baselineBody, /Last Modified Phase/);
});