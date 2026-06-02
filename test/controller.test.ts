import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyStageTransition, executeStage } from "../src/controller.js";
import { createInitialState, ensureRunDirectories, getRunArtifacts } from "../src/state.js";
import { TelemetryRecorder } from "../src/telemetry.js";
import type { GateManager, PipelineServices, StageModule, StageRuntime } from "../src/types.js";

test("verify failures route back to implement", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  const state = createInitialState({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  });

  const next = await applyStageTransition(state, "verify", {
    telemetry: { verify_status: "FAIL" },
  }, artifacts);

  assert.equal(next.nextStage, "implement");
  assert.equal(next.verifyStatus, "FAIL");
});

test("verify pass resets verify-fix attempts", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000001");
  const state = {
    ...createInitialState({
      runId: "qrspi-20260601-000001",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      route: "full",
    }),
    verifyFixAttempts: 2,
  };

  const next = await applyStageTransition(state, "verify", {
    telemetry: { verify_status: "PASS" },
  }, artifacts);

  assert.equal(next.nextStage, "report");
  assert.equal(next.verifyFixAttempts, 0);
});

test("executeStage auto-approves unclean-cap failures in automated best-effort mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);
  const state = createInitialState({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  });

  const gates: GateManager = {
    interactionMode: "automated",
    failurePolicy: "best-effort",
    async askText() {
      return undefined;
    },
    async choose() {
      return undefined;
    },
    async confirm() {
      return false;
    },
  };
  const services = {
    commandContext: { signal: new AbortController().signal },
    gates,
  } as Pick<PipelineServices, "commandContext" | "gates">;
  const runtime: StageRuntime = {
    state,
    artifacts,
    services: services as PipelineServices,
  };
  const telemetry = new TelemetryRecorder(artifacts, state.runId);
  await telemetry.initialize();

  const stage: StageModule = {
    stage: "plan",
    async run() {
      return {
        status: "FAIL",
        filesWritten: ["plan.md"],
        summary: "Plan review reached the cap.",
        telemetry: {
          terminal_review_state: "unclean-cap",
        },
      };
    },
  };

  const result = await executeStage(stage, runtime, state, telemetry, new Map());
  assert.equal(result.outcome.status, "PARTIAL");
  assert.equal(result.outcome.telemetry?.gate_status, "approved");
});

test("executeStage does not auto-approve infrastructure failures in best-effort mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);
  const state = createInitialState({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  });

  const gates: GateManager = {
    interactionMode: "automated",
    failurePolicy: "best-effort",
    async askText() {
      return undefined;
    },
    async choose() {
      return undefined;
    },
    async confirm() {
      return false;
    },
  };
  const services = {
    commandContext: { signal: new AbortController().signal },
    gates,
  } as Pick<PipelineServices, "commandContext" | "gates">;
  const runtime: StageRuntime = {
    state,
    artifacts,
    services: services as PipelineServices,
  };
  const telemetry = new TelemetryRecorder(artifacts, state.runId);
  await telemetry.initialize();

  const stage: StageModule = {
    stage: "goals",
    async run() {
      return {
        status: "FAIL",
        filesWritten: ["requirements.md"],
        summary: "Goals synthesis failed: No API key found.",
        telemetry: {
          gate_status: "none",
          dispatch_end_reason: "session_error",
        },
      };
    },
  };

  const result = await executeStage(stage, runtime, state, telemetry, new Map());
  assert.equal(result.outcome.status, "FAIL");
  assert.equal(result.outcome.telemetry?.gate_status, "none");
});

test("executeStage retries once after an unexpected error in best-effort mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);
  const state = createInitialState({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  });

  const gates: GateManager = {
    interactionMode: "automated",
    failurePolicy: "best-effort",
    async askText() {
      return undefined;
    },
    async choose() {
      return undefined;
    },
    async confirm() {
      return false;
    },
  };
  const services = {
    commandContext: { signal: new AbortController().signal },
    gates,
  } as Pick<PipelineServices, "commandContext" | "gates">;
  const runtime: StageRuntime = {
    state,
    artifacts,
    services: services as PipelineServices,
  };
  const telemetry = new TelemetryRecorder(artifacts, state.runId);
  await telemetry.initialize();

  let attempts = 0;
  const stage: StageModule = {
    stage: "research",
    async run() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient");
      }
      return {
        status: "PASS",
        filesWritten: [],
        summary: "Recovered.",
      };
    },
  };

  const result = await executeStage(stage, runtime, state, telemetry, new Map());
  assert.equal(attempts, 2);
  assert.equal(result.outcome.status, "PASS");
});
