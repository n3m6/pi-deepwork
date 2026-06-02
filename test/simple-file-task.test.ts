import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { markStageCompleted } from "../src/state.js";
import { parseSimpleExactFileTask } from "../src/simple-file-task.js";
import { acceptStage } from "../src/stages/accept.js";
import { goalsStage } from "../src/stages/goals.js";
import { implementStage } from "../src/stages/implement.js";
import { planStage } from "../src/stages/plan.js";
import { reportStage } from "../src/stages/report.js";
import { researchStage } from "../src/stages/research.js";
import { verifyStage } from "../src/stages/verify.js";
import type { DispatchRequest, DispatchResult, Dispatcher, StageRuntime } from "../src/types.js";
import { TestHarness } from "./support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

test("parseSimpleExactFileTask detects safe exact file creation requests", () => {
  assert.deepEqual(
    parseSimpleExactFileTask("create a SMOKE.md file containing exactly one sentence: Deepwork smoke test."),
    {
      filePath: "SMOKE.md",
      content: "Deepwork smoke test.",
    },
  );
  assert.equal(parseSimpleExactFileTask("create a ../SMOKE.md file containing exactly one sentence: Deepwork smoke test."), undefined);
});

test("simple exact-file quick-fix stages complete without dispatch fanout", async () => {
  const harness = await TestHarness.create({ route: "quick-fix", totalPhases: 1 });
  harnesses.push(harness);
  harness.state = {
    ...harness.state,
    userTask: "create a SMOKE.md file containing exactly one sentence: Deepwork smoke test.",
  };

  const goals = await goalsStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(goals.status, "PASS");
  assert.equal(goals.route, "quick-fix");
  harness.state = markStageCompleted(harness.state, "goals", "research", { route: goals.route ?? "quick-fix" });

  const research = await researchStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(research.status, "PASS");
  harness.state = markStageCompleted(harness.state, "research", "plan");

  const plan = await planStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(plan.status, "PASS");
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });

  const implement = await implementStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(implement.status, "PASS");
  assert.equal(await readFile(path.join(harness.workspaceRoot, "SMOKE.md"), "utf8"), "Deepwork smoke test.");
  harness.state = markStageCompleted(harness.state, "implement", "accept");

  const accept = await acceptStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(accept.status, "PASS");
  harness.state = markStageCompleted(harness.state, "accept", "verify");

  const verify = await verifyStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(verify.status, "PASS");
  harness.state = markStageCompleted(harness.state, "verify", "report");

  const report = await reportStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(report.status, "PASS");
  assert.match(report.reportContent ?? "", /Created `SMOKE\.md`/);
});

function runtimeWithThrowingDispatcher(harness: TestHarness): StageRuntime {
  return {
    ...harness.runtime(),
    services: {
      ...harness.services,
      dispatcher: new ThrowingDispatcher(),
    },
  };
}

class ThrowingDispatcher implements Dispatcher {
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    throw new Error(`Unexpected dispatch to ${request.target.name}`);
  }

  async dispatchParallel(): Promise<DispatchResult[]> {
    throw new Error("Unexpected parallel dispatch");
  }

  async dispatchChain(): Promise<DispatchResult[]> {
    throw new Error("Unexpected chain dispatch");
  }
}
