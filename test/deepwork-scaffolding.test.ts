import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { mock } from "node:test";

import activate from "../src/index";
import { getDryRunArtifactPaths } from "../src/pipeline";
import {
  __setSubagentModuleLoaderForTests,
  REQUIRED_QRSPI_STAGE_AGENTS,
} from "../src/subagent-catalog";
import type {
  ExtensionAPI,
  ExtensionContext,
  CommandDefinition,
} from "../src/types/pi-extensions";

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

function createMockPi(
  options: {
    sendUserMessageImpl?: (content: unknown) => void | Promise<void>;
  } = {},
): {
  pi: ExtensionAPI;
  commands: RecordedCommand[];
  sentUserMessages: string[];
} {
  const commands: RecordedCommand[] = [];
  const sentUserMessages: string[] = [];
  const pi: ExtensionAPI = {
    registerCommand(name: string, definition: CommandDefinition): void {
      commands.push({ name, definition });
    },
    registerTool(): void {},
    on(): void {},
    sendMessage: async () => {},
    sendUserMessage: async (content) => {
      if (options.sendUserMessageImpl) {
        await options.sendUserMessageImpl(content);
        return;
      }
      sentUserMessages.push(
        typeof content === "string" ? content : JSON.stringify(content),
      );
    },
  };
  return { pi, commands, sentUserMessages };
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deepwork-test-"));
}

function makeMockCtx(
  tmpDir: string,
  confirmCalls: ConfirmCall[],
  alwaysReturn: boolean = true,
  sessionManager: ExtensionContext["sessionManager"] = {},
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
    sessionManager,
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
  sessionManager: ExtensionContext["sessionManager"] = {},
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
    sessionManager,
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

function makeRequiredAgentMap(cwd: string): Map<string, unknown> {
  return new Map(
    REQUIRED_QRSPI_STAGE_AGENTS.map((agentName) => [agentName, { cwd }]),
  );
}

function expectedRequiredAgentNames(): string[] {
  return [...REQUIRED_QRSPI_STAGE_AGENTS].sort();
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
      if (Array.isArray(args) && args[0] === "--version")
        return { status: 0, stdout: "", stderr: "" };
      if (Array.isArray(args) && args[0] === "checkout")
        return { status: 0, stdout: "", stderr: "" };
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
    assert.ok(
      runId !== null,
      "Should extract run ID from confirmation message",
    );

    const startedCall = confirmCalls.find(
      (c) => c.title === "Deepwork Started",
    );
    assert.ok(
      startedCall !== undefined,
      "Should have Deepwork Started confirmation",
    );
    assert.ok(
      startedCall!.message.includes(runId),
      "Confirmation must include run ID",
    );
    assert.ok(
      startedCall!.message.includes("Test task"),
      "Confirmation must include task text",
    );

    // (a) .pipeline/qrspi-<run-id>/ dir exists
    const pipelineDir = path.join(tmpDir, ".pipeline", runId);
    assert.ok(
      fs.existsSync(pipelineDir),
      `.pipeline/${runId} directory must exist`,
    );

    // (b) state.md exists with valid YAML containing required keys
    const statePath = path.join(pipelineDir, "state.md");
    assert.ok(fs.existsSync(statePath), "state.md must exist");

    const stateContent = fs.readFileSync(statePath, "utf-8");
    assert.ok(
      stateContent.startsWith("---"),
      "state.md must start with YAML delimiter",
    );
    assert.ok(stateContent.includes("run_id:"), "state.md must contain run_id");
    assert.ok(
      stateContent.includes("next_stage:"),
      "state.md must contain next_stage",
    );
    assert.ok(
      stateContent.includes("last_completed_stage:"),
      "state.md must contain last_completed_stage",
    );
    assert.ok(
      stateContent.includes("resume_source:"),
      "state.md must contain resume_source",
    );
    assert.ok(
      stateContent.includes('mode: "live"'),
      "state.md must record live mode",
    );

    // (c) events.jsonl exists
    const eventsPath = path.join(pipelineDir, "telemetry", "events.jsonl");
    assert.ok(fs.existsSync(eventsPath), "telemetry/events.jsonl must exist");
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler writes scaffolding under ctx.cwd when process.cwd differs", async () => {
  const originalCwd = process.cwd();
  const processDir = createTempDir();
  const workspaceDir = createTempDir();
  process.chdir(processDir);

  try {
    mock.method(childProcess, "spawnSync", (_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === "--version") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (Array.isArray(args) && args[0] === "checkout") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(workspaceDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined, "deepwork command must be registered");

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler(
        { task: "Scoped workspace task" },
        ctx,
      );
    });

    const runId = extractRunId(confirmCalls);
    assert.ok(
      runId !== null,
      "Should extract run ID from confirmation message",
    );

    assert.equal(
      fs.existsSync(path.join(workspaceDir, ".pipeline", runId)),
      true,
      "pipeline should be created under ctx.cwd",
    );
    assert.equal(
      fs.existsSync(path.join(processDir, ".pipeline", runId)),
      false,
      "pipeline should not be created under process.cwd",
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, ".pi", "agents", "qrspi-goals.md")),
      true,
      "bundled QRSPI agents should be mirrored into the workspace .pi/agents directory",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(processDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
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
    assert.ok(
      fs.existsSync(pipelineDir),
      ".pipeline dir must exist without git",
    );
    assert.ok(
      fs.existsSync(path.join(pipelineDir, "state.md")),
      "state.md must exist without git",
    );
    assert.ok(
      fs.existsSync(path.join(pipelineDir, "telemetry", "events.jsonl")),
      "events.jsonl must exist without git",
    );

    const stateContent = fs.readFileSync(
      path.join(pipelineDir, "state.md"),
      "utf-8",
    );
    assert.ok(
      stateContent.includes('mode: "live"'),
      "state.md must record live mode",
    );

    const startedCall = confirmCalls.find(
      (c) => c.title === "Deepwork Started",
    );
    assert.ok(startedCall !== undefined, "Confirmation must be shown");
    assert.ok(
      startedCall!.message.includes("Gitless task"),
      "Confirmation must include task",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler preserves an existing project-local QRSPI agent override", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const agentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const overridePath = path.join(agentsDir, "qrspi-goals.md");
    fs.writeFileSync(overridePath, "# custom override\n", "utf-8");

    mock.method(childProcess, "spawnSync", (_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === "--version") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (Array.isArray(args) && args[0] === "checkout") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined, "deepwork command must be registered");

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler({ task: "Respect overrides" }, ctx);
    });

    assert.equal(
      fs.readFileSync(overridePath, "utf-8"),
      "# custom override\n",
      "existing project-local QRSPI agent overrides must not be overwritten",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler hands the runtime-scaffolded run to pi.sendUserMessage", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const refreshCalls: string[][] = [];
    const legacyMirroredAgentPath = path.join(
      tmpDir,
      ".pi",
      "agents",
      "qrspi-goals.md",
    );
    const legacyMirroredAgentContent = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "agents", "qrspi-goals.md"),
      "utf-8",
    );
    fs.mkdirSync(path.dirname(legacyMirroredAgentPath), { recursive: true });
    fs.writeFileSync(
      legacyMirroredAgentPath,
      legacyMirroredAgentContent,
      "utf-8",
    );

    __setSubagentModuleLoaderForTests((moduleId: string) => {
      if (moduleId === "@tintinweb/pi-subagents/src/custom-agents.ts") {
        return {
          loadCustomAgents: (cwd: string) => makeRequiredAgentMap(cwd),
        };
      }

      if (moduleId === "@tintinweb/pi-subagents/src/agent-types.ts") {
        return {
          registerAgents: (agents: Map<string, unknown>) => {
            refreshCalls.push([...agents.keys()].sort());
          },
        };
      }

      throw new Error(`unexpected module: ${moduleId}`);
    });

    mock.method(childProcess, "spawnSync", (_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === "--version")
        return { status: 0, stdout: "", stderr: "" };
      if (Array.isArray(args) && args[0] === "checkout")
        return { status: 0, stdout: "", stderr: "" };
      return { status: 1, stdout: "", stderr: "" };
    });

    let handoffMessage = "";
    const { pi, commands } = createMockPi({
      sendUserMessageImpl: async (content) => {
        assert.equal(
          refreshCalls.length,
          1,
          "deepwork should refresh the custom-agent registry before handoff",
        );
        assert.deepEqual(refreshCalls[0], expectedRequiredAgentNames());
        assert.equal(
          fs.existsSync(path.join(tmpDir, ".pi", "agents", "qrspi-goals.md")),
          true,
          "deepwork should mirror bundled QRSPI agents before handoff",
        );
        const mirroredAgentContent = fs.readFileSync(
          legacyMirroredAgentPath,
          "utf-8",
        );
        assert.match(
          mirroredAgentContent,
          /^name:\s*qrspi-goals$/m,
          "deepwork should upgrade legacy mirrored QRSPI agents with an explicit name field",
        );
        assert.match(
          mirroredAgentContent,
          /^systemPromptMode:\s*replace$/m,
          "deepwork should add the active pi-subagents prompt-mode alias when mirroring QRSPI agents",
        );
        assert.doesNotMatch(
          mirroredAgentContent,
          /^extensions:\s*false$/m,
          "deepwork should write a cross-runtime extensions field that active pi-subagents can parse",
        );
        handoffMessage =
          typeof content === "string" ? content : JSON.stringify(content);
      },
    });
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined, "deepwork command must be registered");

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler({ task: "Handoff task" }, ctx);
    });

    assert.notEqual(handoffMessage, "", "deepwork must hand off one prompt");
    assert.match(
      handoffMessage,
      /Continue the existing Deepwork pipeline run/i,
    );
    assert.match(
      handoffMessage,
      /Do not write or edit project source files directly/,
    );
    assert.match(handoffMessage, /=== RUNTIME DISCOVERY ===/);
    assert.match(handoffMessage, /Project agent directory:/);
    assert.match(handoffMessage, /=== NEXT DISPATCH ===/);
    assert.match(handoffMessage, /subagent_type: "qrspi-goals"/);
    assert.match(handoffMessage, /Do not search for SKILL\.md/);
    assert.match(
      handoffMessage,
      /Do not invoke QRSPI stages through generic Agent\/subagent tools/,
    );
    assert.match(handoffMessage, /Deepwork configuration error/);
    assert.match(handoffMessage, /=== RUN ID ===\nqrspi-\d{8}-\d{6}/);
    assert.match(handoffMessage, /=== USER TASK ===\nHandoff task/);
  } finally {
    __setSubagentModuleLoaderForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler reports a scaffolded but inactive run when handoff fails", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    mock.method(childProcess, "spawnSync", (_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === "--version") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (Array.isArray(args) && args[0] === "checkout") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    const { pi, commands } = createMockPi({
      sendUserMessageImpl: async () => {
        throw new Error("handoff unavailable");
      },
    });
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined, "deepwork command must be registered");

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler(
        { task: "Handoff failure task" },
        ctx,
      );
    });

    const runId = extractRunId(confirmCalls);
    assert.ok(
      runId !== null,
      "Should extract run ID from confirmation message",
    );

    const startedCall = confirmCalls.find(
      (call) => call.title === "Deepwork Started",
    );
    assert.ok(
      startedCall !== undefined,
      "Should show Deepwork Started confirmation",
    );
    assert.match(startedCall!.message, /no Deepwork orchestrator is active/i);
    assert.match(startedCall!.message, /handoff unavailable/);
    assert.match(
      startedCall!.message,
      new RegExp(`/deepwork-resume run-id:\"${runId}\"`),
    );

    assert.equal(
      fs.existsSync(path.join(tmpDir, ".pipeline", runId, "state.md")),
      true,
      "scaffolding must still exist after handoff failure",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler dry-run writes artifacts under ctx.cwd when process.cwd differs", async () => {
  const originalCwd = process.cwd();
  const processDir = createTempDir();
  const workspaceDir = createTempDir();
  process.chdir(processDir);

  try {
    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(workspaceDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined, "deepwork command must be registered");

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler(
        { task: "Dry-run scoped task", "dry-run": "true", route: "quick-fix" },
        ctx,
      );
    });

    const runId = extractRunId(confirmCalls);
    assert.ok(
      runId !== null,
      "Should extract run ID from confirmation message",
    );

    assert.equal(
      fs.existsSync(path.join(workspaceDir, ".pipeline", runId, "state.md")),
      true,
      "dry-run artifacts should be created under ctx.cwd",
    );
    assert.equal(
      fs.existsSync(path.join(processDir, ".pipeline", runId)),
      false,
      "dry-run artifacts should not be created under process.cwd",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(processDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
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
    assert.ok(
      confirmCalls[0]!.message.includes("No task description provided"),
      "First prompt must ask about missing task",
    );

    assert.equal(confirmCalls[1]!.title, "Deepwork Task");
    assert.ok(
      confirmCalls[1]!.message.includes("Deepwork aborted"),
      "Second message must confirm abort",
    );

    // No pipeline directory should exist
    const pipelineRoot = path.join(tmpDir, ".pipeline");
    assert.equal(
      fs.existsSync(pipelineRoot),
      false,
      ".pipeline directory must not exist",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler dry-run creates a completed full-route simulation without git side effects", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const spawnCalls: string[][] = [];
    mock.method(childProcess, "spawnSync", (_cmd: string, args: string[]) => {
      spawnCalls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    });

    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined);

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler(
        { task: "Dry-run task", "dry-run": "true" },
        ctx,
      );
    });

    const runId = extractRunId(confirmCalls);
    assert.ok(
      runId !== null,
      "Should extract run ID from dry-run confirmation",
    );

    const completeCall = confirmCalls.find(
      (c) => c.title === "Deepwork Dry Run Complete",
    );
    assert.ok(
      completeCall !== undefined,
      "Dry run should emit a completion confirmation",
    );
    assert.ok(
      completeCall!.message.includes("dry-run"),
      "Completion message must identify dry-run mode",
    );
    assert.ok(
      completeCall!.message.includes("full"),
      "Completion message must include route",
    );

    const pipelineDir = path.join(tmpDir, ".pipeline", runId);
    const stateContent = fs.readFileSync(
      path.join(pipelineDir, "state.md"),
      "utf-8",
    );
    assert.ok(
      stateContent.includes('mode: "dry-run"'),
      "state.md must record dry-run mode",
    );
    assert.ok(
      stateContent.includes('route: "full"'),
      "state.md must record the full route",
    );
    assert.ok(
      stateContent.includes('next_stage: "done"'),
      "dry-run state should be complete",
    );
    assert.ok(
      stateContent.includes('last_completed_stage: "10"'),
      "dry-run state should end at report",
    );

    for (const artifact of getDryRunArtifactPaths(runId!, "full")) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, artifact)),
        `${artifact} must exist for full dry-run`,
      );
    }

    const eventsContent = fs.readFileSync(
      path.join(pipelineDir, "telemetry", "events.jsonl"),
      "utf-8",
    );
    assert.ok(
      eventsContent.includes('"event_type":"run.completed"'),
      "events.jsonl must include run.completed",
    );
    assert.equal(
      spawnCalls.length,
      0,
      "dry-run must not call git or other child processes",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork handler dry-run quick-fix skips design, structure, and replan artifacts", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const deepworkCmd = commands.find((c) => c.name === "deepwork");
    assert.ok(deepworkCmd !== undefined);

    await assert.doesNotReject(async () => {
      await deepworkCmd.definition.handler(
        { task: "Quick dry-run task", "dry-run": "true", route: "quick-fix" },
        ctx,
      );
    });

    const runId = extractRunId(confirmCalls);
    assert.ok(
      runId !== null,
      "Should extract run ID from quick-fix dry-run confirmation",
    );

    const pipelineDir = path.join(tmpDir, ".pipeline", runId);
    const stateContent = fs.readFileSync(
      path.join(pipelineDir, "state.md"),
      "utf-8",
    );
    assert.ok(
      stateContent.includes('route: "quick-fix"'),
      "state.md must record quick-fix route",
    );
    assert.ok(
      stateContent.includes('next_stage: "done"'),
      "quick-fix dry-run must complete",
    );

    for (const artifact of getDryRunArtifactPaths(runId!, "quick-fix")) {
      assert.ok(
        fs.existsSync(path.join(tmpDir, artifact)),
        `${artifact} must exist for quick-fix dry-run`,
      );
    }

    assert.equal(
      fs.existsSync(path.join(pipelineDir, "design.md")),
      false,
      "design.md must be skipped on quick-fix dry-run",
    );
    assert.equal(
      fs.existsSync(path.join(pipelineDir, "structure.md")),
      false,
      "structure.md must be skipped on quick-fix dry-run",
    );
    assert.equal(
      fs.existsSync(
        path.join(
          pipelineDir,
          "phases",
          "phase-01",
          "replan",
          "phase-01-replan.md",
        ),
      ),
      false,
      "phase-local replan artifact must be skipped on quick-fix dry-run",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork-resume hands the recovered run to pi.sendUserMessage", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const refreshCalls: string[][] = [];
    __setSubagentModuleLoaderForTests((moduleId: string) => {
      if (moduleId === "@tintinweb/pi-subagents/dist/custom-agents.js") {
        return {
          loadCustomAgents: (cwd: string) => makeRequiredAgentMap(cwd),
        };
      }

      if (moduleId === "@tintinweb/pi-subagents/dist/agent-types.js") {
        return {
          registerAgents: (agents: Map<string, unknown>) => {
            refreshCalls.push([...agents.keys()].sort());
          },
        };
      }

      throw new Error(`unexpected module: ${moduleId}`);
    });

    let handoffMessage = "";
    const { pi, commands } = createMockPi({
      sendUserMessageImpl: async (content) => {
        assert.equal(
          refreshCalls.length,
          1,
          "resume should refresh the custom-agent registry before handoff",
        );
        assert.deepEqual(refreshCalls[0], expectedRequiredAgentNames());
        assert.equal(
          fs.existsSync(path.join(tmpDir, ".pi", "agents", "qrspi-goals.md")),
          true,
          "resume should preserve or mirror bundled QRSPI agents before handoff",
        );
        handoffMessage =
          typeof content === "string" ? content : JSON.stringify(content);
      },
    });
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const runId = "qrspi-20260524-160000";
    const statePath = path.join(tmpDir, ".pipeline", runId, "state.md");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      `---\nrun_id: ${runId}\nmode: "live"\nroute: "full"\ncurrent_phase: 1\ntotal_phases: 1\nlast_completed_stage: "5"\nnext_stage: "6"\nstages_completed: []\nphase_history: []\nbackward_loops: 0\nresume_source: "resume"\ninteraction_mode: "interactive"\nfailure_policy: "fail-closed"\n---\n`,
      "utf-8",
    );

    const resumeCmd = commands.find((c) => c.name === "deepwork-resume");
    assert.ok(
      resumeCmd !== undefined,
      "deepwork-resume command must be registered",
    );

    await assert.doesNotReject(async () => {
      await resumeCmd.definition.handler({ "run-id": runId }, ctx);
    });

    assert.notEqual(handoffMessage, "", "resume must hand off one prompt");
    assert.match(handoffMessage, /Resume the existing Deepwork pipeline run/i);
    assert.match(
      handoffMessage,
      /Do not write or edit project source files directly/,
    );
    assert.match(handoffMessage, /=== RUNTIME DISCOVERY ===/);
    assert.match(handoffMessage, /=== NEXT DISPATCH ===/);
    assert.match(handoffMessage, /subagent_type: "qrspi-implement"/);
    assert.match(handoffMessage, /Deepwork configuration error/);
    assert.match(handoffMessage, new RegExp(`=== RUN ID ===\\n${runId}`));
    assert.match(handoffMessage, /=== NEXT STAGE ===\n6/);
  } finally {
    __setSubagentModuleLoaderForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork-resume reads state from ctx.cwd when process.cwd differs", async () => {
  const originalCwd = process.cwd();
  const processDir = createTempDir();
  const workspaceDir = createTempDir();
  process.chdir(processDir);

  try {
    const { pi, commands, sentUserMessages } = createMockPi();
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(workspaceDir, confirmCalls, true);

    activate(pi);

    const runId = "qrspi-20260524-160050";
    const statePath = path.join(workspaceDir, ".pipeline", runId, "state.md");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      `---\nrun_id: ${runId}\nmode: "live"\nroute: "full"\ncurrent_phase: 1\ntotal_phases: 1\nlast_completed_stage: "5"\nnext_stage: "6"\nstages_completed: []\nphase_history: []\nbackward_loops: 0\nresume_source: "resume"\ninteraction_mode: "interactive"\nfailure_policy: "fail-closed"\n---\n`,
      "utf-8",
    );

    const resumeCmd = commands.find((c) => c.name === "deepwork-resume");
    assert.ok(
      resumeCmd !== undefined,
      "deepwork-resume command must be registered",
    );

    await assert.doesNotReject(async () => {
      await resumeCmd.definition.handler({ "run-id": runId }, ctx);
    });

    assert.equal(sentUserMessages.length, 1, "resume should use ctx.cwd state");
    assert.match(
      sentUserMessages[0] ?? "",
      new RegExp(`=== RUN ID ===\\n${runId}`),
    );
    assert.equal(
      confirmCalls.some((call) => call.title === "Resume Error"),
      false,
      "resume should not fail when state exists only under ctx.cwd",
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(processDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("deepwork-resume reports an inactive run when resume handoff fails", async () => {
  const originalCwd = process.cwd();
  const tmpDir = createTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi({
      sendUserMessageImpl: async () => {
        throw new Error("resume handoff unavailable");
      },
    });
    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeMockCtx(tmpDir, confirmCalls, true);

    activate(pi);

    const runId = "qrspi-20260524-160100";
    const statePath = path.join(tmpDir, ".pipeline", runId, "state.md");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      `---\nrun_id: ${runId}\nmode: "live"\nroute: "full"\ncurrent_phase: 1\ntotal_phases: 1\nlast_completed_stage: "5"\nnext_stage: "6"\nstages_completed: []\nphase_history: []\nbackward_loops: 0\nresume_source: "resume"\ninteraction_mode: "interactive"\nfailure_policy: "fail-closed"\n---\n`,
      "utf-8",
    );

    const resumeCmd = commands.find((c) => c.name === "deepwork-resume");
    assert.ok(
      resumeCmd !== undefined,
      "deepwork-resume command must be registered",
    );

    await assert.doesNotReject(async () => {
      await resumeCmd.definition.handler({ "run-id": runId }, ctx);
    });

    const resumeCall = confirmCalls.find(
      (call) => call.title === "Resume Pipeline",
    );
    assert.ok(
      resumeCall !== undefined,
      "Should show Resume Pipeline confirmation",
    );
    assert.match(resumeCall!.message, /no Deepwork orchestrator is active/i);
    assert.match(resumeCall!.message, /resume handoff unavailable/);
    assert.match(
      resumeCall!.message,
      new RegExp(`/deepwork-resume run-id:\"${runId}\"`),
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
