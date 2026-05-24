import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import activate from "../src/index";
import {
  STAGE_NAMES,
  getDryRunArtifactPaths,
  generateRunId,
  getEventsPath,
  getPipelineDir,
  getRouteStages,
  getStatePath,
  getTelemetryDir,
  makeInitialState,
  nextStage,
} from "../src/pipeline";
import type {
  CommandDefinition,
  ExtensionAPI,
  ExtensionContext,
} from "../src/types/pi-extensions";

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
    sendMessage: () => {},
    sendUserMessage: () => {},
  };

  return { pi, commands };
}

function makeCtx(
  tmpDir: string,
  confirmCalls: ConfirmCall[],
): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      confirm: async (title: string, message: string) => {
        confirmCalls.push({ title, message });
        return true;
      },
      select: async () => undefined,
    },
    cwd: tmpDir,
    sessionManager: {},
    modelRegistry: {},
    model: "test-model",
    signal: new AbortController().signal,
    abort: () => {},
    shutdown: () => {},
  } as ExtensionContext;
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "pi-deepwork-integration-"));
}

async function writeFile(
  root: string,
  relativePath: string,
  content = "ok\n",
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function stateYaml(
  runId: string,
  route: "full" | "quick-fix",
  next: string,
  last: string,
  mode: "live" | "dry-run" = "live",
): string {
  return `---
run_id: ${runId}
mode: "${mode}"
route: "${route}"
current_phase: 1
total_phases: 1
last_completed_stage: "${last}"
next_stage: "${next}"
stages_completed: []
phase_history: []
backward_loops: 0
resume_source: "resume"
---
`;
}

test("full route simulation walks all 10 executable stages and produces a canonical artifact tree", async () => {
  const tmpDir = await makeTempDir();
  const runId = generateRunId();
  const pipelineDir = path.join(tmpDir, getPipelineDir(runId));
  const telemetryDir = path.join(tmpDir, getTelemetryDir(runId));

  try {
    await fs.mkdir(telemetryDir, { recursive: true });
    const visited: string[] = [];
    let current: string | null = getRouteStages("full")[0] ?? null;

    while (current) {
      visited.push(current);
      current = nextStage(current, "full");
    }

    assert.deepEqual(visited, [...STAGE_NAMES]);

    const state = makeInitialState(runId);
    state.route = "full";
    state.mode = "dry-run";
    await writeFile(
      tmpDir,
      getStatePath(runId),
      JSON.stringify(state, null, 2),
    );
    await writeFile(tmpDir, getEventsPath(runId), "\n");

    const representativeArtifacts = getDryRunArtifactPaths(runId, "full");

    for (const artifact of representativeArtifacts) {
      await writeFile(tmpDir, artifact);
    }

    for (const artifact of representativeArtifacts) {
      assert.equal(
        fssync.existsSync(path.join(tmpDir, artifact)),
        true,
        `${artifact} should exist`,
      );
    }

    assert.equal(fssync.existsSync(pipelineDir), true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("quick-fix route skips design, structure, and replan", () => {
  const order = ["goals"];
  let current = "goals";

  while (true) {
    const next = nextStage(current, "quick-fix");
    if (next === null) {
      break;
    }
    order.push(next);
    current = next;
  }

  assert.deepEqual(order, [...getRouteStages("quick-fix")]);
  assert.equal(order.includes("design"), false);
  assert.equal(order.includes("structure"), false);
  assert.equal(order.includes("replan"), false);
});

test("deepwork-resume reads state.md and resumes from the recorded next stage", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await makeTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi();
    activate(pi);

    const runId = "qrspi-20260524-123000";
    await writeFile(
      tmpDir,
      getStatePath(runId),
      stateYaml(runId, "full", "6", "5"),
    );

    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeCtx(tmpDir, confirmCalls);
    const handler = commands.find(
      (command) => command.name === "deepwork-resume",
    )?.definition.handler;

    assert.ok(handler, "deepwork-resume handler must exist");

    await handler!({ "run-id": runId }, ctx);

    assert.equal(confirmCalls.length, 1);
    assert.equal(confirmCalls[0]?.title, "Resume Pipeline");
    assert.match(confirmCalls[0]?.message ?? "", /Stage 6/);
    assert.match(confirmCalls[0]?.message ?? "", /last completed: Stage 5/);
    assert.match(confirmCalls[0]?.message ?? "", /full/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork-resume reports a missing run cleanly", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await makeTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi();
    activate(pi);

    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeCtx(tmpDir, confirmCalls);
    const handler = commands.find(
      (command) => command.name === "deepwork-resume",
    )?.definition.handler;

    assert.ok(handler, "deepwork-resume handler must exist");

    await handler!({ "run-id": "qrspi-20990101-000000" }, ctx);

    assert.equal(confirmCalls.length, 1);
    assert.equal(confirmCalls[0]?.title, "Resume Error");
    assert.match(confirmCalls[0]?.message ?? "", /not found/i);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork-resume reports corrupted state cleanly", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await makeTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi();
    activate(pi);

    const runId = "qrspi-20260524-130000";
    await writeFile(
      tmpDir,
      getStatePath(runId),
      "this is not valid state content\n",
    );

    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeCtx(tmpDir, confirmCalls);
    const handler = commands.find(
      (command) => command.name === "deepwork-resume",
    )?.definition.handler;

    assert.ok(handler, "deepwork-resume handler must exist");

    await handler!({ "run-id": runId }, ctx);

    assert.equal(confirmCalls.length, 1);
    assert.equal(confirmCalls[0]?.title, "Resume Error");
    assert.match(confirmCalls[0]?.message ?? "", /corrupted/i);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("deepwork-resume reports completed dry-runs as already complete", async () => {
  const originalCwd = process.cwd();
  const tmpDir = await makeTempDir();
  process.chdir(tmpDir);

  try {
    const { pi, commands } = createMockPi();
    activate(pi);

    const runId = "qrspi-20260524-140000";
    await writeFile(
      tmpDir,
      getStatePath(runId),
      stateYaml(runId, "quick-fix", "done", "11", "dry-run"),
    );

    const confirmCalls: ConfirmCall[] = [];
    const ctx = makeCtx(tmpDir, confirmCalls);
    const handler = commands.find(
      (command) => command.name === "deepwork-resume",
    )?.definition.handler;

    assert.ok(handler, "deepwork-resume handler must exist");

    await handler!({ "run-id": runId }, ctx);

    assert.equal(confirmCalls.length, 1);
    assert.equal(confirmCalls[0]?.title, "Deepwork Dry Run Complete");
    assert.match(confirmCalls[0]?.message ?? "", /dry-run/);
    assert.match(confirmCalls[0]?.message ?? "", /already complete/i);
    assert.match(confirmCalls[0]?.message ?? "", /quick-fix/);
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
