import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { acceptStage } from "../../src/application/stage/accept.js";
import { designStage } from "../../src/application/stage/design.js";
import { goalsStage } from "../../src/application/stage/goals.js";
import { implementStage } from "../../src/application/stage/implement.js";
import { planStage } from "../../src/application/stage/plan.js";
import { replanStage } from "../../src/application/stage/replan.js";
import { reportStage } from "../../src/application/stage/report.js";
import { researchStage } from "../../src/application/stage/research.js";
import { structureStage } from "../../src/application/stage/structure.js";
import { verifyStage } from "../../src/application/stage/verify.js";
import { Run } from "../../src/domain/run/index.js";
import { TestHarness } from "../support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

test("quick-fix happy path passes end-to-end", async () => {
  const harness = await TestHarness.create({ route: "quick-fix", totalPhases: 1 });
  harnesses.push(harness);

  const goals = await goalsStage.run(harness.runtime());
  assert.equal(goals.status, "PASS");
  harness.completeStage("goals", "research", { route: goals.route ?? "quick-fix" });

  const research = await researchStage.run(harness.runtime());
  assert.equal(research.status, "PASS");
  harness.completeStage("research", "plan");

  const plan = await planStage.run(harness.runtime());
  assert.equal(plan.status, "PASS");
  harness.completeStage("plan", "implement", { totalPhases: 1 });

  const implement = await implementStage.run(harness.runtime());
  assert.ok(implement.status === "PASS" || implement.status === "PARTIAL");
  harness.completeStage("implement", "accept");

  const accept = await acceptStage.run(harness.runtime());
  assert.equal(accept.status, "PASS");
  harness.completeStage("accept", "verify");

  const verify = await verifyStage.run(harness.runtime());
  assert.equal(verify.status, "PASS");
  harness.completeStage("verify", "report");

  const report = await reportStage.run(harness.runtime());
  assert.equal(report.status, "PASS");
});

test("full multi-phase path can replan and finish phase two", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 2 });
  harnesses.push(harness);

  const goals = await goalsStage.run(harness.runtime());
  harness.completeStage("goals", "research", { route: goals.route ?? "full" });
  const research = await researchStage.run(harness.runtime());
  assert.equal(research.status, "PASS");
  harness.completeStage("research", "design");
  const design = await designStage.run(harness.runtime());
  assert.equal(design.status, "PASS");
  harness.completeStage("design", "structure");
  const structure = await structureStage.run(harness.runtime());
  assert.equal(structure.status, "PASS");
  harness.completeStage("structure", "plan");
  const plan = await planStage.run(harness.runtime());
  assert.equal(plan.status, "PASS");
  harness.completeStage("plan", "implement", { totalPhases: 2 });

  const implement1 = await implementStage.run(harness.runtime());
  assert.ok(implement1.status === "PASS" || implement1.status === "PARTIAL");
  harness.completeStage("implement", "accept");
  const accept1 = await acceptStage.run(harness.runtime());
  assert.equal(accept1.status, "PASS");
  harness.completeStage("accept", "replan");

  const replan = await replanStage.run(harness.runtime());
  assert.equal(replan.status, "PASS");
  harness.completeStage("replan", "implement");
  harness.state = { ...harness.state, currentPhase: 2 };

  const implement2 = await implementStage.run(harness.runtime());
  assert.ok(implement2.status === "PASS" || implement2.status === "PARTIAL");
  harness.completeStage("implement", "accept");
  const accept2 = await acceptStage.run(harness.runtime());
  assert.equal(accept2.status, "PASS");
  harness.completeStage("accept", "verify");

  const verify = await verifyStage.run(harness.runtime());
  assert.equal(verify.status, "PASS");
  harness.completeStage("verify", "report");
  const report = await reportStage.run(harness.runtime());
  assert.equal(report.status, "PASS");
});

test("accept failure does not request an upstream backward loop", async () => {
  const harness = await TestHarness.create({
    route: "full",
    totalPhases: 1,
    acceptanceStatus: "FAIL",
    backwardLoopRecommendation: "LOOP_PLAN",
  });
  harnesses.push(harness);

  const goals = await goalsStage.run(harness.runtime());
  assert.equal(goals.status, "PASS");
  harness.completeStage("goals", "research", { route: goals.route ?? "full" });
  const research = await researchStage.run(harness.runtime());
  assert.equal(research.status, "PASS");
  harness.completeStage("research", "design");
  const design = await designStage.run(harness.runtime());
  assert.equal(design.status, "PASS");
  harness.completeStage("design", "structure");
  const structure = await structureStage.run(harness.runtime());
  assert.equal(structure.status, "PASS");
  harness.completeStage("structure", "plan");
  const plan = await planStage.run(harness.runtime());
  assert.equal(plan.status, "PASS");
  harness.completeStage("plan", "implement", { totalPhases: 1 });
  const implement = await implementStage.run(harness.runtime());
  assert.ok(implement.status === "PASS" || implement.status === "PARTIAL");

  const _acceptRun = Run.rehydrate(harness.state);
  _acceptRun.completeStage("implement", "accept");
  const accept = await acceptStage.run({
    ...harness.runtime(),
    state: _acceptRun.toSnapshot(),
  });

  assert.equal(accept.status, "FAIL");
  assert.equal(accept.backwardLoop, undefined);
});
