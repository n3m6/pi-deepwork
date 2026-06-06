import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  applyStageTransition,
  executeStage,
  maybeRouteAcceptFix,
} from "../../src/application/pipeline/run-pipeline.js";
import { ensureRunDirectories, getRunArtifacts } from "../../src/infra/fs/artifact-repository.js";
import { createAskHumanTool } from "../../src/infra/pi/human-gate.js";
import { createGoalsReturnTool } from "../../src/infra/pi/stage-return-tool.js";
import { Run } from "../../src/domain/run/index.js";
import { JsonlTelemetrySink } from "../../src/infra/telemetry/jsonl-telemetry-sink.js";
import type { GateManager, PipelineServices, StageModule, StageRuntime } from "../../src/application/port/index.js";

test("verify failures route back to implement", async () => {
  const state = Run.start({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();

  const next = await applyStageTransition(state, "verify", {
    status: "FAIL",
    filesWritten: [],
    summary: "",
    telemetry: { verify_status: "FAIL" },
  });

  assert.equal(next.nextStage, "implement");
  assert.equal(next.verifyStatus, "FAIL");
});

test("verify pass resets verify-fix attempts", async () => {
  const state = {
    ...Run.start({
      runId: "qrspi-20260601-000001",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      route: "full",
    }).toSnapshot(),
    verifyFixAttempts: 2,
  };

  const next = await applyStageTransition(state, "verify", {
    status: "PASS",
    filesWritten: [],
    summary: "",
    telemetry: { verify_status: "PASS" },
  });

  assert.equal(next.nextStage, "report");
  assert.equal(next.verifyFixAttempts, 0);
});

test("accept failures route back to implement with the same phase", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000002");
  await ensureRunDirectories(artifacts);
  const state = {
    ...Run.start({
      runId: "qrspi-20260601-000002",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      route: "full",
    }).toSnapshot(),
    currentPhase: 2,
    totalPhases: 3,
  };
  const telemetry = JsonlTelemetrySink.create(artifacts, state.runId);
  await telemetry.initialize();

  const next = await maybeRouteAcceptFix(
    state,
    {
      status: "FAIL",
      filesWritten: ["phases/phase-02/acceptance-results.md"],
      summary: "Acceptance tests failed.",
    },
    telemetry,
    {
      stage: "accept",
      async run() {
        throw new Error("not used");
      },
    },
    1,
  );

  assert.ok(next);
  assert.equal(next.nextStage, "implement");
  assert.equal(next.currentPhase, 2);
  assert.equal(next.acceptFixAttempts, 1);
  assert.equal(next.lastCompletedStage, "accept");
});

test("accept failures stop after the implementation repair cap", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000003");
  await ensureRunDirectories(artifacts);
  const state = {
    ...Run.start({
      runId: "qrspi-20260601-000003",
      interactionMode: "automated",
      failurePolicy: "best-effort",
      route: "full",
    }).toSnapshot(),
    acceptFixAttempts: 2,
  };
  const telemetry = JsonlTelemetrySink.create(artifacts, state.runId);
  await telemetry.initialize();

  const next = await maybeRouteAcceptFix(
    state,
    {
      status: "FAIL",
      filesWritten: ["phases/phase-01/acceptance-results.md"],
      summary: "Acceptance still failed.",
    },
    telemetry,
    {
      stage: "accept",
      async run() {
        throw new Error("not used");
      },
    },
    2,
  );

  assert.equal(next, undefined);
});

test("accept review-cap failures are not auto-approved in best-effort mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000004");
  await ensureRunDirectories(artifacts);
  const state = Run.start({
    runId: "qrspi-20260601-000004",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();
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
    createAskHumanTool() {
      return createAskHumanTool(this);
    },
    createGoalsReturnTool() {
      return createGoalsReturnTool();
    },
  };
  const runtime: StageRuntime = {
    state,
    workspaceRoot: workspace,
    services: {
      commandContext: { signal: new AbortController().signal },
      gates,
    } as Pick<PipelineServices, "commandContext" | "gates"> as PipelineServices,
  };
  const telemetry = JsonlTelemetrySink.create(artifacts, state.runId);
  await telemetry.initialize();

  const stage: StageModule = {
    stage: "accept",
    async run() {
      return {
        status: "FAIL",
        filesWritten: ["reviews/acceptance-plan.md"],
        summary: "Acceptance coverage plan reviewers did not converge.",
        telemetry: {
          terminal_review_state: "unclean-cap",
        },
      };
    },
  };

  const result = await executeStage(stage, runtime, state, telemetry, new Map());
  assert.equal(result.outcome.status, "FAIL");
  assert.equal(result.outcome.telemetry?.gate_status, undefined);
});

test("executeStage auto-approves unclean-cap failures in automated best-effort mode", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-controller-"));
  const artifacts = getRunArtifacts(workspace, "qrspi-20260601-000000");
  await ensureRunDirectories(artifacts);
  const state = Run.start({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();

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
    createAskHumanTool() {
      return createAskHumanTool(this);
    },
    createGoalsReturnTool() {
      return createGoalsReturnTool();
    },
  };
  const services = {
    commandContext: { signal: new AbortController().signal },
    gates,
  } as Pick<PipelineServices, "commandContext" | "gates">;
  const runtime: StageRuntime = {
    state,
    workspaceRoot: workspace,
    services: services as PipelineServices,
  };
  const telemetry = JsonlTelemetrySink.create(artifacts, state.runId);
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
  const state = Run.start({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();

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
    createAskHumanTool() {
      return createAskHumanTool(this);
    },
    createGoalsReturnTool() {
      return createGoalsReturnTool();
    },
  };
  const services = {
    commandContext: { signal: new AbortController().signal },
    gates,
  } as Pick<PipelineServices, "commandContext" | "gates">;
  const runtime: StageRuntime = {
    state,
    workspaceRoot: workspace,
    services: services as PipelineServices,
  };
  const telemetry = JsonlTelemetrySink.create(artifacts, state.runId);
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
  const state = Run.start({
    runId: "qrspi-20260601-000000",
    interactionMode: "automated",
    failurePolicy: "best-effort",
    route: "full",
  }).toSnapshot();

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
    createAskHumanTool() {
      return createAskHumanTool(this);
    },
    createGoalsReturnTool() {
      return createGoalsReturnTool();
    },
  };
  const services = {
    commandContext: { signal: new AbortController().signal },
    gates,
  } as Pick<PipelineServices, "commandContext" | "gates">;
  const runtime: StageRuntime = {
    state,
    workspaceRoot: workspace,
    services: services as PipelineServices,
  };
  const telemetry = JsonlTelemetrySink.create(artifacts, state.runId);
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
