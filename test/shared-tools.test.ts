import test from "node:test";
import assert from "node:assert/strict";
import {
  createDispatchTool,
  createQuestionTool,
  setPi,
} from "../src/shared-tools";
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
    modelRegistry: {},
    model: "test-model",
    signal: new AbortController().signal,
    abort: () => {},
    shutdown: () => {},
    ...overrides,
  } as ExtensionContext;
}

function resetGlobalState(): void {
  setPi(null);
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
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawnAndWait: async (): Promise<MockResult> => ({
        agentId: "agent-fg-1",
        status: "completed",
        result: "All tasks done",
        startedAt: new Date().toISOString(),
      }),
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
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes("### Status — PASS"));
  assert.ok(result.content.includes("agent-fg-1"));
  assert.ok(result.content.includes("All tasks done"));
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

test("dispatch: background mode returns RUNNING with agent ID", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  let spawnCalled = false;
  let spawnAndWaitCalled = false;
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawn: () => {
        spawnCalled = true;
        return "agent-bg-1";
      },
      spawnAndWait: async () => {
        spawnAndWaitCalled = true;
        return {} as MockResult;
      },
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
  assert.ok(result.content.includes("Subagent dispatched in background"));
  const details = asDetails(result.details);
  assert.equal(details.status, "running");
  assert.equal(details.agentId, "agent-bg-1");
  assert.equal(spawnCalled, true, "spawn should be called for background");
  assert.equal(
    spawnAndWaitCalled,
    false,
    "spawnAndWait must not be called for background dispatch",
  );
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
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawnAndWait: async (): Promise<MockResult> => ({
        agentId: "agent-failed-1",
        status: "failed",
        error: "Task crashed",
        startedAt: new Date().toISOString(),
      }),
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
// createDispatchTool — spawnAndWait throws (error propagation)
// ---------------------------------------------------------------------------

test("dispatch: spawnAndWait throws returns FAIL with error message, no uncaught exception", async () => {
  resetGlobalState();
  setPi({ api: "fake" } as any);
  (globalThis as Record<string, unknown>)[MANAGER_SYMBOL as unknown as string] =
    {
      spawnAndWait: async () => {
        throw new Error("spawnAndWait explosion");
      },
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
  assert.ok(result.content.includes("spawnAndWait explosion"));
  setPi(null);
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
