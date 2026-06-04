import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseSimpleExactFileTask } from "../../src/application/workflow/simple-exact-file-workflow.js";
import { acceptStage } from "../../src/application/stage/accept.js";
import { goalsStage } from "../../src/application/stage/goals.js";
import { implementStage } from "../../src/application/stage/implement.js";
import { planStage } from "../../src/application/stage/plan.js";
import { reportStage } from "../../src/application/stage/report.js";
import { researchStage } from "../../src/application/stage/research.js";
import { verifyStage } from "../../src/application/stage/verify.js";
import type { DispatchRequest, DispatchResult, Dispatcher, StageRuntime } from "../../src/application/port/index.js";
import { TestHarness } from "../support/harness.js";

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
  assert.equal(
    parseSimpleExactFileTask("create a ../SMOKE.md file containing exactly one sentence: Deepwork smoke test."),
    undefined,
  );
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
  harness.completeStage("goals", "research", { route: goals.route ?? "quick-fix" });

  const research = await researchStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(research.status, "PASS");
  harness.completeStage("research", "plan");

  const plan = await planStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(plan.status, "PASS");
  harness.completeStage("plan", "implement", { totalPhases: 1 });

  const implement = await implementStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(implement.status, "PASS");
  assert.equal(await readFile(path.join(harness.workspaceRoot, "SMOKE.md"), "utf8"), "Deepwork smoke test.");
  harness.completeStage("implement", "accept");

  const accept = await acceptStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(accept.status, "PASS");
  harness.completeStage("accept", "verify");

  const verify = await verifyStage.run(runtimeWithThrowingDispatcher(harness));
  assert.equal(verify.status, "PASS");
  harness.completeStage("verify", "report");

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

  async dispatchGenericCoding(_prompt: string): Promise<never> {
    throw new Error("Unexpected dispatchGenericCoding call");
  }
}
