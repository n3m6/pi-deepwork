import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadAgentDefinitions } from "../../src/infrastructure/pi/agent-catalog.js";
import { FileSystemArtifactRepository } from "../../src/infrastructure/fs/artifact-repository.js";
import { ensureRunDirectories, getRunArtifacts } from "../../src/infrastructure/fs/artifact-repository.js";
import { createAskHumanTool } from "../../src/infrastructure/pi/human-gate.js";
import { createGoalsReturnTool } from "../../src/infrastructure/pi/stage-return-tool.js";
import { Run } from "../../src/domain/run/index.js";
import { goalsStage } from "../../src/application/stage/goals.js";
import type {
  CustomToolResult,
  DispatchRequest,
  DispatchResult,
  Dispatcher,
  GateManager,
  PipelineServices,
  ProgressReporter,
} from "../../src/application/port/index.js";

const RUN_ID = "qrspi-20260602-000000";
const USER_TASK = "Create a TypeScript express server with a /health endpoint.";

test("goals reports child dispatch session errors before parsing sections", async () => {
  await withWorkspace(async ({ runtime }) => {
    const outcome = await goalsStage.run({
      ...runtime,
      services: {
        ...runtime.services,
        dispatcher: new FailingDispatcher("No models available. Use /login to log into a provider."),
      },
    });

    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.summary, /Goals synthesis failed: No models available/);
    assert.equal(outcome.telemetry?.dispatch_end_reason, "session_error");
    assert.equal(outcome.telemetry?.terminal_review_state, undefined);
  });
});

test("goals produces PASS outcome when synthesizer calls goals_return", async () => {
  await withWorkspace(async ({ runtime, workspace }) => {
    const outcome = await goalsStage.run({
      ...runtime,
      services: {
        ...runtime.services,
        dispatcher: new GoalsSynthDispatcher(),
      },
    });

    assert.equal(outcome.status, "PASS");
    assert.equal(outcome.route, "full");
    assert.ok(outcome.filesWritten.includes("goals.md"), "filesWritten should include goals.md");
    assert.ok(outcome.filesWritten.includes("config.md"), "filesWritten should include config.md");

    const runId = RUN_ID;
    const artifacts = getRunArtifacts(workspace, runId);
    const goalsContent = await readFile(artifacts.goalsFile, "utf8");
    assert.ok(goalsContent.startsWith("# Goals"), "goals.md should start with # Goals");
    const configContent = await readFile(artifacts.configFile, "utf8");
    assert.match(configContent, /^route: full$/m, "config.md route should be full");
    assert.match(configContent, new RegExp(`^run_id: ${runId}$`, "m"), "config.md run_id should match");
  });
});

test("goals returns controlled FAIL when synthesizer does not call goals_return", async () => {
  await withWorkspace(async ({ runtime }) => {
    const outcome = await goalsStage.run({
      ...runtime,
      services: {
        ...runtime.services,
        dispatcher: new NoToolDispatcher(),
      },
    });

    assert.equal(outcome.status, "FAIL");
    assert.match(outcome.summary, /did not call goals_return/);
    assert.equal(outcome.telemetry?.terminal_review_state, undefined);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  runtime: Awaited<ReturnType<typeof buildRuntime>>;
  workspace: string;
}

async function withWorkspace(fn: (ctx: TestContext) => Promise<void>): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-goals-"));
  try {
    const runtime = await buildRuntime(workspace);
    await fn({ runtime, workspace });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function buildRuntime(workspace: string) {
  const artifacts = getRunArtifacts(workspace, RUN_ID);
  await ensureRunDirectories(artifacts);
  const state = Run.start({
    runId: RUN_ID,
    userTask: USER_TASK,
    interactionMode: "automated",
    failurePolicy: "best-effort",
  }).toSnapshot();
  return {
    state,
    workspaceRoot: workspace,
    services: {
      pi: { exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }) },
      commandContext: { signal: new AbortController().signal },
      eventContext: { signal: new AbortController().signal },
      dispatcher: new FailingDispatcher("placeholder"),
      agentDefinitions: await loadAgentDefinitions(),
      gates: automatedGates(),
      progress: noopProgress(),
      artifactRepo: FileSystemArtifactRepository.fromPaths(artifacts),
      telemetrySink: { record: async () => {}, regenerateRunLog: async () => {}, regenerateMetrics: async () => {} },
    } as unknown as PipelineServices,
  };
}

/** Dispatcher where the synthesizer properly calls goals_return and reviewer returns PASS. */
class GoalsSynthDispatcher implements Dispatcher {
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (request.target.kind !== "leaf") return textResult("");
    switch (request.target.name) {
      case "qrspi-goals-synthesizer":
        return invokeGoalsReturn(request, "full");
      case "qrspi-goals-reviewer":
        return textResult("### Status — PASS\n\n### Summary\nPass.");
      default:
        return textResult("");
    }
  }
  async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((r) => this.dispatch(r)));
  }
  async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const r of requests) results.push(await this.dispatch(r));
    return results;
  }
  async dispatchGenericCoding() {
    return { status: "FAIL" as const, filesWritten: [], summary: "not used" };
  }
}

/** Dispatcher where the synthesizer completes but never calls goals_return. */
class NoToolDispatcher implements Dispatcher {
  async dispatch(_request: DispatchRequest): Promise<DispatchResult> {
    return textResult("I have written the goals document.");
  }
  async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((r) => this.dispatch(r)));
  }
  async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((r) => this.dispatch(r)));
  }
  async dispatchGenericCoding() {
    return { status: "FAIL" as const, filesWritten: [], summary: "not used" };
  }
}

/** Dispatcher where every dispatch returns a session_error. */
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

  async dispatchGenericCoding(_prompt: string) {
    return {
      status: "FAIL" as const,
      filesWritten: [],
      summary: this.message,
      telemetry: { dispatch_end_reason: "session_error" },
    };
  }
}

async function invokeGoalsReturn(request: DispatchRequest, route: "full" | "quick-fix"): Promise<DispatchResult> {
  const calls: Array<{ name: string; result: CustomToolResult }> = [];
  const tool = request.customTools?.find((c) => c.name === "goals_return");
  if (tool) {
    const callTool = tool as unknown as { execute(...args: unknown[]): Promise<CustomToolResult> };
    const result = await callTool.execute(
      "tool-1",
      {
        goalsMarkdown:
          "# Goals\n\n## Intent\nBuild an express server.\n\n## Functional Requirements\n- Expose /health.\n\n## Non-Functional Requirements\nNone specified.\n\n## Technical Specification\nNone specified.\n\n## Constraints\nNone specified.\n\n## Non-Goals\nNone specified.\n\n## Acceptance Criteria\n1. GET /health returns 200.",
        route,
      },
      undefined,
      undefined,
      {},
    );
    calls.push({ name: "goals_return", result });
  }
  return { text: "", messages: [], customToolCalls: calls };
}

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [] };
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
    createAskHumanTool() {
      return createAskHumanTool(this);
    },
    createGoalsReturnTool() {
      return createGoalsReturnTool();
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
