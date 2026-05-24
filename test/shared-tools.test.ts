import test from "node:test";
import assert from "node:assert/strict";
import {
  createDispatchTool,
  createGetSubagentResultTool,
  createQuestionTool,
  setPi,
} from "../src/shared-tools";
import { __setSubagentModuleLoaderForTests } from "../src/subagent-catalog";
import type { ExtensionContext } from "../src/types/pi-extensions";

const MANAGER_SYMBOL = Symbol.for("pi-subagents:manager");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockResult {
  agentId: string;
  status: string;
  result?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

interface MockRecord {
  id: string;
  status: string;
  result?: string;
  error?: string;
  toolUses?: number;
  startedAt: number;
  completedAt?: number;
  promise?: Promise<string>;
  resultConsumed?: boolean;
}

function makeMockCtx(
  overrides: Partial<ExtensionContext> = {},
): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      confirm: async () => true,
      select: async (_title: string, _options: string[]) => "A",
    },
    cwd: "/fake/cwd",
    sessionManager: {},
    modelRegistry: {
      find: () => undefined,
      getAll: () => [],
      getAvailable: () => [],
    },
    model: "test-model",
    signal: new AbortController().signal,
    abort: () => {},
    shutdown: () => {},
    ...overrides,
  } as ExtensionContext;
}

function resetGlobalState(): void {
  setPi(null);
  __setSubagentModuleLoaderForTests();
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
}

/** Cast details to MockResult for assertions. */
function asDetails(v: Record<string, unknown> | undefined): MockResult {
  return (v ?? {}) as unknown as MockResult;
}

// ---------------------------------------------------------------------------
// createDispatchTool — shape and factory
// ---------------------------------------------------------------------------

test("createDispatchTool returns tool with name 'qrspi_dispatch'", () => {
  const tool = createDispatchTool();
  assert.equal(tool.name, "qrspi_dispatch");
});

test("createDispatchTool has non-empty description", () => {
  const tool = createDispatchTool();
  assert.ok(
    typeof tool.description === "string" && tool.description.length > 0,
  );
});

// ---------------------------------------------------------------------------
// createDispatchTool — parameter validation
// ---------------------------------------------------------------------------

test("dispatch: non-object params returns FAIL", async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    "not-an-object" as unknown as Record<string, unknown>,
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("Invalid parameters"));
});

test("dispatch: missing subagent_type returns FAIL", async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    { prompt: "p", description: "d" },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("subagent_type"));
});

test("dispatch: missing prompt returns FAIL", async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    { subagent_type: "t", description: "d" },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("prompt"));
});

test("dispatch: missing description returns FAIL", async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    { subagent_type: "t", prompt: "p" },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("description"));
});

// ---------------------------------------------------------------------------
// createDispatchTool — missing pi-subagents manager
// ---------------------------------------------------------------------------

test("dispatch: missing pi-subagents manager returns FAIL with install message", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    { subagent_type: "t", prompt: "p", description: "d" },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("@tintinweb/pi-subagents"));
  setPi(null);
});

// ---------------------------------------------------------------------------
// createDispatchTool — foreground success
// ---------------------------------------------------------------------------

test("dispatch: foreground success returns PASS with agent ID and result text", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  const refreshCalls: Array<Map<string, unknown>> = [];
  __setSubagentModuleLoaderForTests((moduleId: string) => {
    if (moduleId === "@tintinweb/pi-subagents/src/custom-agents.ts") {
      return {
        loadCustomAgents: (cwd: string) =>
          new Map<string, unknown>([["cwd", cwd]]),
      };
    }

    if (moduleId === "@tintinweb/pi-subagents/src/agent-types.ts") {
      return {
        registerAgents: (agents: Map<string, unknown>) => {
          refreshCalls.push(agents);
        },
      };
    }

    throw new Error(`unexpected module: ${moduleId}`);
  });
  const signal = new AbortController().signal;
  const record: MockRecord = {
    id: "agent-fg-1",
    status: "completed",
    result: "All tasks done",
    toolUses: 3,
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve("All tasks done"),
  };
  let receivedOptions: Record<string, unknown> | undefined;
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: (
        _pi: unknown,
        _ctx: ExtensionContext,
        _type: string,
        _prompt: string,
        options: Record<string, unknown>,
      ) => {
        receivedOptions = options;
        return record.id;
      },
      getRecord: (id: string) => (id === record.id ? record : undefined),
      hasRunning: () => false,
      waitForAll: async () => {},
    };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    {
      subagent_type: "qrspi-goals-synthesizer",
      prompt: "do work",
      description: "foreground test",
    },
    signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — PASS"));
  assert.ok(result.content.includes("agent-fg-1"));
  assert.ok(result.content.includes("All tasks done"));
  assert.equal(receivedOptions?.description, "foreground test");
  assert.equal(receivedOptions?.signal, signal);
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0]?.get("cwd"), "/fake/cwd");
  const details = asDetails(result.details);
  assert.equal(details.status, "completed");
  assert.equal(details.agentId, "agent-fg-1");
  assert.ok(typeof details.result === "string");
  setPi(null);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

// ---------------------------------------------------------------------------
// createDispatchTool — background success
// ---------------------------------------------------------------------------

test("dispatch: background mode returns RUNNING and marks the spawn as background", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  const record: MockRecord = {
    id: "agent-bg-1",
    status: "running",
    startedAt: Date.now(),
    promise: Promise.resolve("done"),
  };
  let receivedOptions: Record<string, unknown> | undefined;
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: (
        _pi: unknown,
        _ctx: ExtensionContext,
        _type: string,
        _prompt: string,
        options: Record<string, unknown>,
      ) => {
        receivedOptions = options;
        return record.id;
      },
      getRecord: (id: string) => (id === record.id ? record : undefined),
      hasRunning: () => false,
      waitForAll: async () => {},
    };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    {
      subagent_type: "qrspi-goals-synthesizer",
      prompt: "do work",
      description: "background test",
      run_in_background: true,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — RUNNING"));
  assert.ok(result.content.includes("agent-bg-1"));
  assert.ok(result.content.includes("qrspi_get_subagent_result"));
  assert.equal(receivedOptions?.isBackground, true);
  const details = asDetails(result.details);
  assert.equal(details.status, "running");
  assert.equal(details.agentId, "agent-bg-1");
  setPi(null);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

// ---------------------------------------------------------------------------
// createDispatchTool — foreground failure (subagent failed)
// ---------------------------------------------------------------------------

test("dispatch: foreground subagent failed returns FAIL with error", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  const record: MockRecord = {
    id: "agent-failed-1",
    status: "error",
    error: "Task crashed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve(""),
  };
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => record.id,
      getRecord: (id: string) => (id === record.id ? record : undefined),
      hasRunning: () => false,
      waitForAll: async () => {},
    };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    {
      subagent_type: "qrspi-goals-synthesizer",
      prompt: "do work",
      description: "failure test",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("agent-failed-1"));
  assert.ok(result.content.includes("Task crashed"));
  setPi(null);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

// ---------------------------------------------------------------------------
// createDispatchTool — foreground spawn throws (error propagation)
// ---------------------------------------------------------------------------

test("dispatch: spawn throws returns FAIL with error message, no uncaught exception", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => {
        throw new Error("spawn explosion");
      },
      getRecord: () => undefined,
      hasRunning: () => false,
      waitForAll: async () => {},
    };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    {
      subagent_type: "t",
      prompt: "p",
      description: "d",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("dispatch failed:"));
  assert.ok(result.content.includes("spawn explosion"));
  setPi(null);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

test("dispatch: model override resolves to manager model and uses camelCase options", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  const fakeModel = { id: "anthropic/claude-sonnet-4-5" };
  const record: MockRecord = {
    id: "agent-model-1",
    status: "completed",
    result: "ok",
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve("ok"),
  };
  let receivedOptions: Record<string, unknown> | undefined;
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: (
        _pi: unknown,
        _ctx: ExtensionContext,
        _type: string,
        _prompt: string,
        options: Record<string, unknown>,
      ) => {
        receivedOptions = options;
        return record.id;
      },
      getRecord: (id: string) => (id === record.id ? record : undefined),
      hasRunning: () => false,
      waitForAll: async () => {},
    };
  const tool = createDispatchTool();
  const ctx = makeMockCtx({
    modelRegistry: {
      find: (query: string) =>
        query === "anthropic/claude-sonnet-4-5" ? fakeModel : undefined,
      getAll: () => [],
      getAvailable: () => [],
    },
  });
  await tool.execute(
    "id",
    {
      subagent_type: "t",
      prompt: "p",
      description: "d",
      model: "anthropic/claude-sonnet-4-5",
      thinking: "high",
      max_turns: 40,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.equal(receivedOptions?.model, fakeModel);
  assert.equal(receivedOptions?.thinkingLevel, "high");
  assert.equal(receivedOptions?.maxTurns, 40);
  assert.equal(receivedOptions?.description, "d");
  assert.equal("thinking" in (receivedOptions ?? {}), false);
  assert.equal("max_turns" in (receivedOptions ?? {}), false);
  setPi(null);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

test("dispatch: unresolved model override fails before spawn", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  let spawnCalled = false;
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => {
        spawnCalled = true;
        return "agent-never-runs";
      },
      getRecord: () => undefined,
      hasRunning: () => false,
      waitForAll: async () => {},
    };
  const tool = createDispatchTool();
  const ctx = makeMockCtx({ modelRegistry: null });
  const result = await tool.execute(
    "id",
    {
      subagent_type: "t",
      prompt: "p",
      description: "d",
      model: "anthropic/claude-sonnet-4-5",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — FAIL"));
  assert.ok(result.content.includes("modelRegistry"));
  assert.equal(spawnCalled, false);
  setPi(null);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

// ---------------------------------------------------------------------------
// createGetSubagentResultTool — shape and behavior
// ---------------------------------------------------------------------------

test("createGetSubagentResultTool returns tool with name 'qrspi_get_subagent_result'", () => {
  const tool = createGetSubagentResultTool();
  assert.equal(tool.name, "qrspi_get_subagent_result");
});

test("get subagent result: running record without wait returns RUNNING", async () => {
  resetGlobalState();
  const record: MockRecord = {
    id: "agent-running-1",
    status: "running",
    startedAt: Date.now(),
    promise: Promise.resolve("done"),
  };
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => record.id,
      getRecord: (id: string) => (id === record.id ? record : undefined),
      hasRunning: () => true,
      waitForAll: async () => {},
    };
  const tool = createGetSubagentResultTool();
  const result = await tool.execute(
    "id",
    { agent_id: record.id },
    new AbortController().signal,
    () => {},
    makeMockCtx(),
  );
  assert.ok(result.content.includes("### Status — RUNNING"));
  assert.ok(result.content.includes(record.id));
  assert.ok(result.content.includes("wait: true"));
  const details = asDetails(result.details);
  assert.equal(details.status, "running");
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

test("get subagent result: wait true joins a running background task", async () => {
  resetGlobalState();
  const record: MockRecord = {
    id: "agent-running-2",
    status: "running",
    startedAt: Date.now(),
    promise: Promise.resolve("done"),
  };
  const finalRecord: MockRecord = {
    id: record.id,
    status: "completed",
    result: "Background complete",
    startedAt: record.startedAt,
    completedAt: Date.now(),
    promise: record.promise!,
  };
  let phase: "running" | "completed" = "running";
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => record.id,
      getRecord: (id: string) => {
        if (id !== record.id) return undefined;
        return phase === "running" ? record : finalRecord;
      },
      hasRunning: () => phase === "running",
      waitForAll: async () => {
        phase = "completed";
      },
    };
  const tool = createGetSubagentResultTool();
  const result = await tool.execute(
    "id",
    { agent_id: record.id, wait: true },
    new AbortController().signal,
    () => {},
    makeMockCtx(),
  );
  assert.ok(result.content.includes("### Status — PASS"));
  assert.ok(result.content.includes("Background complete"));
  assert.equal(record.resultConsumed, true);
  const details = asDetails(result.details);
  assert.equal(details.status, "completed");
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

test("get subagent result: queued record without promise waits through waitForAll", async () => {
  resetGlobalState();
  const record: MockRecord = {
    id: "agent-queued-1",
    status: "queued",
    startedAt: Date.now(),
  };
  const finalRecord: MockRecord = {
    id: record.id,
    status: "completed",
    result: "Queued work finished",
    startedAt: record.startedAt,
    completedAt: Date.now(),
  };
  let phase: "queued" | "completed" = "queued";
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => record.id,
      getRecord: (id: string) => {
        if (id !== record.id) return undefined;
        return phase === "queued" ? record : finalRecord;
      },
      hasRunning: () => phase === "queued",
      waitForAll: async () => {
        phase = "completed";
      },
    };
  const tool = createGetSubagentResultTool();
  const result = await tool.execute(
    "id",
    { agent_id: record.id, wait: true },
    new AbortController().signal,
    () => {},
    makeMockCtx(),
  );
  assert.ok(result.content.includes("### Status — PASS"));
  assert.ok(result.content.includes("Queued work finished"));
  assert.equal(record.resultConsumed, true);
  delete (globalThis as Record<string, unknown>)[
    MANAGER_SYMBOL as unknown as string
  ];
});

// ---------------------------------------------------------------------------
// createQuestionTool — shape and factory
// ---------------------------------------------------------------------------

test("createQuestionTool returns tool with name 'qrspi_question'", () => {
  const tool = createQuestionTool();
  assert.equal(tool.name, "qrspi_question");
});

test("createQuestionTool has non-empty description", () => {
  const tool = createQuestionTool();
  assert.ok(
    typeof tool.description === "string" && tool.description.length > 0,
  );
});

// ---------------------------------------------------------------------------
// createQuestionTool — confirm type: affirmative
// ---------------------------------------------------------------------------

test("question: confirm affirmative returns 'User confirmed: Yes'", async () => {
  let confirmCalled = 0;
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: {
      confirm: async () => {
        confirmCalled++;
        return true;
      },
      select: async () => "unused",
    } as ExtensionContext["ui"],
  });
  const result = await tool.execute(
    "id",
    {
      header: "Proceed?",
      message: "Continue?",
      options: ["Yes", "No"],
      type: "confirm",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("User confirmed: Yes"));
  const d = result.details as Record<string, unknown> | undefined;
  assert.equal(d?.answer, "Yes");
  assert.equal(d?.cancelled, false);
  assert.equal(confirmCalled, 1, "confirm should be called exactly once");
});

// ---------------------------------------------------------------------------
// createQuestionTool — confirm type: negative
// ---------------------------------------------------------------------------

test("question: confirm negative returns 'User confirmed: No'", async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: {
      confirm: async () => false,
      select: async () => "unused",
    } as ExtensionContext["ui"],
  });
  const result = await tool.execute(
    "id",
    {
      header: "Proceed?",
      message: "Continue?",
      options: ["Yes", "No"],
      type: "confirm",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("User confirmed: No"));
  const d = result.details as Record<string, unknown> | undefined;
  assert.equal(d?.answer, "No");
});

// ---------------------------------------------------------------------------
// createQuestionTool — select type: chosen
// ---------------------------------------------------------------------------

test("question: select chosen returns 'User selected: <option>'", async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: {
      confirm: async () => true,
      select: async () => "Option B",
    } as ExtensionContext["ui"],
  });
  const result = await tool.execute(
    "id",
    {
      header: "Pick one",
      message: "Choose an option",
      options: ["A", "Option B", "C"],
      type: "select",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("User selected: Option B"));
  const d = result.details as Record<string, unknown> | undefined;
  assert.equal(d?.answer, "Option B");
  assert.equal(d?.cancelled, false);
});

// ---------------------------------------------------------------------------
// createQuestionTool — select cancellation
// ---------------------------------------------------------------------------

test("question: select cancelled returns cancellation message", async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: {
      confirm: async () => true,
      select: async () => undefined,
    } as ExtensionContext["ui"],
  });
  const result = await tool.execute(
    "id",
    {
      header: "Pick one",
      message: "Choose",
      options: ["A", "B", "C"],
      type: "select",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  const content = result.content;
  assert.ok(
    content.includes("User cancelled selection") ||
      content.includes("cancelled") ||
      content.includes("cancel"),
    `Expected cancellation message, got: ${content}`,
  );
  const d = result.details as Record<string, unknown> | undefined;
  assert.equal(d?.cancelled, true);
});

// ---------------------------------------------------------------------------
// createQuestionTool — invalid type
// ---------------------------------------------------------------------------

test("question: invalid type returns error message", async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    "id",
    {
      header: "h",
      message: "m",
      options: ["A"],
      type: "bogus",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("Error"));
  assert.ok(result.content.includes("Invalid type"));
});

// ---------------------------------------------------------------------------
// createQuestionTool — hasUI: false fallback
// ---------------------------------------------------------------------------

test("question: confirm with hasUI:false returns [NO UI — DEFAULT]", async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({ hasUI: false });
  const result = await tool.execute(
    "id",
    {
      header: "Proceed?",
      message: "Continue?",
      options: ["Yes", "No"],
      type: "confirm",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("[NO UI — DEFAULT]"));
  const d = result.details as Record<string, unknown> | undefined;
  assert.equal(d?.uiUnavailable, true);
});

test("question: select with hasUI:false returns [NO UI — DEFAULT]", async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({ hasUI: false });
  const result = await tool.execute(
    "id",
    {
      header: "Pick one",
      message: "Choose",
      options: ["Alpha", "Beta", "Gamma"],
      type: "select",
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("[NO UI — DEFAULT]"));
  const d = result.details as Record<string, unknown> | undefined;
  assert.equal(d?.uiUnavailable, true);
});
