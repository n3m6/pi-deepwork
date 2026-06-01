import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { markStageCompleted } from "../src/state.js";
import { acceptStage } from "../src/stages/accept.js";
import { designStage } from "../src/stages/design.js";
import { goalsStage } from "../src/stages/goals.js";
import { implementStage } from "../src/stages/implement.js";
import { planStage } from "../src/stages/plan.js";
import { replanStage } from "../src/stages/replan.js";
import { reportStage } from "../src/stages/report.js";
import { researchStage } from "../src/stages/research.js";
import { structureStage } from "../src/stages/structure.js";
import { verifyStage } from "../src/stages/verify.js";
import { TestHarness } from "./support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

test("quick-fix happy path passes end-to-end", async () => {
  const harness = await TestHarness.create({ route: "quick-fix", totalPhases: 1 });
  harnesses.push(harness);

  const goals = await goalsStage.run(harness.runtime());
  assert.equal(goals.status, "PASS");
  harness.state = markStageCompleted(harness.state, "goals", "research", { route: goals.route ?? "quick-fix" });

  const research = await researchStage.run(harness.runtime());
  assert.equal(research.status, "PASS");
  harness.state = markStageCompleted(harness.state, "research", "plan");

  const plan = await planStage.run(harness.runtime());
  assert.equal(plan.status, "PASS");
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });

  const implement = await implementStage.run(harness.runtime());
  assert.ok(implement.status === "PASS" || implement.status === "PARTIAL");
  harness.state = markStageCompleted(harness.state, "implement", "accept");

  const accept = await acceptStage.run(harness.runtime());
  assert.equal(accept.status, "PASS");
  harness.state = markStageCompleted(harness.state, "accept", "verify");

  const verify = await verifyStage.run(harness.runtime());
  assert.equal(verify.status, "PASS");
  harness.state = markStageCompleted(harness.state, "verify", "report");

  const report = await reportStage.run(harness.runtime());
  assert.equal(report.status, "PASS");
});

test("full multi-phase path can replan and finish phase two", async () => {
  const harness = await TestHarness.create({ route: "full", totalPhases: 2 });
  harnesses.push(harness);

  const goals = await goalsStage.run(harness.runtime());
  harness.state = markStageCompleted(harness.state, "goals", "research", { route: goals.route ?? "full" });
  const research = await researchStage.run(harness.runtime());
  assert.equal(research.status, "PASS");
  harness.state = markStageCompleted(harness.state, "research", "design");
  const design = await designStage.run(harness.runtime());
  assert.equal(design.status, "PASS");
  harness.state = markStageCompleted(harness.state, "design", "structure");
  const structure = await structureStage.run(harness.runtime());
  assert.equal(structure.status, "PASS");
  harness.state = markStageCompleted(harness.state, "structure", "plan");
  const plan = await planStage.run(harness.runtime());
  assert.equal(plan.status, "PASS");
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 2 });

  const implement1 = await implementStage.run(harness.runtime());
  assert.ok(implement1.status === "PASS" || implement1.status === "PARTIAL");
  harness.state = markStageCompleted(harness.state, "implement", "accept");
  const accept1 = await acceptStage.run(harness.runtime());
  assert.equal(accept1.status, "PASS");
  harness.state = markStageCompleted(harness.state, "accept", "replan");

  const replan = await replanStage.run(harness.runtime());
  assert.equal(replan.status, "PASS");
  harness.state = {
    ...markStageCompleted(harness.state, "replan", "implement"),
    currentPhase: 2,
  };

  const implement2 = await implementStage.run(harness.runtime());
  assert.ok(implement2.status === "PASS" || implement2.status === "PARTIAL");
  harness.state = markStageCompleted(harness.state, "implement", "accept");
  const accept2 = await acceptStage.run(harness.runtime());
  assert.equal(accept2.status, "PASS");
  harness.state = markStageCompleted(harness.state, "accept", "verify");

  const verify = await verifyStage.run(harness.runtime());
  assert.equal(verify.status, "PASS");
  harness.state = markStageCompleted(harness.state, "verify", "report");
  const report = await reportStage.run(harness.runtime());
  assert.equal(report.status, "PASS");
});

test("accept can request backward loop when acceptance fails", async () => {
  const harness = await TestHarness.create({
    route: "full",
    totalPhases: 1,
    acceptanceStatus: "FAIL",
    backwardLoopRecommendation: "LOOP_PLAN",
  });
  harnesses.push(harness);

  const goals = await goalsStage.run(harness.runtime());
  assert.equal(goals.status, "PASS");
  harness.state = markStageCompleted(harness.state, "goals", "research", { route: goals.route ?? "full" });
  const research = await researchStage.run(harness.runtime());
  assert.equal(research.status, "PASS");
  harness.state = markStageCompleted(harness.state, "research", "design");
  const design = await designStage.run(harness.runtime());
  assert.equal(design.status, "PASS");
  harness.state = markStageCompleted(harness.state, "design", "structure");
  const structure = await structureStage.run(harness.runtime());
  assert.equal(structure.status, "PASS");
  harness.state = markStageCompleted(harness.state, "structure", "plan");
  const plan = await planStage.run(harness.runtime());
  assert.equal(plan.status, "PASS");
  harness.state = markStageCompleted(harness.state, "plan", "implement", { totalPhases: 1 });
  const implement = await implementStage.run(harness.runtime());
  assert.ok(implement.status === "PASS" || implement.status === "PARTIAL");

  const accept = await acceptStage.run({
    ...harness.runtime(),
    state: markStageCompleted(harness.state, "implement", "accept"),
  });

  assert.equal(accept.status, "FAIL");
  assert.equal(accept.backwardLoop?.classification, "LOOP_PLAN");
});
