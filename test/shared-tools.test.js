const test = require('node:test');
const assert = require('node:assert/strict');

// Import the full module object so we can mutate _pi
const sharedTools = require('../dist/shared-tools');
const { createDispatchTool, createGetSubagentResultTool } = sharedTools;

const MANAGER_SYMBOL = Symbol.for('pi-subagents:manager');

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

/** Build a minimal mock ExtensionContext with overridable UI. */
function makeMockCtx(overrides = {}) {
  return {
    hasUI: true,
    ui: {
      confirm: async () => true,
      select: async () => 'A',
    },
    ...overrides,
  };
}

/** Reset module-level _pi and remove any registered manager symbol. */
function resetGlobalState() {
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
}

// ──────────────────────────────────────────────────────────
// createDispatchTool — shape and factory
// ──────────────────────────────────────────────────────────

test('createDispatchTool returns a ToolDefinition with name "qrspi_dispatch"', () => {
  const tool = createDispatchTool();
  assert.equal(tool.name, 'qrspi_dispatch');
});

test('createDispatchTool returns a ToolDefinition with a parameters JSON Schema', () => {
  const tool = createDispatchTool();
  assert.equal(tool.parameters.type, 'object');
  assert.ok(Array.isArray(tool.parameters.required));
  assert.ok(tool.parameters.required.includes('subagent_type'));
  assert.ok(tool.parameters.required.includes('prompt'));
  assert.ok(tool.parameters.required.includes('description'));
  const props = tool.parameters.properties;
  assert.equal(props.subagent_type.type, 'string');
  assert.equal(props.prompt.type, 'string');
  assert.equal(props.description.type, 'string');
  assert.equal(props.run_in_background.type, 'boolean');
  assert.deepEqual(props.thinking.enum, [
    'off',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ]);
  assert.equal(props.max_turns.type, 'number');
  assert.equal(props.model.type, 'string');
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — parameter validation
// ──────────────────────────────────────────────────────────

test('dispatch: non-object params returns FAIL', async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    'not-an-object',
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('Invalid parameters'));
});

test('dispatch: missing subagent_type returns FAIL', async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { prompt: 'p', description: 'd' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('subagent_type'));
});

test('dispatch: missing prompt returns FAIL', async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { subagent_type: 't', description: 'd' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('prompt'));
});

test('dispatch: missing description returns FAIL', async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { subagent_type: 't', prompt: 'p' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('description'));
});

test('dispatch: empty string subagent_type returns FAIL', async () => {
  resetGlobalState();
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { subagent_type: '  ', prompt: 'p', description: 'd' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('subagent_type'));
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — missing pi-subagents
// ──────────────────────────────────────────────────────────

test('dispatch: missing pi-subagents manager returns FAIL with install message', async () => {
  resetGlobalState();
  // Set _pi so we bypass the "not activated" guard
  sharedTools._pi = { api: 'fake' };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { subagent_type: 't', prompt: 'p', description: 'd' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('@tintinweb/pi-subagents'));
  sharedTools._pi = null;
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — extension not activated
// ──────────────────────────────────────────────────────────

test('dispatch: foreground with _pi null returns "Extension not activated"', async () => {
  resetGlobalState();
  // Register a mock manager but leave _pi null
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async () => ({
      agentId: 'a',
      status: 'completed',
      startedAt: new Date().toISOString(),
    }),
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { subagent_type: 't', prompt: 'p', description: 'd' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('Extension not activated'));
  delete globalThis[MANAGER_SYMBOL];
});

test('dispatch: background with _pi null returns "Extension not activated"', async () => {
  resetGlobalState();
  // Register mock manager but leave _pi null
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => 'agent-123',
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
      run_in_background: true,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('Extension not activated'));
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — background dispatch success
// ──────────────────────────────────────────────────────────

test('dispatch: background mode returns RUNNING and marks the spawn as background', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  const record = {
    id: 'agent-background-1',
    status: 'running',
    startedAt: Date.now(),
    promise: Promise.resolve('done'),
  };
  let receivedOptions = null;
  globalThis[MANAGER_SYMBOL] = {
    spawn: (_pi, _ctx, _type, _prompt, options) => {
      receivedOptions = options;
      return record.id;
    },
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 'qrspi-goals-synthesizer',
      prompt: 'do work',
      description: 'background test',
      run_in_background: true,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — RUNNING'));
  assert.ok(result.content.includes(record.id));
  assert.ok(result.content.includes('qrspi_get_subagent_result'));
  assert.equal(receivedOptions.isBackground, true);
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — foreground dispatch success
// ──────────────────────────────────────────────────────────

test('dispatch: foreground success returns PASS with agent ID and result', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  const record = {
    id: 'agent-fg-1',
    status: 'completed',
    result: 'All tasks done',
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve('All tasks done'),
  };
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => record.id,
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 'qrspi-goals-synthesizer',
      prompt: 'do work',
      description: 'foreground test',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — PASS'));
  assert.ok(result.content.includes('agent-fg-1'));
  assert.ok(result.content.includes('All tasks done'));
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — foreground dispatch failure
// ──────────────────────────────────────────────────────────

test('dispatch: foreground subagent failed returns FAIL with error', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  const record = {
    id: 'agent-failed-1',
    status: 'error',
    error: 'Task crashed',
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve(''),
  };
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => record.id,
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 'qrspi-goals-synthesizer',
      prompt: 'do work',
      description: 'failure test',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('agent-failed-1'));
  assert.ok(result.content.includes('Task crashed'));
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — module-level _pi capture
// ──────────────────────────────────────────────────────────

test('dispatch: _pi set before createDispatchTool is used by execute', async () => {
  resetGlobalState();
  sharedTools._pi = { customApiField: 42 };
  const record = {
    id: 'a',
    status: 'completed',
    result: 'ok',
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve('ok'),
  };
  globalThis[MANAGER_SYMBOL] = {
    spawn: (pi) => {
      // Verify that the pi passed to manager is the same as our _pi
      assert.strictEqual(pi, sharedTools._pi);
      return record.id;
    },
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — PASS'));
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool: background does not block
// ──────────────────────────────────────────────────────────

test('dispatch: background mode calls spawn when background support is enabled', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  let spawnCalled = false;
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => {
      spawnCalled = true;
      return 'agent-bg-no-wait';
    },
    getRecord: () => undefined,
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
      run_in_background: true,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — RUNNING'));
  assert.equal(
    spawnCalled,
    true,
    'spawn should be called for background dispatch',
  );
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

test('createGetSubagentResultTool returns a ToolDefinition with name "qrspi_get_subagent_result"', () => {
  const tool = createGetSubagentResultTool();
  assert.equal(tool.name, 'qrspi_get_subagent_result');
});

test('get subagent result: running record without wait returns RUNNING', async () => {
  resetGlobalState();
  const record = {
    id: 'agent-running-1',
    status: 'running',
    startedAt: Date.now(),
    promise: Promise.resolve('done'),
  };
  globalThis[MANAGER_SYMBOL] = {
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => true,
    waitForAll: async () => {},
  };
  const tool = createGetSubagentResultTool();
  const result = await tool.execute(
    'id',
    { agent_id: record.id },
    new AbortController().signal,
    () => {},
    makeMockCtx(),
  );
  assert.ok(result.content.includes('### Status — RUNNING'));
  assert.ok(result.content.includes(record.id));
  delete globalThis[MANAGER_SYMBOL];
});

test('get subagent result: wait true joins a running background task', async () => {
  resetGlobalState();
  const record = {
    id: 'agent-running-2',
    status: 'running',
    startedAt: Date.now(),
    promise: Promise.resolve('done'),
  };
  const finalRecord = {
    id: record.id,
    status: 'completed',
    result: 'Background complete',
    startedAt: record.startedAt,
    completedAt: Date.now(),
    promise: record.promise,
  };
  let phase = 'running';
  globalThis[MANAGER_SYMBOL] = {
    getRecord: (id) => {
      if (id !== record.id) return undefined;
      return phase === 'running' ? record : finalRecord;
    },
    hasRunning: () => phase === 'running',
    waitForAll: async () => {
      phase = 'completed';
    },
  };
  const tool = createGetSubagentResultTool();
  const result = await tool.execute(
    'id',
    { agent_id: record.id, wait: true },
    new AbortController().signal,
    () => {},
    makeMockCtx(),
  );
  assert.ok(result.content.includes('### Status — PASS'));
  assert.ok(result.content.includes('Background complete'));
  assert.equal(record.resultConsumed, true);
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool: spawn model/thinking/max_turns passed to manager
// ──────────────────────────────────────────────────────────

test('dispatch: foreground resolves model override and uses camelCase options', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  const fakeModel = { id: 'anthropic/claude-sonnet-4-5' };
  const record = {
    id: 'a',
    status: 'completed',
    result: 'ok',
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve('ok'),
  };
  let receivedOptions = null;
  globalThis[MANAGER_SYMBOL] = {
    spawn: (_pi, _ctx, _type, _prompt, options) => {
      receivedOptions = options;
      return record.id;
    },
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx({
    modelRegistry: {
      find: (query) =>
        query === 'anthropic/claude-sonnet-4-5' ? fakeModel : undefined,
      getAll: () => [],
      getAvailable: () => [],
    },
  });
  await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
      model: 'anthropic/claude-sonnet-4-5',
      thinking: 'high',
      max_turns: 40,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.equal(receivedOptions.model, fakeModel);
  assert.equal(receivedOptions.thinkingLevel, 'high');
  assert.equal(receivedOptions.maxTurns, 40);
  assert.equal(receivedOptions.description, 'd');
  assert.equal('thinking' in receivedOptions, false);
  assert.equal('max_turns' in receivedOptions, false);
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

test('dispatch: model override without modelRegistry fails before spawn', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  let spawnCalled = false;
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => {
      spawnCalled = true;
      return 'agent-bg-2';
    },
    getRecord: () => undefined,
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx({ modelRegistry: undefined });
  const result = await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
      model: 'anthropic/claude-sonnet-4-5',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('modelRegistry'));
  assert.equal(spawnCalled, false);
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool: spawn options with undefined keys omitted
// ──────────────────────────────────────────────────────────

test('dispatch: undefined model and thinking are omitted from spawn options', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  const record = {
    id: 'a',
    status: 'completed',
    result: 'ok',
    startedAt: Date.now(),
    completedAt: Date.now(),
    promise: Promise.resolve('ok'),
  };
  let receivedOptions = null;
  globalThis[MANAGER_SYMBOL] = {
    spawn: (_pi, _ctx, _type, _prompt, options) => {
      receivedOptions = options;
      return record.id;
    },
    getRecord: (id) => (id === record.id ? record : undefined),
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.equal(receivedOptions.model, undefined);
  assert.equal(receivedOptions.thinkingLevel, undefined);
  assert.equal(receivedOptions.maxTurns, undefined);
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — spawn() throws in background
// ──────────────────────────────────────────────────────────

test('dispatch: background spawn throws returns FAIL with dispatch failed', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => {
      throw new Error('spawn explosion');
    },
    getRecord: () => undefined,
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
      run_in_background: true,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('dispatch failed:'));
  assert.ok(result.content.includes('spawn explosion'));
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — spawnAndWait() throws in foreground
// ──────────────────────────────────────────────────────────

test('dispatch: foreground spawn throws returns FAIL with dispatch failed', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => {
      throw new Error('spawn explosion');
    },
    getRecord: () => undefined,
    hasRunning: () => false,
    waitForAll: async () => {},
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('dispatch failed:'));
  assert.ok(result.content.includes('spawn explosion'));
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});
