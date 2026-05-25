import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import activate from "../src/index";
import type {
  ExtensionAPI,
  CommandDefinition,
  ToolDefinition,
} from "../src/types/pi-extensions";

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

test("legacy qrspi_dispatch and qrspi_get_subagent_result tools are NOT registered", () => {
  const { pi, tools } = createMockPi();
  activate(pi);

  const legacyTools = tools.filter(
    (t) =>
      t.definition.name === "qrspi_dispatch" ||
      t.definition.name === "qrspi_get_subagent_result",
  );
  assert.equal(legacyTools.length, 0);
});

test("legacy question wrapper tool is not registered", () => {
  const { pi, tools } = createMockPi();
  activate(pi);

  const removedQuestionTool = ["qrspi", "question"].join("_");
  const questionTools = tools.filter(
    (t) => t.definition.name === removedQuestionTool,
  );
  assert.equal(questionTools.length, 0);
});

test("resources_discover event listener is subscribed", () => {
  const { pi, events } = createMockPi();
  activate(pi);

  const discoverEvents = events.filter((e) => e.event === "resources_discover");
  assert.equal(discoverEvents.length, 1);
  assert.equal(typeof discoverEvents[0]!.handler, "function");
});

test("resources_discover handler returns skillPaths array with at least one path", () => {
  const { pi, events } = createMockPi();
  activate(pi);

  const discoverEvents = events.filter((e) => e.event === "resources_discover");
  const handler = discoverEvents[0]!.handler;
  const result = handler() as { skillPaths?: string[] };

  assert.ok(
    Array.isArray(result.skillPaths) && result.skillPaths.length > 0,
    "handler must return skillPaths array with at least one path",
  );
  assert.ok(
    typeof result.skillPaths![0] === "string" &&
      result.skillPaths![0]!.length > 0,
    "first skillPath must be a non-empty string",
  );
  assert.ok(
    fs.existsSync(path.join(result.skillPaths![0]!, "deepwork", "SKILL.md")),
    "first skillPath must contain deepwork/SKILL.md",
  );
});

test("resources_discover handler mirrors agents into the workspace cwd from the event payload", () => {
  const { pi, events } = createMockPi();
  activate(pi);

  const discoverEvents = events.filter((e) => e.event === "resources_discover");
  const handler = discoverEvents[0]!.handler;

  const tmpRoot = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-discover-"),
  );
  try {
    handler({ type: "resources_discover", cwd: tmpRoot, reason: "test" });
    const mirroredAgentsDir = path.join(tmpRoot, ".pi", "agents");
    assert.ok(
      fs.existsSync(mirroredAgentsDir),
      `expected ${mirroredAgentsDir} to be created when event payload cwd is provided`,
    );
    const mirrored = fs
      .readdirSync(mirroredAgentsDir)
      .filter((f) => f.endsWith(".md"));
    assert.ok(
      mirrored.length > 0,
      "expected at least one bundled qrspi-*.md to be mirrored",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("skills/deepwork/SKILL.md exists on disk", () => {
  const skillFilePath = path.join(
    projectRoot,
    "skills",
    "deepwork",
    "SKILL.md",
  );
  assert.ok(
    fs.existsSync(skillFilePath),
    `SKILL.md must exist at: ${skillFilePath}`,
  );
});

test("package.json matches expected manifest shape", () => {
  const pkgPath = path.join(projectRoot, "package.json");
  const raw = fs.readFileSync(pkgPath, "utf-8");
  const pkg = JSON.parse(raw) as Record<string, unknown>;

  assert.equal(pkg.name, "pi-deepwork");
  assert.equal(pkg.main, "index.js");

  const peers = pkg.peerDependencies as Record<string, unknown> | undefined;
  assert.ok(peers !== undefined, "peerDependencies must be defined");
  assert.ok(
    "@tintinweb/pi-subagents" in peers,
    "@tintinweb/pi-subagents must be in peerDependencies",
  );
  assert.equal(
    peers["@tintinweb/pi-subagents"],
    ">=0.7.3",
    "@tintinweb/pi-subagents must declare the minimum compatible peer version",
  );

  const scripts = pkg.scripts as Record<string, unknown> | undefined;
  assert.equal(typeof scripts?.test, "string", "scripts.test must be a string");

  const version = pkg.version as string;
  assert.ok(
    /^\d+\.\d+\.\d+/.test(version),
    `version "${version}" must match semver-like pattern`,
  );

  assert.equal(pkg.type, "commonjs");
});

// ---------------------------------------------------------------------------
// /deepwork-doctor
// ---------------------------------------------------------------------------

interface CapturedConfirm {
  title: string;
  message: string;
}

function makeDoctorCtx(cwd: string): {
  ctx: {
    cwd: string;
    ui: {
      confirm: (title: string, message: string) => Promise<boolean>;
      select: () => Promise<unknown>;
      hasUI: boolean;
    };
    signal: AbortSignal;
    sessionManager: Record<string, unknown>;
  };
  captured: CapturedConfirm[];
} {
  const captured: CapturedConfirm[] = [];
  const controller = new AbortController();
  return {
    ctx: {
      cwd,
      ui: {
        confirm: async (title: string, message: string) => {
          captured.push({ title, message });
          return true;
        },
        select: async () => undefined,
        hasUI: true,
      },
      signal: controller.signal,
      sessionManager: {},
    },
    captured,
  };
}

test("/deepwork-doctor command is registered with description and handler", () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const doctorCmds = commands.filter((c) => c.name === "deepwork-doctor");
  assert.equal(doctorCmds.length, 1);
  const cmd = doctorCmds[0]!.definition;
  assert.ok(typeof cmd.description === "string" && cmd.description.length > 0);
  assert.equal(typeof cmd.handler, "function");
});

test("/deepwork-doctor handler prints diagnostic sections and mirrors agents on demand", async () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const doctorCmd = commands.find((c) => c.name === "deepwork-doctor");
  assert.ok(doctorCmd, "deepwork-doctor command must be registered");

  const tmpRoot = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-doctor-"),
  );
  try {
    const { ctx, captured } = makeDoctorCtx(tmpRoot);
    await doctorCmd!.definition.handler(
      {},
      ctx as unknown as Parameters<typeof doctorCmd.definition.handler>[1],
    );

    assert.equal(captured.length, 1, "doctor must call ctx.ui.confirm once");
    const message = captured[0]!.message;
    assert.equal(captured[0]!.title, "Deepwork Doctor");

    for (const section of [
      "=== EXTENSION ===",
      "=== BUNDLED SKILL ===",
      "=== SKILL COMPAT ===",
      "=== AGENTS ===",
      "=== GIT ===",
      "=== LAST DISCOVER EVENT ===",
      "=== LAST ACTIVATE-TIME MIRROR ===",
    ]) {
      assert.ok(
        message.includes(section),
        `doctor message must include "${section}"`,
      );
    }

    assert.ok(
      message.includes(`workspace_cwd=${tmpRoot}`),
      "doctor message must report the workspace cwd it was invoked with",
    );

    const mirroredAgentsDir = path.join(tmpRoot, ".pi", "agents");
    assert.ok(
      fs.existsSync(mirroredAgentsDir),
      "doctor must mirror agents into the workspace .pi/agents directory",
    );
    const mirrored = fs
      .readdirSync(mirroredAgentsDir)
      .filter((f) => f.endsWith(".md"));
    assert.ok(
      mirrored.length > 0,
      "doctor must produce at least one mirrored qrspi-*.md file",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("/deepwork-doctor report reflects the last resources_discover event cwd", async () => {
  const { pi, commands, events } = createMockPi();
  activate(pi);

  const discoverEvents = events.filter((e) => e.event === "resources_discover");
  assert.equal(discoverEvents.length, 1);
  const discoverHandler = discoverEvents[0]!.handler;

  const discoverCwd = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-doctor-discover-"),
  );
  const invokeCwd = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-doctor-invoke-"),
  );

  try {
    discoverHandler({
      type: "resources_discover",
      cwd: discoverCwd,
      reason: "test-discover",
    });

    const doctorCmd = commands.find((c) => c.name === "deepwork-doctor");
    assert.ok(doctorCmd);
    const { ctx, captured } = makeDoctorCtx(invokeCwd);
    await doctorCmd!.definition.handler(
      {},
      ctx as unknown as Parameters<typeof doctorCmd.definition.handler>[1],
    );

    const message = captured[0]!.message;
    assert.ok(
      message.includes(`cwd=${discoverCwd}`),
      "doctor must surface the most recent resources_discover cwd",
    );
    assert.ok(
      message.includes("reason=test-discover"),
      "doctor must surface the resources_discover reason",
    );
  } finally {
    fs.rmSync(discoverCwd, { recursive: true, force: true });
    fs.rmSync(invokeCwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Live /deepwork bootstrap surfaces agents block + writes bootstrap.json
// ---------------------------------------------------------------------------

test("/deepwork live handler writes telemetry/bootstrap.json and includes AGENTS block in the UI message", async () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const deepworkCmd = commands.find((c) => c.name === "deepwork");
  assert.ok(deepworkCmd);

  const tmpRoot = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-bootstrap-"),
  );
  try {
    const { ctx, captured } = makeDoctorCtx(tmpRoot);
    await deepworkCmd!.definition.handler(
      { task: "smoke test" },
      ctx as unknown as Parameters<typeof deepworkCmd.definition.handler>[1],
    );

    const startedMessage = captured.find((c) => c.title === "Deepwork Started");
    assert.ok(
      startedMessage,
      "live /deepwork must surface a 'Deepwork Started' confirmation",
    );
    assert.ok(
      startedMessage!.message.includes("=== AGENTS ==="),
      "Deepwork Started message must include an AGENTS block",
    );
    assert.ok(
      startedMessage!.message.includes("=== RUNTIME ==="),
      "Deepwork Started message must include a RUNTIME block",
    );

    const pipelineDir = path.join(tmpRoot, ".pipeline");
    assert.ok(
      fs.existsSync(pipelineDir),
      "live /deepwork must create the .pipeline directory",
    );
    const runDirs = fs
      .readdirSync(pipelineDir)
      .filter((d) => d.startsWith("qrspi-"));
    assert.equal(
      runDirs.length,
      1,
      "exactly one qrspi run dir must be created",
    );
    const bootstrapPath = path.join(
      pipelineDir,
      runDirs[0]!,
      "telemetry",
      "bootstrap.json",
    );
    assert.ok(
      fs.existsSync(bootstrapPath),
      `bootstrap.json must be written at ${bootstrapPath}`,
    );
    const parsed = JSON.parse(fs.readFileSync(bootstrapPath, "utf-8")) as {
      run_id?: string;
      agents?: { registered_qrspi?: number };
    };
    assert.ok(
      typeof parsed.run_id === "string" && parsed.run_id.startsWith("qrspi-"),
      "bootstrap.json must record the run_id",
    );
    assert.ok(
      typeof parsed.agents?.registered_qrspi === "number" &&
        parsed.agents.registered_qrspi >= 0,
      "bootstrap.json must record agents.registered_qrspi",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// deepwork_bootstrap tool removal
// ---------------------------------------------------------------------------

test("activate() registers no deepwork_bootstrap tool", () => {
  const { pi, tools } = createMockPi();
  activate(pi);

  const bootstrap = tools.find(
    (t) => t.definition.name === "deepwork_bootstrap",
  );
  assert.equal(
    bootstrap,
    undefined,
    "deepwork_bootstrap tool must not be registered; the /deepwork command handler owns agent mirroring",
  );
});

test("activate() does not register any tools at all (no pi.registerTool calls)", () => {
  const { pi, tools } = createMockPi();
  activate(pi);
  assert.equal(
    tools.length,
    0,
    "extension currently registers no tools; if a new tool is added, update this assertion",
  );
});

// ---------------------------------------------------------------------------
// /deepwork-doctor file artifact
// ---------------------------------------------------------------------------

test("/deepwork-doctor writes .pi/deepwork-doctor-report.md alongside the confirm dialog", async () => {
  const { pi, commands } = createMockPi();
  activate(pi);

  const doctorCmd = commands.find((c) => c.name === "deepwork-doctor")!;
  const tmpRoot = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-doctor-artifact-"),
  );
  try {
    const { ctx, captured } = makeDoctorCtx(tmpRoot);
    await doctorCmd.definition.handler(
      {},
      ctx as unknown as Parameters<typeof doctorCmd.definition.handler>[1],
    );

    const reportPath = path.join(tmpRoot, ".pi", "deepwork-doctor-report.md");
    assert.ok(
      fs.existsSync(reportPath),
      `doctor must write a file artifact at ${reportPath}`,
    );
    const reportContent = fs.readFileSync(reportPath, "utf-8");
    for (const section of [
      "=== EXTENSION ===",
      "=== BUNDLED SKILL ===",
      "=== AGENTS ===",
      "=== GIT ===",
    ]) {
      assert.ok(
        reportContent.includes(section),
        `report file must include "${section}"`,
      );
    }

    assert.equal(captured.length, 1, "confirm dialog must still fire");
    assert.ok(
      captured[0]!.message.includes(reportPath),
      "confirm message must reference the report file path",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Activation-time mirror guard
// ---------------------------------------------------------------------------

test("activate() skips the activation-time mirror when process.cwd() is not a workspace root", () => {
  const { pi, commands } = createMockPi();

  // Use an empty tmpdir with no workspace markers (no package.json, no .git, etc.)
  const nonWorkspaceCwd = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-nonworkspace-"),
  );
  const originalCwd = process.cwd();
  try {
    process.chdir(nonWorkspaceCwd);
    activate(pi);

    // No .pi/agents/ should have been created in the non-workspace dir
    assert.equal(
      fs.existsSync(path.join(nonWorkspaceCwd, ".pi", "agents")),
      false,
      "activate() must not mirror agents into a non-workspace cwd",
    );

    // /deepwork-doctor invoked here should surface the skip reason
    const doctorCmd = commands.find((c) => c.name === "deepwork-doctor")!;
    const { ctx, captured } = makeDoctorCtx(nonWorkspaceCwd);
    return doctorCmd.definition
      .handler(
        {},
        ctx as unknown as Parameters<typeof doctorCmd.definition.handler>[1],
      )
      .then(() => {
        const message = captured[0]!.message;
        assert.ok(
          message.includes("LAST ACTIVATE-TIME MIRROR"),
          "doctor must include the activate-time mirror section",
        );
        assert.ok(
          /skipped/i.test(message),
          "doctor must surface that the activate-time mirror was skipped",
        );
      });
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(nonWorkspaceCwd, { recursive: true, force: true });
  }
});

test("activate() runs the activation-time mirror when process.cwd() looks like a workspace root", () => {
  const { pi, commands } = createMockPi();

  const workspaceCwd = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "pi-deepwork-workspace-"),
  );
  // Drop a package.json marker so looksLikeWorkspaceRoot returns true
  fs.writeFileSync(
    path.join(workspaceCwd, "package.json"),
    '{"name":"smoke","version":"0.0.0"}\n',
    "utf-8",
  );

  const originalCwd = process.cwd();
  try {
    process.chdir(workspaceCwd);
    activate(pi);

    const doctorCmd = commands.find((c) => c.name === "deepwork-doctor")!;
    const { ctx, captured } = makeDoctorCtx(workspaceCwd);
    return doctorCmd.definition
      .handler(
        {},
        ctx as unknown as Parameters<typeof doctorCmd.definition.handler>[1],
      )
      .then(() => {
        const message = captured[0]!.message;
        assert.ok(
          message.includes("LAST ACTIVATE-TIME MIRROR"),
          "doctor must include the activate-time mirror section",
        );
        assert.ok(
          !/skipped/i.test(message.split("LAST ACTIVATE-TIME MIRROR")[1] ?? ""),
          "doctor must NOT report skip when cwd has a workspace marker",
        );
      });
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspaceCwd, { recursive: true, force: true });
  }
});
