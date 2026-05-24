const test = require('node:test');
const assert = require('node:assert/strict');

// Import the full module object so we can mutate _pi
const sharedTools = require('../dist/shared-tools');
const { createDispatchTool, createQuestionTool } = sharedTools;

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
  assert.deepEqual(props.thinking.enum, ['low', 'medium', 'high']);
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

test('dispatch: background mode returns RUNNING with agent ID', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => 'agent-background-1',
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
  assert.ok(result.content.includes('agent-background-1'));
  assert.ok(result.content.includes('Subagent dispatched in background'));
  assert.equal(result.details.status, 'running');
  assert.equal(result.details.agentId, 'agent-background-1');
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool — foreground dispatch success
// ──────────────────────────────────────────────────────────

test('dispatch: foreground success returns PASS with agent ID and result', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async () => ({
      agentId: 'agent-fg-1',
      status: 'completed',
      result: 'All tasks done',
      startedAt: new Date().toISOString(),
    }),
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
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async () => ({
      agentId: 'agent-failed-1',
      status: 'failed',
      error: 'Task crashed',
      startedAt: new Date().toISOString(),
    }),
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
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async (pi) => {
      // Verify that the pi passed to manager is the same as our _pi
      assert.strictEqual(pi, sharedTools._pi);
      return {
        agentId: 'a',
        status: 'completed',
        result: 'ok',
        startedAt: new Date().toISOString(),
      };
    },
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

// ══════════════════════════════════════════════════════════
// createQuestionTool — shape and factory
// ══════════════════════════════════════════════════════════

test('createQuestionTool returns a ToolDefinition with name "qrspi_question"', () => {
  const tool = createQuestionTool();
  assert.equal(tool.name, 'qrspi_question');
});

test('createQuestionTool returns a ToolDefinition with a parameters JSON Schema', () => {
  const tool = createQuestionTool();
  assert.equal(tool.parameters.type, 'object');
  assert.ok(Array.isArray(tool.parameters.required));
  assert.ok(tool.parameters.required.includes('header'));
  assert.ok(tool.parameters.required.includes('message'));
  assert.ok(tool.parameters.required.includes('options'));
  assert.ok(tool.parameters.required.includes('type'));
  const props = tool.parameters.properties;
  assert.equal(props.header.type, 'string');
  assert.equal(props.message.type, 'string');
  assert.equal(props.options.type, 'array');
  assert.equal(props.type.type, 'string');
  assert.deepEqual(props.type.enum, ['confirm', 'select']);
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — parameter validation
// ──────────────────────────────────────────────────────────

test('question: non-object params returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    null,
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('Invalid parameters'));
});

test('question: missing header returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { message: 'm', options: ['A'], type: 'confirm' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('header'));
});

test('question: missing message returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: 'h', options: ['A'], type: 'confirm' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('message'));
});

test('question: missing options returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: 'h', message: 'm', type: 'confirm' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('options'));
});

test('question: empty options array returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: 'h', message: 'm', options: [], type: 'confirm' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('options'));
});

test('question: invalid type returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: 'h', message: 'm', options: ['A'], type: 'bogus' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('Invalid type'));
});

test('question: missing type returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: 'h', message: 'm', options: ['A'] },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('Invalid type'));
});

test('question: empty string header returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: '  ', message: 'm', options: ['A'], type: 'confirm' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('header'));
});

test('question: empty string message returns error', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx();
  const result = await tool.execute(
    'id',
    { header: 'h', message: '  ', options: ['A'], type: 'confirm' },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('Error'));
  assert.ok(result.content.includes('message'));
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — confirm: affirmative
// ──────────────────────────────────────────────────────────

test('question: confirm affirmative returns "User confirmed: Yes"', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: { confirm: async () => true },
  });
  const result = await tool.execute(
    'id',
    {
      header: 'Proceed?',
      message: 'Continue?',
      options: ['Yes', 'No'],
      type: 'confirm',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('User confirmed: Yes'));
  assert.equal(result.details.answer, 'Yes');
  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.uiUnavailable, false);
  assert.equal(result.details.type, 'confirm');
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — confirm: negative / cancelled
// ──────────────────────────────────────────────────────────

test('question: confirm negative returns "User confirmed: No" with cancelled true', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: { confirm: async () => false },
  });
  const result = await tool.execute(
    'id',
    {
      header: 'Proceed?',
      message: 'Continue?',
      options: ['Yes', 'No'],
      type: 'confirm',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('User confirmed: No'));
  assert.equal(result.details.answer, 'No');
  assert.equal(result.details.cancelled, true);
  assert.equal(result.details.uiUnavailable, false);
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — select: chosen
// ──────────────────────────────────────────────────────────

test('question: select chosen returns "User selected: B" with cancelled false', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: { select: async () => 'B' },
  });
  const result = await tool.execute(
    'id',
    {
      header: 'Pick',
      message: 'Choose',
      options: ['A', 'B', 'C'],
      type: 'select',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('User selected: B'));
  assert.equal(result.details.answer, 'B');
  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.uiUnavailable, false);
  assert.equal(result.details.type, 'select');
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — select: cancelled
// ──────────────────────────────────────────────────────────

test('question: select cancelled returns "User cancelled selection" with cancelled true', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: { select: async () => undefined },
  });
  const result = await tool.execute(
    'id',
    {
      header: 'Pick',
      message: 'Choose',
      options: ['A', 'B', 'C'],
      type: 'select',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('User cancelled selection'));
  assert.equal(result.details.answer, '');
  assert.equal(result.details.cancelled, true);
  assert.equal(result.details.uiUnavailable, false);
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — no UI available
// ──────────────────────────────────────────────────────────

test('question: no UI — confirm defaults to "Yes" with uiUnavailable true', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({ hasUI: false });
  const result = await tool.execute(
    'id',
    {
      header: 'Proceed?',
      message: 'Continue?',
      options: ['Yes', 'No'],
      type: 'confirm',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('User confirmed: Yes'));
  assert.equal(result.details.answer, 'Yes');
  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.uiUnavailable, true);
  assert.equal(result.details.type, 'confirm');
});

test('question: no UI — select defaults to first option with uiUnavailable true', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({ hasUI: false });
  const result = await tool.execute(
    'id',
    {
      header: 'Pick',
      message: 'Choose',
      options: ['First', 'Second', 'Third'],
      type: 'select',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('User selected: First'));
  assert.equal(result.details.answer, 'First');
  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.uiUnavailable, true);
  assert.equal(result.details.type, 'select');
});

// ──────────────────────────────────────────────────────────
// createDispatchTool: background does not block
// ──────────────────────────────────────────────────────────

test('dispatch: background mode does not call spawnAndWait', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  let spawnAndWaitCalled = false;
  globalThis[MANAGER_SYMBOL] = {
    spawn: () => 'agent-bg-no-wait',
    spawnAndWait: async () => {
      spawnAndWaitCalled = true;
      return {};
    },
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
    spawnAndWaitCalled,
    false,
    'spawnAndWait should not be called for background dispatch',
  );
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool: spawn model/thinking/max_turns passed to manager
// ──────────────────────────────────────────────────────────

test('dispatch: foreground passes model option to spawnAndWait', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  let receivedOptions = null;
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async (_pi, _ctx, _type, _prompt, options) => {
      receivedOptions = options;
      return {
        agentId: 'a',
        status: 'completed',
        result: 'ok',
        startedAt: new Date().toISOString(),
      };
    },
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
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
  assert.equal(receivedOptions.model, 'anthropic/claude-sonnet-4-5');
  assert.equal(receivedOptions.thinking, 'high');
  assert.equal(receivedOptions.max_turns, 40);
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

test('dispatch: background passes model option to spawn', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  let receivedOptions = null;
  globalThis[MANAGER_SYMBOL] = {
    spawn: (_pi, _ctx, _type, _prompt, options) => {
      receivedOptions = options;
      return 'agent-bg-2';
    },
  };
  const tool = createDispatchTool();
  const ctx = makeMockCtx();
  await tool.execute(
    'id',
    {
      subagent_type: 't',
      prompt: 'p',
      description: 'd',
      run_in_background: true,
      model: 'anthropic/claude-sonnet-4-5',
      thinking: 'medium',
      max_turns: 20,
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.equal(receivedOptions.model, 'anthropic/claude-sonnet-4-5');
  assert.equal(receivedOptions.thinking, 'medium');
  assert.equal(receivedOptions.max_turns, 20);
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createDispatchTool: spawn options with undefined keys omitted
// ──────────────────────────────────────────────────────────

test('dispatch: undefined model and thinking are omitted from spawn options', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  let receivedOptions = null;
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async (_pi, _ctx, _type, _prompt, options) => {
      receivedOptions = options;
      return {
        agentId: 'a',
        status: 'completed',
        result: 'ok',
        startedAt: new Date().toISOString(),
      };
    },
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
  assert.equal(receivedOptions.thinking, undefined);
  assert.equal(receivedOptions.max_turns, undefined);
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

test('dispatch: foreground spawnAndWait throws returns FAIL with dispatch failed', async () => {
  resetGlobalState();
  sharedTools._pi = { api: 'fake' };
  globalThis[MANAGER_SYMBOL] = {
    spawnAndWait: async () => {
      throw new Error('spawnAndWait explosion');
    },
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
  assert.ok(result.content.includes('spawnAndWait explosion'));
  sharedTools._pi = null;
  delete globalThis[MANAGER_SYMBOL];
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — confirm() throws
// ──────────────────────────────────────────────────────────

test('question: confirm throws returns FAIL with uiUnavailable true', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: {
      confirm: async () => {
        throw new Error('confirm crash');
      },
    },
  });
  const result = await tool.execute(
    'id',
    {
      header: 'Proceed?',
      message: 'Continue?',
      options: ['Yes', 'No'],
      type: 'confirm',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('confirm crash'));
  assert.equal(result.details.uiUnavailable, true);
  assert.equal(result.details.cancelled, false);
  assert.equal(result.details.answer, '');
});

// ──────────────────────────────────────────────────────────
// createQuestionTool — select() throws
// ──────────────────────────────────────────────────────────

test('question: select throws returns FAIL with cancelled true', async () => {
  const tool = createQuestionTool();
  const ctx = makeMockCtx({
    ui: {
      select: async () => {
        throw new Error('select crash');
      },
    },
  });
  const result = await tool.execute(
    'id',
    {
      header: 'Pick',
      message: 'Choose',
      options: ['First', 'Second', 'Third'],
      type: 'select',
    },
    new AbortController().signal,
    () => {},
    ctx,
  );
  assert.ok(result.content.includes('### Status — FAIL'));
  assert.ok(result.content.includes('select crash'));
  assert.equal(result.details.uiUnavailable, true);
  assert.equal(result.details.cancelled, true);
  assert.equal(result.details.answer, '');
});
