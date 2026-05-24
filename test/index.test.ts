import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import activate from "../src/index";
import type { ExtensionAPI, CommandDefinition, ToolDefinition } from "../src/types/pi-extensions";

const projectRoot = process.cwd();

// ---------------------------------------------------------------------------
// Mock ExtensionAPI with instrumentation
// ---------------------------------------------------------------------------

interface RecordedCommand {
  name: string;
  definition: CommandDefinition;
}

interface RecordedTool {
  definition: ToolDefinition;
}

interface RecordedEvent {
  event: string;
  handler: (...args: unknown[]) => unknown;
}

function createMockPi(): {
  pi: ExtensionAPI;
  commands: RecordedCommand[];
  tools: RecordedTool[];
  events: RecordedEvent[];
} {
  const commands: RecordedCommand[] = [];
  const tools: RecordedTool[] = [];
  const events: RecordedEvent[] = [];

  const pi: ExtensionAPI = {
    registerCommand(name: string, definition: CommandDefinition): void {
      commands.push({ name, definition });
    },
    registerTool(definition: ToolDefinition): void {
      tools.push({ definition });
    },
    on(event: string, handler: (...args: unknown[]) => unknown): void {
      events.push({ event, handler });
    },
    sendMessage: () => {},
    sendUserMessage: () => {},
  };

  return { pi, commands, tools, events };
}

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

test("/deepwork command is registered exactly once with description and handler", () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const deepworkCmds = commands.filter((c) => c.name === "deepwork");
  assert.equal(deepworkCmds.length, 1);
  const cmd = deepworkCmds[0]!.definition;
  assert.ok(typeof cmd.description === "string" && cmd.description.length > 0);
  assert.equal(typeof cmd.handler, "function");
});

test("/deepwork command exposes task, dry-run, and route argument completions", async () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const deepworkCmd = commands.find((c) => c.name === "deepwork");
  assert.ok(deepworkCmd, "deepwork command must be registered");

  const completions = await deepworkCmd!.definition.getArgumentCompletions?.();
  assert.ok(completions, "deepwork command must expose argument completions");
  assert.deepEqual(completions?.task, []);
  assert.deepEqual(completions?.["dry-run"], ["false", "true"]);
  assert.deepEqual(completions?.route, ["full", "quick-fix"]);
});

test("/deepwork-resume command is registered exactly once with description and handler", () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const resumeCmds = commands.filter((c) => c.name === "deepwork-resume");
  assert.equal(resumeCmds.length, 1);
  const cmd = resumeCmds[0]!.definition;
  assert.ok(typeof cmd.description === "string" && cmd.description.length > 0);
  assert.equal(typeof cmd.handler, "function");
});

test("qrspi_dispatch tool is registered exactly once with required fields", () => {
  const { pi, tools } = createMockPi();
  activate(pi);

  const dispatchTools = tools.filter(
    (t) => t.definition.name === "qrspi_dispatch"
  );
  assert.equal(dispatchTools.length, 1);
  const tool = dispatchTools[0]!.definition;
  assert.ok(typeof tool.name === "string" && tool.name.length > 0);
  assert.ok(typeof tool.description === "string" && tool.description.length > 0);
  assert.ok(typeof tool.parameters === "object" && tool.parameters !== null);
  assert.equal(typeof tool.execute, "function");

  // Check parameters schema includes expected fields
  const props = tool.parameters.properties as Record<string, unknown>;
  assert.ok("subagent_type" in props);
  assert.ok("prompt" in props);
  assert.ok("description" in props);
  assert.ok("run_in_background" in props);
});

test("qrspi_question tool is registered exactly once with required fields", () => {
  const { pi, tools } = createMockPi();
  activate(pi);

  const questionTools = tools.filter(
    (t) => t.definition.name === "qrspi_question"
  );
  assert.equal(questionTools.length, 1);
  const tool = questionTools[0]!.definition;
  assert.ok(typeof tool.name === "string" && tool.name.length > 0);
  assert.ok(typeof tool.description === "string" && tool.description.length > 0);
  assert.ok(typeof tool.parameters === "object" && tool.parameters !== null);
  assert.equal(typeof tool.execute, "function");

  // Check parameters schema includes expected fields
  const props = tool.parameters.properties as Record<string, unknown>;
  assert.ok("header" in props);
  assert.ok("message" in props);
  assert.ok("options" in props);
  assert.ok("type" in props);
});

test("resources_discover event listener is subscribed", () => {
  const { pi, events } = createMockPi();
  activate(pi);

  const discoverEvents = events.filter(
    (e) => e.event === "resources_discover"
  );
  assert.equal(discoverEvents.length, 1);
  assert.equal(typeof discoverEvents[0]!.handler, "function");
});

test("resources_discover handler returns skillPaths array with at least one path", () => {
  const { pi, events } = createMockPi();
  activate(pi);

  const discoverEvents = events.filter(
    (e) => e.event === "resources_discover"
  );
  const handler = discoverEvents[0]!.handler;
  const result = handler() as { skillPaths?: string[] };

  assert.ok(
    Array.isArray(result.skillPaths) && result.skillPaths.length > 0,
    "handler must return skillPaths array with at least one path"
  );
  assert.ok(
    typeof result.skillPaths![0] === "string" && result.skillPaths![0]!.length > 0,
    "first skillPath must be a non-empty string"
  );
});

test("skills/deepwork/SKILL.md exists on disk", () => {
  const skillFilePath = path.join(projectRoot, "skills", "deepwork", "SKILL.md");
  assert.ok(
    fs.existsSync(skillFilePath),
    `SKILL.md must exist at: ${skillFilePath}`
  );
});

test("package.json matches expected manifest shape", () => {
  const pkgPath = path.join(projectRoot, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;

  assert.equal(pkg.name, "deepwork-pi");
  assert.equal(pkg.main, "dist/index.js");

  const peers = pkg.peerDependencies as Record<string, unknown> | undefined;
  assert.ok(peers !== undefined, "peerDependencies must be defined");
  assert.ok("@tintinweb/pi-subagents" in peers, "@tintinweb/pi-subagents must be in peerDependencies");

  const scripts = pkg.scripts as Record<string, unknown> | undefined;
  assert.equal(typeof scripts?.test, "string", "scripts.test must be a string");

  const version = pkg.version as string;
  assert.ok(/^\d+\.\d+\.\d+/.test(version), `version "${version}" must match semver-like pattern`);

  assert.equal(pkg.type, "commonjs");
});
