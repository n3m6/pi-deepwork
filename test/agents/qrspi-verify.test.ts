import test from "node:test";
import assert from "node:assert/strict";

import { ENABLED_AGENT_FIELDS, getBody, parseFrontmatter } from "./helpers";

const verifyAgents = ["qrspi-verify.md", "qrspi-verifier.md"] as const;
const frontmatter: Record<(typeof verifyAgents)[number], Record<string, string>> = {
  "qrspi-verify.md": parseFrontmatter("qrspi-verify.md"),
  "qrspi-verifier.md": parseFrontmatter("qrspi-verifier.md"),
};
const orchestratorBody = getBody("qrspi-verify.md");
const verifierBody = getBody("qrspi-verifier.md");

test("stage 9 verify agents have parseable frontmatter with enabled schema", () => {
  for (const name of verifyAgents) {
    assert.deepEqual(Object.keys(frontmatter[name]).sort(), ENABLED_AGENT_FIELDS, `${name} frontmatter schema mismatch`);
  }
});

test("stage 9 verify agents use the expected tools and models", () => {
  assert.ok((frontmatter["qrspi-verify.md"].tools ?? "").includes("qrspi_dispatch"), "qrspi-verify.md must expose qrspi_dispatch");
  assert.equal(frontmatter["qrspi-verify.md"].model, "anthropic/claude-sonnet-4-5");
  assert.equal(frontmatter["qrspi-verify.md"].thinking, "low");

  assert.equal(frontmatter["qrspi-verifier.md"].model, "anthropic/claude-sonnet-4-5");
  assert.equal(frontmatter["qrspi-verifier.md"].thinking, "medium");
});

test("qrspi-verify dispatches the verifier and mirrors status into stage9-summary", () => {
  assert.match(orchestratorBody, /subagent_type: "qrspi-verifier"/);
  assert.match(orchestratorBody, /stage9-summary\.md/);
  assert.match(orchestratorBody, /### Status — PASS/, "verify return contract must include PASS shape");
  assert.match(orchestratorBody, /### Status — PARTIAL/);
  assert.match(orchestratorBody, /### Status — FAIL/);
  assert.match(orchestratorBody, /### Files Written — stage9-summary\.md/);
  assert.match(orchestratorBody, /"overall_status": "PASS\|PARTIAL\|FAIL"/);
});

test("qrspi-verifier supports cached Stage 7 reuse plus full baseline-aware verification", () => {
  assert.match(verifierBody, /Decide whether to reuse Stage 7's incremental regression results/);
  assert.match(verifierBody, /Verified at Stage 7 \(PASS, no production changes since\)/);
  assert.match(verifierBody, /Step 1 — Run checks/);
  assert.match(verifierBody, /Step 2 — Baseline comparison/);
  assert.match(verifierBody, /Step 3 — Requirements and acceptance/);
  assert.match(verifierBody, /PASS/);
  assert.match(verifierBody, /PARTIAL/);
  assert.match(verifierBody, /FAIL/);
});

test("qrspi-verifier returns the full verification report structure", () => {
  const sections = [
    "### Check Results",
    "### Baseline Comparison",
    "### Requirement Checks",
    "### Acceptance Criteria Status",
    "### Code Health Summary",
    "### Verification Iterations",
    "### Overall Status — PASS / PARTIAL / FAIL",
    "### Stage Summary",
  ];

  for (const section of sections) {
    assert.match(verifierBody, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});