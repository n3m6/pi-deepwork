import test from "node:test";
import assert from "node:assert/strict";

import { ENABLED_AGENT_FIELDS, getBody, parseFrontmatter } from "./helpers";

const replanAgents = ["qrspi-replan.md", "qrspi-replan-writer.md", "qrspi-replan-reviewer.md"] as const;
const frontmatter: Record<(typeof replanAgents)[number], Record<string, string>> = {
  "qrspi-replan.md": parseFrontmatter("qrspi-replan.md"),
  "qrspi-replan-writer.md": parseFrontmatter("qrspi-replan-writer.md"),
  "qrspi-replan-reviewer.md": parseFrontmatter("qrspi-replan-reviewer.md"),
};
const orchestratorBody = getBody("qrspi-replan.md");
const writerBody = getBody("qrspi-replan-writer.md");
const reviewerBody = getBody("qrspi-replan-reviewer.md");

test("stage 8 replan agents have parseable frontmatter with enabled schema", () => {
  for (const name of replanAgents) {
    assert.deepEqual(Object.keys(frontmatter[name]).sort(), ENABLED_AGENT_FIELDS, `${name} frontmatter schema mismatch`);
  }
});

test("stage 8 replan agents use the expected tools and models", () => {
  assert.ok((frontmatter["qrspi-replan.md"].tools ?? "").includes("qrspi_dispatch"), "qrspi-replan.md must expose qrspi_dispatch");
  assert.equal(frontmatter["qrspi-replan.md"].model, "anthropic/claude-sonnet-4-5");
  assert.equal(frontmatter["qrspi-replan.md"].thinking, "low");

  for (const name of ["qrspi-replan-writer.md", "qrspi-replan-reviewer.md"] as const) {
    assert.equal(frontmatter[name].model, "anthropic/claude-haiku-4-5", `${name} must use haiku tier`);
    assert.equal(frontmatter[name].thinking, "low", `${name} must use low thinking`);
  }
});

test("qrspi-replan orchestrates remaining-work revision and review-cap states", () => {
  assert.match(orchestratorBody, /subagent_type: "qrspi-replan-writer"/);
  assert.match(orchestratorBody, /subagent_type: "qrspi-replan-reviewer"/);
  assert.match(orchestratorBody, /### Backward Loop Request/);
  assert.match(orchestratorBody, /stable-cap/);
  assert.match(orchestratorBody, /unclean-cap/);
  assert.match(orchestratorBody, /phase-\[PP\]-replan\.md/);
  assert.match(orchestratorBody, /### Telemetry — \{"review_rounds": <N>/);
});

test("qrspi-replan-writer returns full remaining-work artifacts or a backward loop request", () => {
  assert.match(writerBody, /### Backward Loop Request/);
  assert.match(writerBody, /### plan\.md/);
  assert.match(writerBody, /### phase-manifest\.md/);
  assert.match(writerBody, /### task-NN\.md/);
  assert.match(writerBody, /### Tasks Added/);
  assert.match(writerBody, /### Tasks Modified/);
  assert.match(writerBody, /### Tasks Removed/);
  assert.match(writerBody, /### Replan Note/);
  assert.match(writerBody, /Keep existing task IDs stable/);
  assert.match(writerBody, /Minor amendment/);
  assert.match(writerBody, /Approach change/);
});

test("qrspi-replan-reviewer enforces the full replan review rubric", () => {
  const reviewAreas = [
    "Goals alignment",
    "Evidence alignment",
    "Amendment classification",
    "No design drift",
    "Phase coherence",
    "Dependency correctness",
    "Task quality",
    "Change justification",
    "Risk handling",
    "Completed-phase preservation",
  ];

  for (const area of reviewAreas) {
    assert.match(reviewerBody, new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(reviewerBody, /### Status — PASS or FAIL/);
  assert.match(reviewerBody, /### Review Findings/);
  assert.match(reviewerBody, /### Fix Guidance/);
  assert.match(reviewerBody, /### Summary/);
});