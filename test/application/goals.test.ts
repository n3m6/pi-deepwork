import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadAgentDefinitions } from "../../src/infrastructure/pi/agent-catalog.js";
import { FileSystemArtifactRepository } from "../../src/infrastructure/fs/artifact-repository.js";
import { ensureRunDirectories, getRunArtifacts } from "../../src/infrastructure/fs/artifact-repository.js";
import { createInitialState } from "../../src/domain/run/index.js";
import { goalsStage } from "../../src/application/stage/goals.js";
import type { DispatchRequest, DispatchResult, Dispatcher, GateManager, PipelineServices, ProgressReporter } from "../../src/application/port/index.js";

test("goals reports child dispatch session errors before parsing sections", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-goals-"));
  try {
    const artifacts = getRunArtifacts(workspace, "qrspi-20260602-000000");
    await ensureRunDirectories(artifacts);
    const state = createInitialState({
      runId: "qrspi-20260602-000000",
      userTask: "Create a SMOKE.md file containing one sentence.",
      interactionMode: "automated",
      failurePolicy: "best-effort",
    });

    const runtime = {
      state,
      artifacts,
      services: {
        pi: { exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }) },
        commandContext: { signal: new AbortController().signal },
        eventContext: { signal: new AbortController().signal },
        dispatcher: new FailingDispatcher("No models available. Use /login to log into a provider."),
        agentDefinitions: await loadAgentDefinitions(),
        gates: automatedGates(),
        progress: noopProgress(),
        artifactRepo: FileSystemArtifactRepository.fromPaths(artifacts),
      } as unknown as PipelineServices,
    };

    const outcome = await goalsStage.run(runtime);

    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.summary, /Goals synthesis failed: No models available/);
    assert.equal(outcome.telemetry?.dispatch_end_reason, "session_error");
    assert.equal(outcome.telemetry?.terminal_review_state, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

class FailingDispatcher implements Dispatcher {
  constructor(private readonly message: string) {}

  async dispatch(_request: DispatchRequest): Promise<DispatchResult> {
    return {
      text: "",
      messages: [],
      customToolCalls: [],
      endReason: "session_error",
      errorMessage: this.message,
    };
  }

  async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((request) => this.dispatch(request)));
  }

  async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((request) => this.dispatch(request)));
  }
}

function automatedGates(): GateManager {
  return {
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
}

function noopProgress(): ProgressReporter {
  return {
    setStage() {},
    setWidget() {},
    clear() {},
  };
}
