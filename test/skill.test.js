const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const skillPath = path.join(projectRoot, 'skills', 'deepwork', 'SKILL.md');
let skillContent;

// Read once for all tests
try {
  skillContent = fs.readFileSync(skillPath, 'utf8');
} catch {
  skillContent = null;
}

// --- File existence and basic properties ---

test('SKILL.md exists at skills/deepwork/SKILL.md', () => {
  assert.ok(skillContent !== null, 'SKILL.md should be readable');
  assert.ok(
    skillContent.length > 100,
    'SKILL.md should have substantial content',
  );
});

test('SKILL.md has YAML frontmatter with required metadata', () => {
  const trimmed = skillContent.trimStart();
  const frontmatterMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);

  assert.ok(frontmatterMatch, 'SKILL.md should start with YAML frontmatter');
  assert.match(frontmatterMatch[1], /^name:\s+deepwork$/m);
  assert.match(
    frontmatterMatch[1],
    /^description:\s+.+$/m,
    'SKILL.md frontmatter should include a description',
  );
});

test('SKILL.md is valid markdown (contains markdown headers)', () => {
  assert.ok(
    skillContent.includes('# '),
    'Should contain at least one level-1 header',
  );
  assert.ok(
    skillContent.includes('## '),
    'Should contain at least one level-2 header',
  );
});

// --- Forbidden content checks ---

test('SKILL.md does not reference "task" tool (uses "qrspi_dispatch" instead)', () => {
  const taskToolPattern = /`task` tool|invoke.*`task`|use the `task`/i;
  assert.ok(
    !taskToolPattern.test(skillContent),
    'Should not reference task tool — use qrspi_dispatch instead',
  );
});

test('SKILL.md does not reference "question" tool (uses "qrspi_question" instead)', () => {
  const questionToolPattern =
    /`question` tool|invoke.*`question`|use the `question`/i;
  assert.ok(
    !questionToolPattern.test(skillContent),
    'Should not reference question tool — use qrspi_question instead',
  );
});

test('SKILL.md does not reference todowrite operations', () => {
  assert.ok(
    !skillContent.includes('todowrite'),
    'Should not contain todowrite references',
  );
});

test('SKILL.md does not contain permission-rule enforcement or allowed-file-writes table', () => {
  assert.ok(
    !skillContent.includes('permission.edit'),
    'Should not reference permission.edit',
  );
  assert.ok(
    !skillContent.includes('permission.bash'),
    'Should not reference permission.bash',
  );
  assert.ok(
    !skillContent.includes('permission.task'),
    'Should not reference permission.task',
  );
  assert.ok(
    !skillContent.includes('allowed-file writes'),
    'Should not reference allowed-file writes',
  );
  assert.ok(
    !skillContent.includes('allowed-file table'),
    'Should not reference allowed-file table',
  );
  assert.ok(
    !skillContent.includes('diff --stat'),
    'Should not reference diff --stat',
  );
});

test('SKILL.md does not reference protocol/ file reads', () => {
  assert.ok(
    !skillContent.includes('protocol/'),
    'Should not reference protocol/ directory reads',
  );
  assert.ok(
    !skillContent.includes('~/.config/opencode/protocol'),
    'Should not reference opencode protocol path',
  );
});

// --- Required tool references ---

test('SKILL.md uses qrspi_dispatch with subagent_type parameter', () => {
  assert.ok(
    skillContent.includes('qrspi_dispatch'),
    'Should mention qrspi_dispatch',
  );
  assert.ok(
    skillContent.includes('subagent_type'),
    'Should include subagent_type parameter',
  );
  assert.ok(
    skillContent.includes('Use qrspi_dispatch with'),
    'Should contain qrspi_dispatch usage instructions',
  );
});

test('SKILL.md uses qrspi_question with required parameters', () => {
  assert.ok(
    skillContent.includes('qrspi_question'),
    'Should reference qrspi_question',
  );
  assert.ok(skillContent.includes('header'), 'Should include header parameter');
  assert.ok(
    /qrspi_question[^]*?message:/.test(skillContent),
    'qrspi_question should use message: parameter',
  );
  assert.ok(
    skillContent.includes('options'),
    'Should include options parameter',
  );
  assert.ok(skillContent.includes('type'), 'Should include type parameter');
});

// --- Required sections ---

const requiredSections = [
  { name: 'CRITICAL RULES', marker: '### CRITICAL RULES' },
  { name: 'Pipeline', marker: '### Pipeline' },
  {
    name: 'Stage Subagent Architecture',
    marker: '### Stage Subagent Architecture',
  },
  { name: 'Return Contract', marker: '### Return Contract' },
  { name: 'Telemetry', marker: '### Telemetry' },
  { name: 'Resume Mode', marker: '### Resume Mode' },
  { name: 'state.md Contract', marker: '### `state.md` Contract' },
  {
    name: 'Pipeline Files Convention',
    marker: '### Pipeline Files Convention',
  },
  { name: 'Route Handling', marker: '### Route Handling' },
  { name: 'Pre-Flight', marker: '### Pre-Flight' },
  { name: 'Stage 1 — Goals', marker: '### Stage 1 — Goals' },
  { name: 'Stage 2 — Research', marker: '### Stage 2 — Research' },
  { name: 'Stage 3 — Design', marker: '### Stage 3 — Design' },
  { name: 'Stage 4 — Structure', marker: '### Stage 4 — Structure' },
  { name: 'Stage 5 — Plan', marker: '### Stage 5 — Plan' },
  { name: 'Stage 6 — Implement', marker: '### Stage 6 — Implement' },
  {
    name: 'Stage 7 — Acceptance Test',
    marker: '### Stage 7 — Acceptance Test',
  },
  { name: 'Stage 8 — Replan', marker: '### Stage 8 — Replan' },
  { name: 'Stage 9 — Verify', marker: '### Stage 9 — Verify' },
  { name: 'Stage 10 — Report', marker: '### Stage 10 — Report' },
  { name: 'Backward Loop Protocol', marker: '### Backward Loop Protocol' },
  { name: 'Error Handling', marker: '### Error Handling' },
  { name: 'Post-Pipeline Cleanup', marker: '### Post-Pipeline Cleanup' },
];

for (const section of requiredSections) {
  test(`SKILL.md contains "${section.name}" section`, () => {
    assert.ok(
      skillContent.includes(section.marker),
      `Expected to find "${section.marker}" in SKILL.md`,
    );
  });
}

// --- Pre-flight (11-step) ---

test('SKILL.md contains 11-step Pre-Flight sequence', () => {
  const preFlightSection = skillContent.substring(
    skillContent.indexOf('### Pre-Flight'),
    skillContent.indexOf('### Stage 1 — Goals'),
  );
  const stepMatches = preFlightSection.match(/\n\d+\. /g);
  assert.ok(
    stepMatches && stepMatches.length >= 11,
    `Pre-Flight should have 11 numbered steps, found ${stepMatches ? stepMatches.length : 0}`,
  );
});

test('Pre-Flight generates run ID with qrspi-YYYYMMDD-HHMMSS format', () => {
  assert.ok(
    skillContent.includes('qrspi-<timestamp>') ||
      skillContent.includes('qrspi-YYYYMMDD'),
    'Pre-Flight should specify qrspi-prefixed run ID format',
  );
  assert.ok(
    skillContent.includes('date +%Y%m%d-%H%M%S'),
    'Pre-Flight should use date command for timestamp generation',
  );
});

test('Pre-Flight creates pipeline directory and branch', () => {
  assert.ok(
    skillContent.includes('mkdir -p .pipeline/qrspi-<run-id>'),
    'Pre-Flight should create pipeline directory',
  );
  assert.ok(
    skillContent.includes('git checkout -b'),
    'Pre-Flight should create git branch',
  );
});

// --- Quick-fix route ---

test('SKILL.md contains quick-fix route with skip logic', () => {
  assert.ok(
    skillContent.includes('quick-fix'),
    'Should reference quick-fix route',
  );
  assert.ok(
    skillContent.includes('SKIP on Quick-Fix') ||
      skillContent.includes('skip this stage'),
    'Should contain skip instructions for quick-fix route',
  );
});

test('Quick-fix skips Stages 3 and 4', () => {
  // Check Stage 2 transitions to Stage 5 on quick-fix
  assert.ok(
    skillContent.includes('proceed to **Stage 5**') &&
      skillContent.includes('quick-fix'),
    'Stage 2 should route to Stage 5 on quick-fix',
  );
});

test('Quick-fix skips Stage 8', () => {
  const idx85 = skillContent.indexOf('### Stage 8 — Replan');
  const idx9 = skillContent.indexOf('### Stage 9 — Verify');
  assert.ok(
    idx85 !== -1 && idx9 !== -1,
    'Stage 8 and Stage 9 section markers must exist',
  );
  const stage85Section = skillContent.substring(idx85, idx9);
  // Check that skip logic mentions quick-fix (case-insensitive for "Skip")
  assert.ok(
    stage85Section.toLowerCase().includes('quick-fix') &&
      stage85Section.toLowerCase().includes('skip'),
    'Stage 8 should be skipped on quick-fix',
  );
});

test('Quick-fix route locks after Stage 5 and uses single-phase', () => {
  assert.ok(
    skillContent.includes('Route is now locked'),
    'Route should lock after Stage 5',
  );
  assert.ok(
    skillContent.includes('total_phases: 1') ||
      skillContent.includes('set `total_phases: 1`'),
    'Quick-fix should hardcode single phase',
  );
});

// --- Backward loop protocol ---

test('SKILL.md contains backward loop protocol with 6 steps', () => {
  const loopStart = skillContent.indexOf('### Backward Loop Protocol');
  const loopEnd = skillContent.indexOf('### Error Handling');
  const loopSection = skillContent.substring(loopStart, loopEnd);
  const stepMatches = loopSection.match(/\n\d+\. /g);
  assert.ok(
    stepMatches && stepMatches.length >= 6,
    `Backward loop protocol should have 6 numbered steps, found ${stepMatches ? stepMatches.length : 0}`,
  );
});

test('Backward loop protocol handles all loop classifications', () => {
  assert.ok(skillContent.includes('LOOP_PLAN'), 'Should handle LOOP_PLAN');
  assert.ok(
    skillContent.includes('LOOP_STRUCTURE'),
    'Should handle LOOP_STRUCTURE',
  );
  assert.ok(skillContent.includes('LOOP_DESIGN'), 'Should handle LOOP_DESIGN');
  assert.ok(skillContent.includes('LOOP_GOALS'), 'Should handle LOOP_GOALS');
  assert.ok(
    skillContent.includes('DEFER_REPLAN'),
    'Should handle DEFER_REPLAN',
  );
  assert.ok(skillContent.includes('NO_LOOP'), 'Should handle NO_LOOP');
});

test('Backward loop protocol archives future phase directories', () => {
  assert.ok(
    skillContent.includes('phases/archive') ||
      skillContent.includes('Archive any future phase'),
    'Backward loop should archive future phase directories',
  );
});

// --- Resume mode ---

test('SKILL.md contains self-contained resume mode', () => {
  const resumeStart = skillContent.indexOf('### Resume Mode');
  const resumeEnd = skillContent.indexOf('### `state.md` Contract');
  const resumeSection = skillContent.substring(resumeStart, resumeEnd);
  assert.ok(
    resumeSection.includes('state.md'),
    'Resume mode should read state.md for recovery',
  );
  assert.ok(
    resumeSection.includes('resume_source'),
    'Resume mode should handle resume_source',
  );
});

test('Resume mode handles missing state.md via artifact discovery', () => {
  assert.ok(
    skillContent.includes('Missing state.md') ||
      skillContent.includes('missing or invalid'),
    'Resume mode should handle missing state.md',
  );
});

test('Resume mode initializes telemetry sequence from events.jsonl', () => {
  assert.ok(
    skillContent.includes('telemetry_seq') &&
      skillContent.includes('events.jsonl'),
    'Resume mode should initialize telemetry_seq',
  );
});

// --- Git checkpointing ---

test('SKILL.md contains git checkpoint instructions after every stage', () => {
  assert.ok(
    skillContent.includes('git status --short'),
    'Should include git status check',
  );
  assert.ok(skillContent.includes('git add -A'), 'Should include git add -A');
  assert.ok(
    skillContent.includes('git commit -m'),
    'Should include git commit instruction',
  );
  assert.ok(
    skillContent.includes('qrspi: stage'),
    'Commit messages should use qrspi: stage prefix',
  );
});

// --- Telemetry templates ---

test('SKILL.md contains run-log.md 6-section layout', () => {
  const runLogSections = [
    '## Run Overview',
    '## Current Status',
    '## Timeline',
    '## Active Phase Snapshot',
    '## Failure and Loop Index',
    '## Artifact Index',
  ];
  for (const section of runLogSections) {
    assert.ok(
      skillContent.includes(section),
      `run-log.md template should contain "${section}"`,
    );
  }
});

test('SKILL.md contains metrics-summary.md 8-section layout', () => {
  const metricsSections = [
    '## Run',
    '## Stage Durations',
    '## Child Agent Calls',
    '## Review Rounds',
    '## Retry and Loop Counts',
    '## Human Gate Outcomes',
    '## Test Evidence Quality',
    '## Code Health',
  ];
  for (const section of metricsSections) {
    assert.ok(
      skillContent.includes(section),
      `metrics-summary.md template should contain "${section}"`,
    );
  }
});

// --- state.md 13-field schema ---

test('SKILL.md documents state.md with all 13 fields', () => {
  const stateFields = [
    'run_id',
    'mode',
    'route',
    'current_phase',
    'total_phases',
    'last_completed_stage',
    'next_stage',
    'stages_completed',
    'phase_history',
    'backward_loops',
    'resume_source',
    'interaction_mode',
    'failure_policy',
  ];
  const stateSectionStart = skillContent.indexOf('### `state.md` Contract');
  const stateSectionEnd = skillContent.indexOf('### Pipeline Files Convention');
  const stateSection = skillContent.substring(
    stateSectionStart,
    stateSectionEnd,
  );

  for (const field of stateFields) {
    assert.ok(
      stateSection.includes(field),
      `state.md schema should include "${field}" field`,
    );
  }
});

// --- Human gates ---

test('SKILL.md describes human gates at correct stages', () => {
  // Stage 1 (Goals) human gate
  const stage1Section = skillContent.substring(
    skillContent.indexOf('### Stage 1 — Goals'),
    skillContent.indexOf('### Stage 2 — Research'),
  );
  assert.ok(
    stage1Section.includes('qrspi_question') ||
      stage1Section.includes('human gate') ||
      stage1Section.includes('Human Gate'),
    'Stage 1 should reference human gate',
  );

  // Stage 3 human gate
  const stage4Section = skillContent.substring(
    skillContent.indexOf('### Stage 3 — Design'),
    skillContent.indexOf('### Stage 4 — Structure'),
  );
  assert.ok(
    stage4Section.includes('qrspi_question') ||
      stage4Section.includes('human gate') ||
      stage4Section.includes('Human Gate'),
    'Stage 3 should reference human gate',
  );

  // Stage 4 human gate
  const stage5Section = skillContent.substring(
    skillContent.indexOf('### Stage 4 — Structure'),
    skillContent.indexOf('### Stage 5 — Plan'),
  );
  assert.ok(
    stage5Section.includes('qrspi_question') ||
      stage5Section.includes('human gate') ||
      stage5Section.includes('Human Gate'),
    'Stage 4 should reference human gate',
  );

  // Stage 5 unclean-cap gate
  assert.ok(
    skillContent.includes('unclean-cap') &&
      skillContent.includes('qrspi_question'),
    'Stage 5 should have unclean-cap human gate',
  );
});

// --- Error handling ---

test('SKILL.md contains complete error handling flow', () => {
  const errorStart = skillContent.indexOf('### Error Handling');
  const errorSection = skillContent.substring(errorStart);
  assert.ok(
    errorSection.includes('stage.failed'),
    'Error handling should emit stage.failed',
  );
  assert.ok(
    errorSection.includes('Retry'),
    'Error handling should offer Retry option',
  );
  assert.ok(
    errorSection.includes('Abort'),
    'Error handling should offer Abort option',
  );
  assert.ok(
    errorSection.includes('run.aborted'),
    'Error handling should emit run.aborted on abort',
  );
});

// --- Post-pipeline cleanup ---

test('SKILL.md contains post-pipeline cleanup logic', () => {
  assert.ok(
    skillContent.includes('### Post-Pipeline Cleanup'),
    'Should have Post-Pipeline Cleanup section',
  );
  assert.ok(
    skillContent.includes('stage9-summary.md'),
    'Post-pipeline should reference verify results',
  );
  const cleanupStart = skillContent.indexOf('### Post-Pipeline Cleanup');
  const cleanupSection = skillContent.substring(cleanupStart);
  assert.ok(
    cleanupSection.includes('PASS') ||
      cleanupSection.includes('PARTIAL') ||
      cleanupSection.includes('FAIL'),
    'Post-pipeline should handle all verify outcomes',
  );
});

// --- Pipeline diagram ---

test('SKILL.md pipeline diagram includes all stages in order', () => {
  const stageOrder = [
    'Goals',
    'Research',
    'Questions',
    'Design',
    'Structure',
    'Plan',
    'Implement',
    'Accept-Test',
    'Replan',
    'Verify',
    'Report',
  ];
  for (const stage of stageOrder) {
    assert.ok(
      skillContent.includes(stage),
      `Pipeline should include stage: ${stage}`,
    );
  }
});

// --- Stage subagent dispatch for all 10 stages ---

const expectedAgents = [
  'qrspi-goals',
  'qrspi-questions',
  'qrspi-research',
  'qrspi-design',
  'qrspi-structure',
  'qrspi-plan',
  'qrspi-implement',
  'qrspi-accept',
  'qrspi-replan',
  'qrspi-verify',
  'qrspi-report',
];

for (const agent of expectedAgents) {
  test(`SKILL.md dispatches ${agent} subagent`, () => {
    assert.ok(
      skillContent.includes(agent),
      `Should reference subagent: ${agent}`,
    );
  });
}

// --- Pipeline file convention ---

test('SKILL.md includes full pipeline directory tree', () => {
  assert.ok(
    skillContent.includes('.pipeline/qrspi-<run-id>/'),
    'Should document pipeline directory structure',
  );
  assert.ok(
    skillContent.includes('state.md'),
    'Pipeline tree should include state.md',
  );
  assert.ok(
    skillContent.includes('config.md'),
    'Pipeline tree should include config.md',
  );
  assert.ok(
    skillContent.includes('telemetry/'),
    'Pipeline tree should include telemetry directory',
  );
});
