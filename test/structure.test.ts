import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { structureStage } from "../src/stages/structure.js";
import type { DispatchRequest, DispatchResult, Dispatcher } from "../src/types.js";
import { TestHarness } from "./support/harness.js";
import { ScriptedGateManager } from "./support/scripted-gates.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.dispose()));
});

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [], endReason: "agent_end" };
}

async function writeCoreArtifacts(harness: TestHarness): Promise<void> {
  await writeFile(harness.artifacts.requirementsFile, "Build a minimal CLI.", "utf8");
  await writeFile(harness.artifacts.goalsFile, "# Goals\n\n## Acceptance Criteria\n1. CLI exists.", "utf8");
  await writeFile(harness.artifacts.researchSummaryFile, "# Research Summary\n\nNo blocking findings.", "utf8");
  await writeFile(harness.artifacts.designFile, "# Design\n\nUse existing patterns.", "utf8");
}

function makeStructureDispatcher(options: { reviewResponses?: string[] }): Dispatcher {
  let reviewCall = 0;
  const reviewResponses = options.reviewResponses ?? ["### Status — PASS\n\n### Summary\nPass."];
  return {
    async dispatch(request: DispatchRequest): Promise<DispatchResult> {
      if (request.target.name === "qrspi-structure-mapper") {
        return textResult("# Structure\n\n## File Map\n| File | Action | Purpose |\n| `src/cli.ts` | CREATE | CLI entry |");
      }
      if (request.target.name === "qrspi-structure-reviewer") {
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

test("structure stage passes and auto-approves in automated mode", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const result = await structureStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher: makeStructureDispatcher({}) },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.telemetry?.gate_status, "approved");
  assert.equal(result.telemetry?.gate_mode, "automated");
});

test("structure stage returns unclean-cap when reviewer fails for 5 rounds", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const failResponse = "### Status — FAIL\n\n### Fix Guidance\nAdd more detail to the file map.";
  const dispatcher = makeStructureDispatcher({
    reviewResponses: Array(6).fill(failResponse),
  });

  const result = await structureStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.telemetry?.terminal_review_state, "unclean-cap");
  assert.equal(result.telemetry?.gate_status, "none");
});

test("structure stage retries synthesis on reviewer fail then pass", async () => {
  const harness = await TestHarness.create({ route: "full" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const dispatcher = makeStructureDispatcher({
    reviewResponses: [
      "### Status — FAIL\n\n### Fix Guidance\nNeed phase column.",
      "### Status — PASS\n\n### Summary\nLooks good.",
    ],
  });

  const result = await structureStage.run({
    ...harness.runtime(),
    services: { ...harness.services, dispatcher },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.telemetry?.review_rounds, 2);
});

test("structure stage passes in interactive mode when user approves", async () => {
  const harness = await TestHarness.create({ route: "full", interactionMode: "interactive" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const gates = new ScriptedGateManager(
    { interactionMode: "interactive", failurePolicy: "best-effort" },
    [{ method: "choose", value: { value: "approve" } }],
  );

  const result = await structureStage.run({
    ...harness.runtime(),
    services: { ...harness.services, gates, dispatcher: makeStructureDispatcher({}) },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.telemetry?.gate_status, "approved");
  assert.equal(result.telemetry?.gate_mode, "interactive");
});

test("structure stage fails in interactive fail-closed mode with empty feedback", async () => {
  const harness = await TestHarness.create({ route: "full", interactionMode: "interactive", failurePolicy: "fail-closed" });
  harnesses.push(harness);
  await writeCoreArtifacts(harness);

  const gates = new ScriptedGateManager(
    { interactionMode: "interactive", failurePolicy: "fail-closed" },
    [
      { method: "choose", value: { value: "feedback" } },
      { method: "askText", value: undefined },
    ],
  );

  const result = await structureStage.run({
    ...harness.runtime(),
    services: { ...harness.services, gates, dispatcher: makeStructureDispatcher({}) },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.telemetry?.gate_status, "rejected");
});
