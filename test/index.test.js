const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const { default: activate } = require('../dist/index');
const sharedTools = require('../dist/shared-tools');

// ══════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════

/** Create a mock ExtensionAPI that records registerCommand, registerTool, on calls. */
function makeMockPi() {
  const commands = [];
  const tools = [];
  const events = [];
  return {
    registerCommand: (name, def) => commands.push({ name, def }),
    registerTool: (def) => tools.push(def),
    on: (eventName, handler) => events.push({ event: eventName, handler }),
    _commands: commands,
    _tools: tools,
    _events: events,
  };
}

/** Create a mock ExtensionContext. 
 *  confirmReturn can be:
 *    - a boolean (always return that)
 *    - an array of booleans (returned in order)
 *    - a function `(callIndex, title, message) => boolean`
 */
function makeMockCtx(options = {}) {
  const confirmCalls = [];
  const confirmReturn = options.confirmReturn;
  let callIdx = 0;
  return {
    hasUI: options.hasUI ?? true,
    signal: options.signal ?? new AbortController().signal,
    ui: {
      confirm: async (title, message, opts) => {
        confirmCalls.push({ title, message, opts });
        let result;
        if (typeof confirmReturn === 'function') {
          result = confirmReturn(callIdx, title, message);
        } else if (Array.isArray(confirmReturn)) {
          result = confirmReturn[callIdx] ?? true;
        } else {
          result = confirmReturn ?? true;
        }
        callIdx++;
        return result;
      },
      select: async (title, options) => {
        return typeof options[0] === 'string' ? options[0] : 'A';
      },
    },
    _confirmCalls: confirmCalls,
  };
}

/** Create a temp directory, chdir into it, run async fn, then restore cwd and cleanup. */
async function withTempDir(fn) {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwork-test-'));
  try {
    process.chdir(tempDir);
    return await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Extract handlers after calling activate with a mock pi. */
function setupHandlers() {
  // Reset _pi to avoid cross-test contamination
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);
  const deepworkCmd = mockPi._commands.find(c => c.name === 'deepwork');
  const resumeCmd = mockPi._commands.find(c => c.name === 'deepwork-resume');
  assert.ok(deepworkCmd, 'deepwork command should be registered');
  assert.ok(resumeCmd, 'deepwork-resume command should be registered');
  return {
    deepworkHandler: deepworkCmd.def.handler,
    resumeHandler: resumeCmd.def.handler,
  };
}

/** Capture console.warn calls. Returns { logs: [], restore: fn }. */
function captureConsoleWarn() {
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { logs.push(args.join(' ')); };
  return {
    logs,
    restore: () => { console.warn = originalWarn; },
  };
}

/** Mock child_process.spawnSync for git commands.
 *  versionStatus: 0 = git available, non-zero = not available
 *  checkoutStatus: 0 = success, non-zero = failure
 */
function mockGitSpawnSync({ versionStatus, checkoutStatus, checkoutError } = {}) {
  const original = cp.spawnSync;
  cp.spawnSync = function (cmd, args, opts) {
    if (cmd === 'git') {
      const subcommand = args && args[0];
      if (subcommand === '--version') {
        const status = versionStatus ?? 0;
        return {
          status,
          stderr: status !== 0 ? 'git: command not found' : '',
          stdout: status === 0 ? 'git version 2.40.1' : '',
        };
      }
      if (subcommand === 'checkout') {
        const status = checkoutStatus ?? 0;
        return {
          status,
          stderr: status !== 0 ? (checkoutError || "fatal: A branch named 'qrspi/test' already exists.") : '',
          stdout: status === 0 ? "Switched to a new branch 'qrspi/test'" : '',
        };
      }
    }
    return original(cmd, args, opts);
  };
  return () => { cp.spawnSync = original; };
}

// ══════════════════════════════════════════════════════════
// Registration Tests — activate() with mock pi
// ══════════════════════════════════════════════════════════

test('activate registers /deepwork command', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);

  const cmd = mockPi._commands.find(c => c.name === 'deepwork');
  assert.ok(cmd, 'Expected registerCommand to be called with "deepwork"');
  assert.equal(typeof cmd.def.description, 'string');
  assert.ok(cmd.def.description.includes('QRSPI'), 'Description should mention QRSPI');
  assert.equal(typeof cmd.def.handler, 'function', 'Handler should be a callable function');
  assert.equal(typeof cmd.def.getArgumentCompletions, 'function', 'Should have getArgumentCompletions');
});

test('activate registers /deepwork-resume command', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);

  const cmd = mockPi._commands.find(c => c.name === 'deepwork-resume');
  assert.ok(cmd, 'Expected registerCommand to be called with "deepwork-resume"');
  assert.equal(typeof cmd.def.description, 'string');
  assert.ok(cmd.def.description.includes('Resume'), 'Description should mention "Resume"');
  assert.equal(typeof cmd.def.handler, 'function', 'Handler should be a callable function');
  assert.equal(typeof cmd.def.getArgumentCompletions, 'function', 'Should have getArgumentCompletions');
});

test('activate registers both qrspi_dispatch and qrspi_question tools', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);

  assert.equal(mockPi._tools.length, 2, 'Expected exactly 2 tools registered');
  const toolNames = mockPi._tools.map(t => t.name).sort();
  assert.deepEqual(toolNames, ['qrspi_dispatch', 'qrspi_question']);
});

test('activate registers tools with required fields', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);

  for (const tool of mockPi._tools) {
    assert.equal(typeof tool.name, 'string', `Tool ${tool.name} should have a name`);
    assert.equal(typeof tool.label, 'string', `Tool ${tool.name} should have a label`);
    assert.equal(typeof tool.description, 'string', `Tool ${tool.name} should have a description`);
    assert.equal(typeof tool.parameters, 'object', `Tool ${tool.name} should have parameters`);
    assert.equal(typeof tool.execute, 'function', `Tool ${tool.name} should have an execute function`);
  }
});

test('activate subscribes to resources_discover event', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);

  const sub = mockPi._events.find(e => e.event === 'resources_discover');
  assert.ok(sub, 'Expected pi.on to be called with "resources_discover"');
  assert.equal(typeof sub.handler, 'function', 'Handler should be a function');

  const result = sub.handler();
  assert.ok(result && typeof result === 'object', 'Handler should return an object');
  assert.ok(Array.isArray(result.skillPaths), 'Result should have skillPaths array');
  assert.equal(result.skillPaths.length, 1, 'skillPaths should have exactly 1 entry');
  assert.ok(
    result.skillPaths[0].endsWith('skills'),
    `skillPaths entry should end with "skills", got: ${result.skillPaths[0]}`
  );
});

test('activate sets _pi on shared-tools module', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  activate(mockPi);

  assert.strictEqual(sharedTools._pi, mockPi, 'activate() should set _pi to the ExtensionAPI');
});

// ══════════════════════════════════════════════════════════
// /deepwork handler — valid task
// ══════════════════════════════════════════════════════════

test('/deepwork with valid task creates pipeline directory tree and state.md', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx();
    const signal = new AbortController().signal;
    ctx.signal = signal;

    await deepworkHandler({ task: 'Build a chat app' }, ctx);

    // Extract runId from the confirm message
    const confirmCalls = ctx._confirmCalls;
    assert.ok(confirmCalls.length >= 1, 'Expected at least one confirm call');
    const kickoffMsg = confirmCalls[confirmCalls.length - 1].message;
    assert.ok(kickoffMsg.includes('=== RUN ID ==='), `Kickoff message should contain === RUN ID ===, got: ${kickoffMsg.slice(0, 200)}`);
    assert.ok(kickoffMsg.includes('=== USER TASK ==='), 'Kickoff message should contain === USER TASK ===');
    assert.ok(kickoffMsg.includes('Build a chat app'), 'Kickoff message should contain the task description');

    const runIdMatch = kickoffMsg.match(/=== RUN ID ===\n(qrspi-\d{8}-\d{6})/);
    assert.ok(runIdMatch, 'Could not extract runId from kickoff message');
    const runId = runIdMatch[1];

    // Verify directory structure
    const pipelineDir = path.join(tempDir, '.pipeline', runId);
    assert.ok(fs.existsSync(pipelineDir), `.pipeline/${runId} should exist`);
    assert.ok(fs.statSync(pipelineDir).isDirectory(), `.pipeline/${runId} should be a directory`);

    // Verify state.md
    const statePath = path.join(pipelineDir, 'state.md');
    assert.ok(fs.existsSync(statePath), 'state.md should exist');
    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.ok(stateContent.includes(`run_id: ${runId}`), 'state.md should contain the run_id');
    assert.ok(stateContent.includes('last_completed_stage: "0"'), 'state.md should have last_completed_stage: "0"');
    assert.ok(stateContent.includes('next_stage: "1"'), 'state.md should have next_stage: "1"');
    assert.ok(stateContent.includes('resume_source: "fresh"'), 'state.md should have resume_source: "fresh"');
    assert.ok(stateContent.startsWith('---\n'), 'state.md should start with YAML frontmatter');

    // Verify telemetry directory
    const telemetryDir = path.join(pipelineDir, 'telemetry');
    assert.ok(fs.existsSync(telemetryDir), 'telemetry/ directory should exist');
    assert.ok(fs.statSync(telemetryDir).isDirectory(), 'telemetry/ should be a directory');

    // Verify events.jsonl
    const eventsPath = path.join(telemetryDir, 'events.jsonl');
    assert.ok(fs.existsSync(eventsPath), 'events.jsonl should exist');
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork handler — empty task, user confirms
// ══════════════════════════════════════════════════════════

test('/deepwork with empty task and user confirms proceeds with default task', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx({ confirmReturn: [true] });

    await deepworkHandler({ task: '' }, ctx);

    // Should have two confirm calls: prompt + kickoff
    assert.ok(ctx._confirmCalls.length >= 2, `Expected at least 2 confirm calls, got ${ctx._confirmCalls.length}`);
    const promptCall = ctx._confirmCalls[0];
    assert.equal(promptCall.title, 'Deepwork Task');
    assert.ok(promptCall.message.includes('Run a generic deepwork pipeline?'), `Expected prompt message, got: ${promptCall.message}`);

    const kickoffCall = ctx._confirmCalls[ctx._confirmCalls.length - 1];
    assert.equal(kickoffCall.title, 'Deepwork Started');
    assert.ok(kickoffCall.message.includes('=== RUN ID ==='), 'Kickoff message should contain === RUN ID ===');

    // Verify directories were created
    const runIdMatch = kickoffCall.message.match(/=== RUN ID ===\n(qrspi-\d{8}-\d{6})/);
    assert.ok(runIdMatch, 'Could not extract runId');
    const runId = runIdMatch[1];
    const pipelineDir = path.join(tempDir, '.pipeline', runId);
    assert.ok(fs.existsSync(pipelineDir), `Pipeline directory ${pipelineDir} should exist`);
    const statePath = path.join(pipelineDir, 'state.md');
    assert.ok(fs.existsSync(statePath), 'state.md should exist');
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork handler — empty task, user declines
// ══════════════════════════════════════════════════════════

test('/deepwork with empty task and user declines returns abort message', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx({ confirmReturn: [false] });

    await deepworkHandler({ task: '   ' }, ctx);

    // Should have at least one confirm call; check abort message
    assert.ok(ctx._confirmCalls.length >= 1, `Expected at least 1 confirm call, got ${ctx._confirmCalls.length}`);
    const abortCall = ctx._confirmCalls[ctx._confirmCalls.length - 1];
    assert.ok(
      abortCall.message.toLowerCase().includes('aborted'),
      `Abort message should contain "aborted", got: ${abortCall.message}`
    );

    // Check that no pipeline directory with qrspi-* was created
    if (fs.existsSync(path.join(tempDir, '.pipeline'))) {
      const pipelineContents = fs.readdirSync(path.join(tempDir, '.pipeline'));
      const runDirs = pipelineContents.filter(e => e.startsWith('qrspi-'));
      assert.equal(runDirs.length, 0, 'No qrspi run directories should be created on abort');
    }
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork handler — task missing key (not a string)
// ══════════════════════════════════════════════════════════

test('/deepwork with non-string task and user declines returns abort message', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx({ confirmReturn: [false] });

    await deepworkHandler({ task: 123 }, ctx);

    const abortCall = ctx._confirmCalls[ctx._confirmCalls.length - 1];
    assert.ok(
      abortCall.message.toLowerCase().includes('aborted'),
      `Abort message should contain "aborted", got: ${abortCall.message}`
    );
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — valid run ID
// ══════════════════════════════════════════════════════════

test('/deepwork-resume with valid run ID returns resume message', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const runId = 'qrspi-20260515-143022';
    const pipelineDir = path.join(tempDir, '.pipeline', runId, 'telemetry');
    fs.mkdirSync(pipelineDir, { recursive: true });
    const statePath = path.join(tempDir, '.pipeline', runId, 'state.md');
    fs.writeFileSync(statePath, [
      '---',
      'run_id: qrspi-20260515-143022',
      'route: "full"',
      'current_phase: 1',
      'total_phases: 0',
      'last_completed_stage: "3"',
      'next_stage: "4"',
      'stages_completed: []',
      'phase_history: []',
      'backward_loops: 0',
      'resume_source: "resume"',
      '---',
    ].join('\n'), 'utf-8');

    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': runId }, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(message.includes('=== RESUME RUN ID ==='), 'Message should contain === RESUME RUN ID ===');
    assert.ok(message.includes(runId), `Message should contain run ID ${runId}`);
    assert.ok(message.includes('=== RESUME FROM STAGE ==='), 'Message should contain === RESUME FROM STAGE ===');
    assert.ok(message.includes('Stage 4'), 'Message should contain Stage 4 (next_stage)');
    assert.ok(message.includes('last completed: Stage 3'), 'Message should mention last completed: Stage 3');
    assert.ok(message.includes('=== ROUTE ==='), 'Message should contain === ROUTE ===');
    assert.ok(message.includes('full'), 'Message should contain route "full"');
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — missing run ID
// ══════════════════════════════════════════════════════════

test('/deepwork-resume with nonexistent run ID returns not found error', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': 'qrspi-nonexistent' }, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(
      message.toLowerCase().includes('not found'),
      `Error message should contain "not found", got: ${message}`
    );
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — corrupted state file
// ══════════════════════════════════════════════════════════

test('/deepwork-resume with malformed state.md returns corrupted error', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const runId = 'qrspi-20260515-143099';
    const pipelineDir = path.join(tempDir, '.pipeline', runId);
    fs.mkdirSync(pipelineDir, { recursive: true });
    const statePath = path.join(pipelineDir, 'state.md');
    // Write malformed content — not parseable by parseStateYaml
    fs.writeFileSync(statePath, 'this is not yaml\njust random text\nno frontmatter here\n', 'utf-8');

    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': runId }, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(
      message.toLowerCase().includes('corrupted'),
      `Error message should contain "corrupted", got: ${message}`
    );
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — empty run-id
// ══════════════════════════════════════════════════════════

test('/deepwork-resume with empty run-id returns No run ID provided', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': '   ' }, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(
      message.includes('No run ID provided'),
      `Error message should say "No run ID provided", got: ${message}`
    );
  });
});

test('/deepwork-resume with missing run-id key returns No run ID provided', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx();
    await resumeHandler({}, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(
      message.includes('No run ID provided'),
      `Error message should say "No run ID provided", got: ${message}`
    );
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — null run-id
// ══════════════════════════════════════════════════════════

test('/deepwork-resume with null run-id returns No run ID provided', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': null }, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(
      message.includes('No run ID provided'),
      `Error message should say "No run ID provided", got: ${message}`
    );
  });
});

// ══════════════════════════════════════════════════════════
// Git unavailable — pipeline continues with warning
// ══════════════════════════════════════════════════════════

test('/deepwork continues with warning when git is not available', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const restoreSpawnSync = mockGitSpawnSync({ versionStatus: 1 });
    const warnCapture = captureConsoleWarn();

    try {
      const ctx = makeMockCtx();
      await deepworkHandler({ task: 'Test without git' }, ctx);

      // Check for console.warn about git not found
      const gitWarnings = warnCapture.logs.filter(l =>
        l.includes('git not found') || l.includes('without git')
      );
      assert.ok(gitWarnings.length >= 1, `Expected console.warn about git not found, got warnings: ${JSON.stringify(warnCapture.logs)}`);

      // Pipeline should still proceed
      const kickoffMsg = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
      assert.ok(kickoffMsg.includes('=== RUN ID ==='), 'Kickoff message should still be emitted');

      const runIdMatch = kickoffMsg.match(/=== RUN ID ===\n(qrspi-\d{8}-\d{6})/);
      assert.ok(runIdMatch, 'Run ID should be in the kickoff message even without git');
      const runId = runIdMatch[1];

      const pipelineDir = path.join(tempDir, '.pipeline', runId);
      assert.ok(fs.existsSync(pipelineDir), 'Pipeline directory should exist even without git');
      assert.ok(fs.existsSync(path.join(pipelineDir, 'state.md')), 'state.md should exist');
      assert.ok(fs.existsSync(path.join(pipelineDir, 'telemetry', 'events.jsonl')), 'events.jsonl should exist');
    } finally {
      restoreSpawnSync();
      warnCapture.restore();
    }
  });
});

// ══════════════════════════════════════════════════════════
// Git available but branch creation fails — pipeline continues
// ══════════════════════════════════════════════════════════

test('/deepwork continues with warning when git branch creation fails', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const restoreSpawnSync = mockGitSpawnSync({
      versionStatus: 0,        // git is available
      checkoutStatus: 128,     // branch creation fails
      checkoutError: "fatal: A branch named 'qrspi/test' already exists.",
    });
    const warnCapture = captureConsoleWarn();

    try {
      const ctx = makeMockCtx();
      await deepworkHandler({ task: 'Test git branch failure' }, ctx);

      // Check for console.warn about git error
      const gitWarnings = warnCapture.logs.filter(l =>
        l.includes('Failed to create git branch') || l.includes('qrspi/')
      );
      assert.ok(gitWarnings.length >= 1, `Expected console.warn about git branch failure, got: ${JSON.stringify(warnCapture.logs)}`);

      // Pipeline should still proceed
      const kickoffMsg = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
      assert.ok(kickoffMsg.includes('=== RUN ID ==='), 'Kickoff message should still be emitted');

      const runIdMatch = kickoffMsg.match(/=== RUN ID ===\n(qrspi-\d{8}-\d{6})/);
      assert.ok(runIdMatch);
      const runId = runIdMatch[1];

      const pipelineDir = path.join(tempDir, '.pipeline', runId);
      assert.ok(fs.existsSync(pipelineDir), 'Pipeline directory should exist even when branch creation fails');
      assert.ok(fs.existsSync(path.join(pipelineDir, 'state.md')), 'state.md should exist');
      assert.ok(fs.existsSync(path.join(pipelineDir, 'telemetry', 'events.jsonl')), 'events.jsonl should exist');
    } finally {
      restoreSpawnSync();
      warnCapture.restore();
    }
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — unreadable state.md (EISDIR)
// ══════════════════════════════════════════════════════════

test('/deepwork-resume with state.md being a directory returns corrupted error', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const runId = 'qrspi-20260515-143100';
    const pipelineDir = path.join(tempDir, '.pipeline', runId);
    fs.mkdirSync(pipelineDir, { recursive: true });
    // Create state.md as a directory — readFileSync will throw EISDIR
    const statePath = path.join(pipelineDir, 'state.md');
    fs.mkdirSync(statePath);

    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': runId }, ctx);

    assert.ok(ctx._confirmCalls.length >= 1, 'Expected at least one confirm call');
    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(
      message.toLowerCase().includes('corrupted'),
      `Error message should contain "corrupted", got: ${message}`
    );
  });
});

// ══════════════════════════════════════════════════════════
// /deepwork-resume handler — valid run ID with different stage values
// ══════════════════════════════════════════════════════════

test('/deepwork-resume message format includes last_completed_stage and next_stage', async () => {
  const { resumeHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const runId = 'qrspi-20260601-120000';
    const pipelineDir = path.join(tempDir, '.pipeline', runId, 'telemetry');
    fs.mkdirSync(pipelineDir, { recursive: true });
    const statePath = path.join(tempDir, '.pipeline', runId, 'state.md');
    fs.writeFileSync(statePath, [
      '---',
      'run_id: qrspi-20260601-120000',
      'route: "quick-fix"',
      'current_phase: 2',
      'total_phases: 3',
      'last_completed_stage: "7"',
      'next_stage: "8"',
      'stages_completed: []',
      'phase_history: []',
      'backward_loops: 1',
      'resume_source: "resume"',
      '---',
    ].join('\n'), 'utf-8');

    const ctx = makeMockCtx();
    await resumeHandler({ 'run-id': runId }, ctx);

    const message = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    assert.ok(message.includes('=== RESUME RUN ID ==='), 'Should contain === RESUME RUN ID ===');
    assert.ok(message.includes(runId), 'Should contain the run ID');
    assert.ok(message.includes('Stage 8'), 'Should mention next_stage Stage 8');
    assert.ok(message.includes('last completed: Stage 7'), 'Should mention last_completed_stage Stage 7');
    assert.ok(message.includes('=== ROUTE ==='), 'Should contain === ROUTE ===');
    assert.ok(message.includes('quick-fix'), 'Should contain the route quick-fix');
  });
});

// ══════════════════════════════════════════════════════════
// activate() does not throw
// ══════════════════════════════════════════════════════════

test('activate does not throw with a valid ExtensionAPI mock', () => {
  sharedTools._pi = null;
  const mockPi = makeMockPi();
  assert.doesNotThrow(() => activate(mockPi));
});

// ══════════════════════════════════════════════════════════
// /deepwork handler — verify state.md field completeness
// ══════════════════════════════════════════════════════════

test('/deepwork state.md contains all expected YAML fields', async () => {
  const { deepworkHandler } = setupHandlers();

  await withTempDir(async (tempDir) => {
    const ctx = makeMockCtx();
    await deepworkHandler({ task: 'Verify state fields' }, ctx);

    const kickoffMsg = ctx._confirmCalls[ctx._confirmCalls.length - 1].message;
    const runIdMatch = kickoffMsg.match(/=== RUN ID ===\n(qrspi-\d{8}-\d{6})/);
    const runId = runIdMatch[1];

    const stateContent = fs.readFileSync(
      path.join(tempDir, '.pipeline', runId, 'state.md'), 'utf-8'
    );

    assert.ok(stateContent.includes(`run_id: ${runId}`), 'state.md should contain run_id');
    assert.ok(stateContent.includes('route:'), 'state.md should contain route');
    assert.ok(stateContent.includes('current_phase:'), 'state.md should contain current_phase');
    assert.ok(stateContent.includes('total_phases:'), 'state.md should contain total_phases');
    assert.ok(stateContent.includes('last_completed_stage:'), 'state.md should contain last_completed_stage');
    assert.ok(stateContent.includes('next_stage:'), 'state.md should contain next_stage');
    assert.ok(stateContent.includes('stages_completed:'), 'state.md should contain stages_completed');
    assert.ok(stateContent.includes('phase_history:'), 'state.md should contain phase_history');
    assert.ok(stateContent.includes('backward_loops:'), 'state.md should contain backward_loops');
    assert.ok(stateContent.includes('resume_source:'), 'state.md should contain resume_source');
    assert.ok(stateContent.includes('resume_source: "fresh"'), 'state.md should have resume_source: "fresh"');
  });
});
