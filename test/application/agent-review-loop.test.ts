import { test } from "node:test";
import assert from "node:assert/strict";

import { runAgentReviewLoop } from "../../src/application/workflow/agent-review-loop.js";
import { InMemoryArtifactRepository } from "../support/in-memory-artifact-repository.js";
import type { PipelineServices, StageRuntime } from "../../src/application/port/index.js";

function makeRuntime(): StageRuntime {
  return {
    state: {
      runId: "qrspi-20260601-000000",
      route: "full",
      currentPhase: 1,
      totalPhases: 1,
      lastCompletedStage: "none",
      nextStage: "goals",
      stagesCompleted: [],
      phaseHistory: [],
      backwardLoops: 0,
      acceptFixAttempts: 0,
      verifyFixAttempts: 0,
      resumeSource: "fresh",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    workspaceRoot: "/tmp",
    currentStage: "goals",
    services: {
      telemetrySink: { record: async () => {}, regenerateRunLog: async () => {}, regenerateMetrics: async () => {} },
      artifactRepo: new InMemoryArtifactRepository(),
    } as unknown as PipelineServices,
  };
}

test("runAgentReviewLoop retries a transient failure once and returns PASS", async () => {
  const runtime = makeRuntime();
  let calls = 0;

  const result = await runAgentReviewLoop(runtime, {
    maxRounds: 3,
    stageName: "goals",
    maxTransientRetries: 1,
    runReview: async () => {
      calls += 1;
      if (calls === 1) return { failure: "dispatched session timed out", transient: true };
      return { text: "### Status — PASS\n\n### Summary\nPass." };
    },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.reviewRounds, 1);
  assert.equal(calls, 2, "should attempt twice: 1 timeout + 1 retry");
});

test("runAgentReviewLoop fails after exhausting transient retry budget", async () => {
  const runtime = makeRuntime();
  let calls = 0;

  const result = await runAgentReviewLoop(runtime, {
    maxRounds: 3,
    stageName: "goals",
    maxTransientRetries: 1,
    runReview: async () => {
      calls += 1;
      return { failure: "dispatched session timed out", transient: true };
    },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.dispatchFailure, true);
  assert.match(result.summary ?? "", /timed out/);
  assert.equal(calls, 2, "should attempt twice: 1 initial + 1 retry = budget exhausted");
});

test("runAgentReviewLoop does not retry non-transient failures", async () => {
  const runtime = makeRuntime();
  let calls = 0;

  const result = await runAgentReviewLoop(runtime, {
    maxRounds: 3,
    stageName: "goals",
    maxTransientRetries: 1,
    runReview: async () => {
      calls += 1;
      return { failure: "dispatched session was aborted", transient: false };
    },
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.dispatchFailure, true);
  assert.equal(calls, 1, "should attempt exactly once — non-transient failures are not retried");
});
