import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = process.cwd();
const agentsDir = path.join(projectRoot, "agents");

function readAgent(name: string): string {
  return fs.readFileSync(path.join(agentsDir, name), "utf8");
}

function getBody(name: string): string {
  const raw = readAgent(name);
  const lines = raw.split("\n");
  let dashesSeen = 0;
  let closeIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      dashesSeen++;
      if (dashesSeen === 2) {
        closeIdx = i;
        break;
      }
    }
  }

  return closeIdx === -1 ? raw : lines.slice(closeIdx + 1).join("\n");
}

const acceptBody = getBody("qrspi-accept.md");
const testerBody = getBody("qrspi-acceptance-tester.md");
const detectorBody = getBody("qrspi-backward-loop-detector.md");
const plannerBody = getBody("qrspi-coverage-planner.md");
const goalTraceReviewerBody = getBody("qrspi-review-accept-goal-traceability.md");
const specReviewerBody = getBody("qrspi-review-accept-spec.md");
const codeQualityReviewerBody = getBody("qrspi-review-accept-code-quality.md");

test("qrspi-accept orchestrator documents Stage 7 lite/full acceptance", () => {
  assert.match(acceptBody, /Stage 7 Accept orchestrator/);
  assert.match(acceptBody, /Use `lite` mode only for reuse-only coverage/);
  assert.match(acceptBody, /Use `full` mode for any `new`, `revise`, or `blocked` coverage/);
  assert.match(acceptBody, /final acceptance mode \(`lite` or `full`\)/);
});

test("qrspi-accept handles boundary violations as contract failures", () => {
  assert.match(acceptBody, /If `### Boundary Violations` is not `None\.`/);
  assert.match(acceptBody, /Do not dispatch the backward-loop detector/);
  assert.match(acceptBody, /acceptance contract violation/);
  assert.match(acceptBody, /"boundary_violation": true/);
});

test("qrspi-accept telemetry includes acceptance mode and cycle details", () => {
  assert.match(acceptBody, /"acceptance_mode": "lite\|full"/);
  assert.match(acceptBody, /"planner_review_cycles": <N>/);
  assert.match(acceptBody, /"round_cycle_details": \[<per-round details>\]/);
  assert.match(acceptBody, /"failure_reasons": \{"blocking_review"/);
});

test("qrspi-acceptance-tester explicitly selects lite or full mode", () => {
  assert.match(testerBody, /#### Step 1\.5 — Decide Acceptance Mode/);
  assert.match(testerBody, /Choose `lite` only when all conditions are true/);
  assert.match(testerBody, /If any condition is false, choose `full`/);
  assert.match(testerBody, /If a previous lite round failed/);
});

test("qrspi-acceptance-tester skips authoring and reviewers in lite mode", () => {
  assert.match(testerBody, /Skip Step 2 reviewer fan-out and Step 3 test writing/);
  assert.match(testerBody, /Do not modify test files/);
  assert.match(testerBody, /Skip this step in `lite` mode/);
  assert.match(testerBody, /run only the concrete existing test files mapped from `Action = reuse` rows/);
});

test("qrspi-acceptance-tester uses background join semantics for reviewer batches", () => {
  assert.match(testerBody, /run_in_background: true/);
  assert.match(testerBody, /get_subagent_result/);
});

test("qrspi-acceptance-tester uses the shared general-purpose child-worker template for test repairs", () => {
  assert.match(testerBody, /general-purpose child worker/i);
  assert.match(testerBody, /subagent_type: "general-purpose"/);
  assert.match(testerBody, /for `qrspi-acceptance-tester`/);
});

test("qrspi-acceptance-tester reports boundary violation failure reasons", () => {
  assert.match(testerBody, /`boundary_violation` — acceptance authoring or repair modified or created files outside TEST FILE BOUNDARY/);
  assert.match(testerBody, /set `### Boundary Violations` in the final output/);
  assert.match(testerBody, /Failure reasons: blocking_review=<n>, reconciliation=<n>, blocked_action=<n>, boundary_violation=<n>, executed_failed=<n>/);
});

test("qrspi-backward-loop-detector caps boundary violations at plan-level classification", () => {
  assert.match(detectorBody, /`blocking_review`, `reconciliation`, and `boundary_violation`/);
  assert.match(detectorBody, /Maximum classification: `LOOP_PLAN`/);
  assert.match(detectorBody, /Never escalate to `LOOP_STRUCTURE`, `LOOP_DESIGN`, or `LOOP_GOALS` solely from these rows/);
});

test("qrspi-coverage-planner defines the acceptance planning contract", () => {
  assert.match(plannerBody, /`Phase-Scoped Criteria` is the authoritative scope/);
  assert.match(plannerBody, /Action: \[reuse \| revise \| new \| blocked\]/);
  assert.match(plannerBody, /Test Type: \[acceptance \| integration \| e2e \| boundary\]/);
  assert.match(plannerBody, /Expected outcomes must be observable through the public surface/);
  assert.match(plannerBody, /### Coverage Plan/);
  assert.match(plannerBody, /### Summary/);
});

test("acceptance reviewers expose pass-fail findings tables for the current phase plan", () => {
  assert.match(goalTraceReviewerBody, /Mapping/);
  assert.match(goalTraceReviewerBody, /Trace/);
  assert.match(goalTraceReviewerBody, /Coverage/);
  assert.match(goalTraceReviewerBody, /Extra/);
  assert.match(goalTraceReviewerBody, /Drift/);

  assert.match(specReviewerBody, /Trigger Fidelity/);
  assert.match(specReviewerBody, /Outcome Fidelity/);
  assert.match(specReviewerBody, /Assertion Specificity/);
  assert.match(specReviewerBody, /Boundary Inclusion/);
  assert.match(specReviewerBody, /Action Consistency/);

  assert.match(codeQualityReviewerBody, /Determinism/);
  assert.match(codeQualityReviewerBody, /Behavior Focus/);
  assert.match(codeQualityReviewerBody, /Isolation/);
  assert.match(codeQualityReviewerBody, /Data Realism/);
  assert.match(codeQualityReviewerBody, /Anti-Patterns/);
  assert.match(codeQualityReviewerBody, /Suite Reuse/);

  for (const body of [goalTraceReviewerBody, specReviewerBody, codeQualityReviewerBody]) {
    assert.match(body, /### Status — PASS or FAIL/);
    assert.match(body, /### Findings/);
  }
});