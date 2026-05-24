import test from "node:test";
import assert from "node:assert/strict";

import { ENABLED_AGENT_FIELDS, getBody, parseFrontmatter } from "./helpers";

const reportAgents = ["qrspi-report.md", "qrspi-reporter.md"] as const;
const frontmatter: Record<(typeof reportAgents)[number], Record<string, string>> = {
  "qrspi-report.md": parseFrontmatter("qrspi-report.md"),
  "qrspi-reporter.md": parseFrontmatter("qrspi-reporter.md"),
};
const orchestratorBody = getBody("qrspi-report.md");
const reporterBody = getBody("qrspi-reporter.md");

test("stage 10 report agents have parseable frontmatter with enabled schema", () => {
  for (const name of reportAgents) {
    assert.deepEqual(Object.keys(frontmatter[name]).sort(), ENABLED_AGENT_FIELDS, `${name} frontmatter schema mismatch`);
  }
});

test("stage 10 report agents use the expected tools and model profile", () => {
  assert.ok((frontmatter["qrspi-report.md"].tools ?? "").includes("qrspi_dispatch"), "qrspi-report.md must expose qrspi_dispatch");
  assert.equal(frontmatter["qrspi-report.md"].model, "deepseek-v4-pro");
  assert.equal(frontmatter["qrspi-report.md"].thinking, "high");

  assert.equal(frontmatter["qrspi-reporter.md"].model, "deepseek-v4-pro");
  assert.equal(frontmatter["qrspi-reporter.md"].thinking, "high");
});

test("qrspi-report dispatches qrspi-reporter and returns report content", () => {
  assert.match(orchestratorBody, /subagent_type: "qrspi-reporter"/);
  assert.match(orchestratorBody, /stage10-summary\.md/);
  assert.match(orchestratorBody, /### Report Content/);
  assert.match(orchestratorBody, /### Status — PASS/);
  assert.match(orchestratorBody, /### Status — FAIL/);
  assert.match(orchestratorBody, /### Files Written — stage10-summary\.md/);
  assert.match(orchestratorBody, /### Telemetry — \{\}/);
});

test("qrspi-reporter formats the final report from supplied artifacts only", () => {
  const sections = [
    "## QRSPI Pipeline Complete",
    "### Pipeline Info",
    "### Goals Summary",
    "### Baseline Summary",
    "### Per-Phase Results",
    "### Verification Result",
    "### Build / Lint / Test Status",
    "### Acceptance Criteria",
    "### Overall Status: [PASS / PARTIAL / FAIL]",
    "### Audit Trail",
    "### Unresolved Items",
  ];

  for (const section of sections) {
    assert.match(reporterBody, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(reporterBody, /Copy all stage summaries verbatim/);
  assert.match(reporterBody, /Overall Status must come from the Stage 9 summary/);
  assert.match(reporterBody, /Build\/Lint\/Test statuses must come from explicit artifact evidence only/);
});