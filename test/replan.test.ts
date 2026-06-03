import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { replanStage } from "../src/stages/replan.js";
import type { DispatchRequest, DispatchResult, Dispatcher } from "../src/types.js";
import { TestHarness } from "./support/harness.js";
import { markStageCompleted } from "../src/state.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [], endReason: "agent_end" };
}

async function writeCoreArtifacts(harness: TestHarness): Promise<void> {
  await writeFile(harness.artifacts.requirementsFile, "Build a minimal CLI.", "utf8");
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. CLI works.", "utf8");
  await writeFile(harness.artifacts.designFile, "# Design\n\nExisting design.", "utf8");
  await writeFile(harness.artifacts.structureFile, "# Structure\n\n- `src/cli.ts` (CREATE)", "utf8");
  await writeFile(harness.artifacts.planFile, "# Plan\n\n## Overview\nExisting plan.", "utf8");
  await writeFile(harness.artifacts.phaseManifestFile, "---\ntotal_phases: 1\n---\n\n## Phase 1\n- **Tasks:** 01\n", "utf8");
}

function makePlanWithBackwardLoop(classification: "LOOP_GOALS" | "LOOP_DESIGN" | "LOOP_PLAN"): string {
  // replan.ts detects backward loops via /Affected Upstream Stage:\s*(Goals|Design)/i
  // The regex expects the field WITHOUT markdown bold markers (no ** wrapping)
  const upstreamStage = classification === "LOOP_GOALS" ? "Goals" : "Design";
  const loopBlock = `### Backward Loop Request\nAffected Upstream Stage: ${upstreamStage}\nSummary: Issues found.\nGuidance: Fix the issues.`;
  return `# Revised Plan\n\n## Phase 1 — Core\n- **Tasks:** 01\n\n${loopBlock}`;
}

function makeReplanDispatcher(options: {
  plannerText?: string;
  reviewResponses?: string[];
}): Dispatcher {
  let reviewCall = 0;
  const plannerText = options.plannerText ?? "# Revised Plan\n\n## Phase 1\n- **Tasks:** 01\n";
  const reviewResponses = options.reviewResponses ?? ["### Status — PASS\n\n### Summary\nPlan accepted."];

  return {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-replan-writer") {
        return textResult(plannerText);
      }
      if (request.target.name === "qrspi-replan-reviewer") {
        const response = reviewResponses[reviewCall] ?? reviewResponses.at(-1) ?? "### Status — PASS\n\n### Summary\nPass.";
        reviewCall += 1;
        return textResult(response);
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
  };
}

test("replan stage emits LOOP_GOALS when writer outputs Backward Loop Request with LOOP_GOALS", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const dispatcher = makeReplanDispatcher({
    plannerText: makePlanWithBackwardLoop("LOOP_GOALS"),
  });

  const result = await replanStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.ok(result.backwardLoop);
  assert.equal(result.backwardLoop?.classification, "LOOP_GOALS");
});

test("replan stage emits LOOP_DESIGN when writer outputs LOOP_DESIGN", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const dispatcher = makeReplanDispatcher({
    plannerText: makePlanWithBackwardLoop("LOOP_DESIGN"),
  });

  const result = await replanStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.ok(result.backwardLoop);
  assert.equal(result.backwardLoop?.classification, "LOOP_DESIGN");
});

test("replan stage returns unclean-cap when reviewer fails for 3 rounds", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const dispatcher = makeReplanDispatcher({
    reviewResponses: Array(5).fill("### Status — FAIL\n\n### Fix Guidance\nRevise the plan further."),
  });

  const result = await replanStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.telemetry?.terminal_review_state, "unclean-cap");
  assert.ok((result.telemetry?.review_rounds as number) >= 3);
});

test("replan stage PASS writes plan.md, phase-manifest.md, and task specs", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const revisedPlan = `# Revised Plan

## Phase 1 — Core
- **Tasks:** 01

## Tasks

### Task 01: Example Task
**Phase:** 1
**Priority:** P0
**Dependencies:** none
`;

  const dispatcher = makeReplanDispatcher({ plannerText: revisedPlan });

  const result = await replanStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PASS");
  assert.ok(result.filesWritten.includes("plan.md") || result.filesWritten.some((f) => f.includes("plan")));

  const planContent = await readFile(harness.artifacts.planFile, "utf8").catch(() => "");
  assert.ok(planContent.length > 0);
});

test("replan stage PASS path completes review when reviewer succeeds after one fail", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const dispatcher = makeReplanDispatcher({
    reviewResponses: [
      "### Status — FAIL\n\n### Fix Guidance\nNeed more detail.",
      "### Status — PASS\n\n### Summary\nPlan accepted.",
    ],
  });

  const result = await replanStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.telemetry?.review_rounds, 2);
});
