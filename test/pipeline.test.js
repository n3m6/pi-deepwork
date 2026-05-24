const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDryRunArtifactPaths,
  generateRunId,
  getPipelineDir,
  getGitBranch,
  getRouteStages,
  getStatePath,
  getTelemetryDir,
  getEventsPath,
  getRunLogPath,
  getMetricsPath,
  getPipelinePaths,
  makeInitialState,
  makeTelemetryEvent,
  createRunLogEntry,
  STAGE_NAMES,
  stageNumber,
  nextStage,
} = require('../dist/pipeline');

const testRunId = 'qrspi-20260523-143022';

// ---------------------------------------------------------------------------
// generateRunId
// ---------------------------------------------------------------------------

test('generateRunId returns a string matching qrspi-YYYYMMDD-HHMMSS format', () => {
  const id = generateRunId();
  assert.ok(
    /^qrspi-\d{8}-\d{6}$/.test(id),
    `Expected format qrspi-YYYYMMDD-HHMMSS, got: ${id}`,
  );
});

test('generateRunId date portion is current UTC date', () => {
  const id = generateRunId();
  const match = id.match(/^qrspi-(\d{8})-(\d{6})$/);
  const dateStr = match[1];
  const now = new Date();
  const expectedDate = [
    now.getUTCFullYear().toString(),
    (now.getUTCMonth() + 1).toString().padStart(2, '0'),
    now.getUTCDate().toString().padStart(2, '0'),
  ].join('');
  assert.equal(dateStr, expectedDate);
});

test('generateRunId time portion matches current UTC time within 1 second tolerance', () => {
  const id = generateRunId();
  const match = id.match(/^qrspi-(\d{8})-(\d{6})$/);
  const timeStr = match[2];
  const hh = parseInt(timeStr.substring(0, 2), 10);
  const mm = parseInt(timeStr.substring(2, 4), 10);
  const ss = parseInt(timeStr.substring(4, 6), 10);
  const idSecs = hh * 3600 + mm * 60 + ss;

  const now = new Date();
  const actualSecs =
    now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();

  const diff = Math.abs(idSecs - actualSecs);
  assert.ok(
    diff <= 1,
    `Time diff ${diff}s exceeds 1 second tolerance; id time: ${timeStr}, actual UTC: ${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`,
  );
});

test('generateRunId called twice in same second returns identical values', () => {
  const id1 = generateRunId();
  const id2 = generateRunId();
  assert.equal(id1, id2);
});

// ---------------------------------------------------------------------------
// getPipelineDir
// ---------------------------------------------------------------------------

test('getPipelineDir returns .pipeline/<runId>', () => {
  assert.equal(getPipelineDir(testRunId), '.pipeline/qrspi-20260523-143022');
});

// ---------------------------------------------------------------------------
// getGitBranch
// ---------------------------------------------------------------------------

test('getGitBranch returns qrspi/<runId>', () => {
  assert.equal(getGitBranch(testRunId), 'qrspi/qrspi-20260523-143022');
});

// ---------------------------------------------------------------------------
// Path helpers — individual
// ---------------------------------------------------------------------------

test('getStatePath returns <pipelineDir>/state.md', () => {
  assert.equal(
    getStatePath(testRunId),
    '.pipeline/qrspi-20260523-143022/state.md',
  );
});

test('getTelemetryDir returns <pipelineDir>/telemetry', () => {
  assert.equal(
    getTelemetryDir(testRunId),
    '.pipeline/qrspi-20260523-143022/telemetry',
  );
});

test('getEventsPath returns <telemetryDir>/events.jsonl', () => {
  assert.equal(
    getEventsPath(testRunId),
    '.pipeline/qrspi-20260523-143022/telemetry/events.jsonl',
  );
});

test('getRunLogPath returns <telemetryDir>/run-log.md', () => {
  assert.equal(
    getRunLogPath(testRunId),
    '.pipeline/qrspi-20260523-143022/telemetry/run-log.md',
  );
});

test('getMetricsPath returns <telemetryDir>/metrics-summary.md', () => {
  assert.equal(
    getMetricsPath(testRunId),
    '.pipeline/qrspi-20260523-143022/telemetry/metrics-summary.md',
  );
});

// ---------------------------------------------------------------------------
// Path helper consistency
// ---------------------------------------------------------------------------

test('all individual paths are under getPipelineDir', () => {
  const base = getPipelineDir(testRunId);
  assert.ok(getStatePath(testRunId).startsWith(base));
  assert.ok(getTelemetryDir(testRunId).startsWith(base));
  assert.ok(getEventsPath(testRunId).startsWith(base));
  assert.ok(getRunLogPath(testRunId).startsWith(base));
  assert.ok(getMetricsPath(testRunId).startsWith(base));
});

test('getPipelinePaths returns object matching individual path functions', () => {
  const paths = getPipelinePaths(testRunId);
  assert.equal(paths.pipelineDir, getPipelineDir(testRunId));
  assert.equal(paths.gitBranch, getGitBranch(testRunId));
  assert.equal(paths.statePath, getStatePath(testRunId));
  assert.equal(paths.telemetryDir, getTelemetryDir(testRunId));
  assert.equal(paths.eventsPath, getEventsPath(testRunId));
  assert.equal(paths.runLogPath, getRunLogPath(testRunId));
  assert.equal(paths.metricsPath, getMetricsPath(testRunId));
});

test('getPipelinePaths has exactly 7 keys', () => {
  const keys = Object.keys(getPipelinePaths(testRunId)).sort();
  assert.deepEqual(keys, [
    'eventsPath',
    'gitBranch',
    'metricsPath',
    'pipelineDir',
    'runLogPath',
    'statePath',
    'telemetryDir',
  ]);
});

// ---------------------------------------------------------------------------
// makeInitialState
// ---------------------------------------------------------------------------

test('makeInitialState returns object with all 13 required fields', () => {
  const state = makeInitialState(testRunId);
  const expectedFields = [
    'run_id',
    'route',
    'current_phase',
    'total_phases',
    'last_completed_stage',
    'next_stage',
    'stages_completed',
    'phase_history',
    'backward_loops',
    'resume_source',
    'mode',
    'interaction_mode',
    'failure_policy',
  ];
  const keys = Object.keys(state).sort();
  assert.deepEqual(keys, expectedFields.sort());
});

test('makeInitialState run_id matches given runId', () => {
  const state = makeInitialState(testRunId);
  assert.equal(state.run_id, testRunId);
});

test('makeInitialState route is empty string', () => {
  assert.equal(makeInitialState(testRunId).route, '');
});

test('makeInitialState current_phase is 1', () => {
  assert.equal(makeInitialState(testRunId).current_phase, 1);
});

test('makeInitialState total_phases is 0', () => {
  assert.equal(makeInitialState(testRunId).total_phases, 0);
});

test('makeInitialState last_completed_stage is "0"', () => {
  assert.equal(makeInitialState(testRunId).last_completed_stage, '0');
});

test('makeInitialState next_stage is "1"', () => {
  assert.equal(makeInitialState(testRunId).next_stage, '1');
});

test('makeInitialState stages_completed is empty array', () => {
  assert.deepEqual(makeInitialState(testRunId).stages_completed, []);
});

test('makeInitialState phase_history is empty array', () => {
  assert.deepEqual(makeInitialState(testRunId).phase_history, []);
});

test('makeInitialState backward_loops is 0', () => {
  assert.equal(makeInitialState(testRunId).backward_loops, 0);
});

test('makeInitialState resume_source is "fresh"', () => {
  assert.equal(makeInitialState(testRunId).resume_source, 'fresh');
});

test('makeInitialState mode is "live"', () => {
  assert.equal(makeInitialState(testRunId).mode, 'live');
});

// ---------------------------------------------------------------------------
// makeTelemetryEvent — defaults
// ---------------------------------------------------------------------------

test('makeTelemetryEvent returns an object with required fields', () => {
  const event = makeTelemetryEvent(testRunId, 'test.event', {});
  assert.equal(event.schema_version, '1.0');
  assert.equal(event.sequence, 0);
  assert.equal(event.run_id, testRunId);
  assert.equal(event.writer_agent, 'orchestrator');
  assert.equal(event.writer_scope, 'pipeline');
  assert.equal(event.event_type, 'test.event');
  assert.equal(event.status, 'PASS');
  assert.equal(event.route, '');
  assert.equal(event.summary, '');
});

test('makeTelemetryEvent ts is a valid ISO 8601 string', () => {
  const event = makeTelemetryEvent(testRunId, 'test.event', {});
  const parsed = new Date(event.ts);
  assert.ok(!isNaN(parsed.getTime()), `ts is not a valid date: ${event.ts}`);
});

test('makeTelemetryEvent event_id contains runId and eventType', () => {
  const event = makeTelemetryEvent(testRunId, 'test.event', {});
  assert.ok(
    event.event_id.includes(testRunId),
    `event_id should contain run ID, got: ${event.event_id}`,
  );
  assert.ok(
    event.event_id.includes('test.event'),
    `event_id should contain event type, got: ${event.event_id}`,
  );
  assert.ok(event.event_id.length > 0, 'event_id should not be empty');
});

// ---------------------------------------------------------------------------
// makeTelemetryEvent — overrides
// ---------------------------------------------------------------------------

test('makeTelemetryEvent overrides status, stage, and summary', () => {
  const event = makeTelemetryEvent('qrspi-xxx', 'stage.completed', {
    status: 'FAIL',
    stage: 1,
    summary: 'Stage 1 failed',
  });
  assert.equal(event.status, 'FAIL');
  assert.equal(event.stage, 1);
  assert.equal(event.summary, 'Stage 1 failed');
  assert.equal(event.event_type, 'stage.completed');
  assert.equal(event.run_id, 'qrspi-xxx');
  assert.equal(event.schema_version, '1.0');
});

test('makeTelemetryEvent overrides do not affect subsequent calls', () => {
  const ev1 = makeTelemetryEvent(testRunId, 'ev.a', {
    status: 'FAIL',
    summary: 'Bad',
  });
  const ev2 = makeTelemetryEvent(testRunId, 'ev.b', {});
  assert.equal(ev2.status, 'PASS');
  assert.equal(ev2.summary, '');
  assert.equal(ev1.status, 'FAIL');
  assert.equal(ev1.summary, 'Bad');
});

test('makeTelemetryEvent payload override replaces entire payload object', () => {
  const event = makeTelemetryEvent(testRunId, 'test.payload', {
    payload: { context: { key: 'value' }, error: 'something went wrong' },
  });
  assert.deepEqual(event.payload, {
    context: { key: 'value' },
    error: 'something went wrong',
  });
});

test('makeTelemetryEvent optional fields default to undefined', () => {
  const event = makeTelemetryEvent(testRunId, 'test.opt', {});
  assert.equal(event.stage, undefined);
  assert.equal(event.stage_instance, undefined);
  assert.equal(event.phase, undefined);
  assert.equal(event.wave, undefined);
  assert.equal(event.task_id, undefined);
  assert.equal(event.review_round, undefined);
  assert.equal(event.attempt, undefined);
  assert.equal(event.child_agent, undefined);
  assert.equal(event.correlation_id, undefined);
  assert.equal(event.payload, undefined);
});

// ---------------------------------------------------------------------------
// createRunLogEntry
// ---------------------------------------------------------------------------

test('createRunLogEntry formats a bullet line with timestamp, type, status, and summary', () => {
  const entry = createRunLogEntry({
    ts: '2026-05-23T14:30:22.000Z',
    event_type: 'run.started',
    status: 'PASS',
    summary: 'Pipeline initialized',
  });
  assert.equal(
    entry,
    '- [2026-05-23T14:30:22.000Z] run.started — PASS: Pipeline initialized',
  );
});

test('createRunLogEntry handles FAIL status', () => {
  const entry = createRunLogEntry({
    ts: '2026-05-23T14:31:00.000Z',
    event_type: 'stage.failed',
    status: 'FAIL',
    summary: 'Something broke',
  });
  assert.equal(
    entry,
    '- [2026-05-23T14:31:00.000Z] stage.failed — FAIL: Something broke',
  );
});

test('createRunLogEntry handles empty summary', () => {
  const entry = createRunLogEntry({
    ts: '2026-05-23T14:30:22.000Z',
    event_type: 'ping',
    status: 'PASS',
    summary: '',
  });
  assert.equal(entry, '- [2026-05-23T14:30:22.000Z] ping — PASS: ');
});

// ---------------------------------------------------------------------------
// STAGE_NAMES
// ---------------------------------------------------------------------------

test('STAGE_NAMES is an array of 10 stage names in canonical order', () => {
  const expected = [
    'goals',
    'research',
    'design',
    'structure',
    'plan',
    'implement',
    'accept',
    'replan',
    'verify',
    'report',
  ];
  assert.deepEqual(STAGE_NAMES, expected);
  assert.equal(STAGE_NAMES.length, 10);
});

test('getRouteStages("full") returns canonical full-route order', () => {
  assert.deepEqual(getRouteStages('full'), STAGE_NAMES);
});

test('getRouteStages("quick-fix") returns quick-fix order', () => {
  assert.deepEqual(getRouteStages('quick-fix'), [
    'goals',
    'research',
    'plan',
    'implement',
    'accept',
    'verify',
    'report',
  ]);
});

test('getDryRunArtifactPaths("full") includes design, structure, replan, and telemetry artifacts', () => {
  const artifacts = getDryRunArtifactPaths(testRunId, 'full');
  assert.ok(artifacts.includes('.pipeline/qrspi-20260523-143022/design.md'));
  assert.ok(artifacts.includes('.pipeline/qrspi-20260523-143022/structure.md'));
  assert.ok(
    artifacts.includes(
      '.pipeline/qrspi-20260523-143022/phases/phase-01/replan/phase-01-replan.md',
    ),
  );
  assert.ok(
    artifacts.includes(
      '.pipeline/qrspi-20260523-143022/telemetry/metrics-summary.md',
    ),
  );
});

test('getDryRunArtifactPaths("quick-fix") omits skipped-stage artifacts', () => {
  const artifacts = getDryRunArtifactPaths(testRunId, 'quick-fix');
  assert.equal(
    artifacts.includes('.pipeline/qrspi-20260523-143022/design.md'),
    false,
  );
  assert.equal(
    artifacts.includes('.pipeline/qrspi-20260523-143022/structure.md'),
    false,
  );
  assert.equal(
    artifacts.includes(
      '.pipeline/qrspi-20260523-143022/phases/phase-01/replan/phase-01-replan.md',
    ),
    false,
  );
  assert.ok(artifacts.includes('.pipeline/qrspi-20260523-143022/plan.md'));
  assert.ok(
    artifacts.includes('.pipeline/qrspi-20260523-143022/telemetry/run-log.md'),
  );
});

// ---------------------------------------------------------------------------
// stageNumber
// ---------------------------------------------------------------------------

test('stageNumber("goals") returns 1', () => {
  assert.equal(stageNumber('goals'), 1);
});

test('stageNumber("design") returns 3 (case-insensitive — capital D)', () => {
  assert.equal(stageNumber('Design'), 3);
});

test('stageNumber("report") returns 10', () => {
  assert.equal(stageNumber('report'), 10);
});

test('stageNumber("REPORT") returns 10 (all caps)', () => {
  assert.equal(stageNumber('REPORT'), 10);
});

test('stageNumber("nonexistent") returns 0', () => {
  assert.equal(stageNumber('nonexistent'), 0);
});

test('stageNumber("") returns 0', () => {
  assert.equal(stageNumber(''), 0);
});

test('stageNumber returns correct index for all 10 stages', () => {
  const stages = [
    'goals',
    'research',
    'design',
    'structure',
    'plan',
    'implement',
    'accept',
    'replan',
    'verify',
    'report',
  ];
  stages.forEach((name, idx) => {
    assert.equal(
      stageNumber(name),
      idx + 1,
      `stageNumber("${name}") should be ${idx + 1}`,
    );
  });
});

// ---------------------------------------------------------------------------
// nextStage — full route
// ---------------------------------------------------------------------------

test('nextStage full route: goals → research', () => {
  assert.equal(nextStage('goals', 'full'), 'research');
});

test('nextStage full route: design → structure', () => {
  assert.equal(nextStage('design', 'full'), 'structure');
});

test('nextStage full route: structure → plan', () => {
  assert.equal(nextStage('structure', 'full'), 'plan');
});

test('nextStage full route: report → null (last stage)', () => {
  assert.equal(nextStage('report', 'full'), null);
});

test('nextStage full route walks linearly through all 10 stages', () => {
  for (let i = 0; i < STAGE_NAMES.length - 1; i++) {
    assert.equal(nextStage(STAGE_NAMES[i], 'full'), STAGE_NAMES[i + 1]);
  }
});

test('nextStage full route case-insensitive: GOALS → research', () => {
  assert.equal(nextStage('GOALS', 'full'), 'research');
});

// ---------------------------------------------------------------------------
// nextStage — quick-fix route
// ---------------------------------------------------------------------------

test('nextStage quick-fix: research → plan (skips design and structure)', () => {
  assert.equal(nextStage('research', 'quick-fix'), 'plan');
});

test('nextStage quick-fix: plan → implement', () => {
  assert.equal(nextStage('plan', 'quick-fix'), 'implement');
});

test('nextStage quick-fix: implement → accept (skips replan)', () => {
  assert.equal(nextStage('implement', 'quick-fix'), 'accept');
});

test('nextStage quick-fix: accept → verify', () => {
  assert.equal(nextStage('accept', 'quick-fix'), 'verify');
});

test('nextStage quick-fix: verify → report', () => {
  assert.equal(nextStage('verify', 'quick-fix'), 'report');
});

test('nextStage quick-fix: report → null', () => {
  assert.equal(nextStage('report', 'quick-fix'), null);
});

test('nextStage quick-fix: design returns null (skipped stage)', () => {
  assert.equal(nextStage('design', 'quick-fix'), null);
});

test('nextStage quick-fix: structure returns null (skipped stage)', () => {
  assert.equal(nextStage('structure', 'quick-fix'), null);
});

test('nextStage quick-fix: replan returns null (skipped stage)', () => {
  assert.equal(nextStage('replan', 'quick-fix'), null);
});

test('nextStage quick-fix: goals → research', () => {
  assert.equal(nextStage('goals', 'quick-fix'), 'research');
});

// ---------------------------------------------------------------------------
// nextStage — invalid inputs
// ---------------------------------------------------------------------------

test('nextStage("bogus", "full") returns null', () => {
  assert.equal(nextStage('bogus', 'full'), null);
});

test('nextStage("", "quick-fix") returns null', () => {
  assert.equal(nextStage('', 'quick-fix'), null);
});

test('nextStage("", "full") returns null', () => {
  assert.equal(nextStage('', 'full'), null);
});

// ---------------------------------------------------------------------------
// Pure function determinism
// ---------------------------------------------------------------------------

test('getPipelineDir is deterministic', () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(getPipelineDir(testRunId), '.pipeline/qrspi-20260523-143022');
  }
});

test('getGitBranch is deterministic', () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(getGitBranch(testRunId), 'qrspi/qrspi-20260523-143022');
  }
});

test('makeInitialState is deterministic', () => {
  const a = makeInitialState(testRunId);
  const b = makeInitialState(testRunId);
  assert.deepEqual(a, b);
});

test('makeTelemetryEvent is deterministic for given input within same millisecond', () => {
  const a = makeTelemetryEvent(testRunId, 'test.det', { stage: 1 });
  const b = makeTelemetryEvent(testRunId, 'test.det', { stage: 1 });
  assert.equal(a.schema_version, b.schema_version);
  assert.equal(a.sequence, b.sequence);
  assert.equal(a.run_id, b.run_id);
  assert.equal(a.writer_agent, b.writer_agent);
  assert.equal(a.writer_scope, b.writer_scope);
  assert.equal(a.event_type, b.event_type);
  assert.equal(a.status, b.status);
  assert.equal(a.route, b.route);
  assert.equal(a.summary, b.summary);
  assert.equal(a.stage, b.stage);
});

test('createRunLogEntry is deterministic', () => {
  const a = createRunLogEntry({
    ts: '2026-05-23T14:30:22.000Z',
    event_type: 'e',
    status: 'PASS',
    summary: 's',
  });
  const b = createRunLogEntry({
    ts: '2026-05-23T14:30:22.000Z',
    event_type: 'e',
    status: 'PASS',
    summary: 's',
  });
  assert.equal(a, b);
});

test('stageNumber is deterministic', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(stageNumber('goals'), 1);
  }
});

test('nextStage is deterministic', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(nextStage('goals', 'full'), 'research');
  }
});

// ---------------------------------------------------------------------------
// getPipelinePaths with different runId
// ---------------------------------------------------------------------------

test('getPipelinePaths with different runId produces correct paths', () => {
  const rid = 'qrspi-20260523-999999';
  const paths = getPipelinePaths(rid);
  assert.equal(paths.pipelineDir, '.pipeline/qrspi-20260523-999999');
  assert.equal(paths.gitBranch, 'qrspi/qrspi-20260523-999999');
  assert.equal(paths.statePath, '.pipeline/qrspi-20260523-999999/state.md');
  assert.equal(paths.telemetryDir, '.pipeline/qrspi-20260523-999999/telemetry');
  assert.equal(
    paths.eventsPath,
    '.pipeline/qrspi-20260523-999999/telemetry/events.jsonl',
  );
  assert.equal(
    paths.runLogPath,
    '.pipeline/qrspi-20260523-999999/telemetry/run-log.md',
  );
  assert.equal(
    paths.metricsPath,
    '.pipeline/qrspi-20260523-999999/telemetry/metrics-summary.md',
  );
});
