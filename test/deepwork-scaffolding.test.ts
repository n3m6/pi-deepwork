import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { mock } from "node:test";

import activate from "../src/index";
import type { ExtensionAPI, ExtensionContext, CommandDefinition } from "../src/types/pi-extensions";

const childProcess = require("node:child_process");

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface RecordedCommand {
  name: string;
  definition: CommandDefinition;
}

interface ConfirmCall {
  title: string;
  message: string;
}

function createMockPi(): { pi: ExtensionAPI; commands: RecordedCommand[] } {
  const commands: RecordedCommand[] = [];
  const pi: ExtensionAPI = {
    registerCommand(name: string, definition: CommandDefinition): void {
      commands.push({ name, definition });
    },
    registerTool(): void {},
    on(): void {},
  };
  return { pi, commands };
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deepwork-test-"));
}

function makeMockCtx(
  tmpDir: string,
  confirmCalls: ConfirmCall[],
  alwaysReturn: boolean = true,
): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      confirm: async (title: string, message: string) => {
        confirmCalls.push({ title, message });
        return alwaysReturn;
      },
      select: async () => "default",
    },
    cwd: tmpDir,
    sessionManager: {},
    modelRegistry: {},
    model: "test-model",
    signal: new AbortController().signal,
    abort: () => {},
    shutdown: () => {},
  };
}

function makeMockCtxWithResponses(
  tmpDir: string,
  confirmCalls: ConfirmCall[],
  responses: boolean[],
): ExtensionContext {
  let idx = 0;
  return {
    hasUI: true,
    ui: {
      confirm: async (title: string, message: string) => {
        confirmCalls.push({ title, message });
        return responses[idx++] ?? true;
      },
      select: async () => "default",
    },
    cwd: tmpDir,
    sessionManager: {},
    modelRegistry: {},
    model: "test-model",
    signal: new AbortController().signal,
    abort: () => {},
    shutdown: () => {},
  };
}

function extractRunId(confirmCalls: ConfirmCall[]): string | null {
  for (const call of confirmCalls) {
    const match = /=== RUN ID ===\n(qrspi-\d{8}-\d{6})/.exec(call.message);
    if (match) return match[1]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("deepwork handler creates pipeline scaffolding with git available", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    mock.method(childProcess, "spawnSync", (_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === "--version") return { status: 0, stdout: "", stderr: "" };
      if (Array.isArray(args) && args[0] === "checkout") return { status: 0, stdout: "", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    });

    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined, "deepwork command must be registered");

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler({ task: "Test task" }, ctx);
    });

    // (d) Captured confirmation message includes run ID and task
    const runId = extractRunId(confirmCalls);
    assert.ok(runId !== null, "Should extract run ID from confirmation message");

    const startedCall = confirmCalls.find((c) => c.title === "Deepwork Started");
    assert.ok(startedCall !== undefined, "Should have Deepwork Started confirmation");
    assert.ok(startedCall!.message.includes(runId), "Confirmation must include run ID");
    assert.ok(startedCall!.message.includes("Test task"), "Confirmation must include task text");

    // (a) .pipeline/qrspi-<run-id>/ dir exists
    const pipelineDir = path.join(tmpDir, ".pipeline", runId);
    assert.ok(fs.existsSync(pipelineDir), `.pipeline/${runId} directory must exist`);

    // (b) state.md exists with valid YAML containing required keys
    const statePath = path.join(pipelineDir, "state.md");
    assert.ok(fs.existsSync(statePath), "state.md must exist");

    const stateContent = fs.readFileSync(statePath, "utf-8");
    assert.ok(stateContent.startsWith("---"), "state.md must start with YAML delimiter");
    assert.ok(stateContent.includes("run_id:"), "state.md must contain run_id");
    assert.ok(stateContent.includes("next_stage:"), "state.md must contain next_stage");
    assert.ok(stateContent.includes("last_completed_stage:"), "state.md must contain last_completed_stage");
    assert.ok(stateContent.includes("resume_source:"), "state.md must contain resume_source");

    // (c) events.jsonl exists
    const eventsPath = path.join(pipelineDir, "telemetry", "events.jsonl");
    assert.ok(fs.existsSync(eventsPath), "telemetry/events.jsonl must exist");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler creates scaffolding even when git is unavailable", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    mock.method(childProcess, "spawnSync", () => {
      throw new Error("git not found");
    });

    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined);

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler({ task: "Gitless task" }, ctx);
    });

    const runId = extractRunId(confirmCalls);
    assert.ok(runId !== null, "Should extract run ID even without git");

    const pipelineDir = path.join(tmpDir, ".pipeline", runId);
    assert.ok(fs.existsSync(pipelineDir), ".pipeline dir must exist without git");
    assert.ok(fs.existsSync(path.join(pipelineDir, "state.md")), "state.md must exist without git");
    assert.ok(fs.existsSync(path.join(pipelineDir, "telemetry", "events.jsonl")), "events.jsonl must exist without git");

    const startedCall = confirmCalls.find((c) => c.title === "Deepwork Started");
    assert.ok(startedCall !== undefined, "Confirmation must be shown");
    assert.ok(startedCall!.message.includes("Gitless task"), "Confirmation must include task");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler: empty task with No response aborts without artifacts", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    // 1st call: "No task description..." → false (No)
    // 2nd call: "Deepwork aborted..." → true (acknowledge)
    const ctx = makeMockCtxWithResponses(tmpDir, confirmCalls, [false, true]);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined);

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler({ task: "" }, ctx);
    });

    assert.equal(confirmCalls.length, 2, "Should have exactly 2 confirm calls");

    assert.equal(confirmCalls[0]!.title, "Deepwork Task");
    assert.ok(confirmCalls[0]!.message.includes("No task description provided"), "First prompt must ask about missing task");

    assert.equal(confirmCalls[1]!.title, "Deepwork Task");
    assert.ok(confirmCalls[1]!.message.includes("Deepwork aborted"), "Second message must confirm abort");

    // No pipeline directory should exist
    const pipelineRoot = path.join(tmpDir, ".pipeline");
    assert.equal(fs.existsSync(pipelineRoot), false, ".pipeline directory must not exist");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
