const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(projectRoot, 'agents');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter between the first two `---` delimiters.
 * Returns an object of key-value pairs. Values are kept as strings;
 * numeric/boolean coercion is done by callers as needed.
 */
function parseFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  let openIdx = -1;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (openIdx === -1) {
        openIdx = i;
      } else {
        closeIdx = i;
        break;
      }
    }
  }

  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return null;
  }

  const fm = {};
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fm[key] = value;
  }
  return fm;
}

/**
 * Return the body of the file (content after the closing `---`).
 */
function getBody(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  let closeIdx = -1;
  let dashesSeen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      dashesSeen++;
      if (dashesSeen === 2) {
        closeIdx = i;
        break;
      }
    }
  }

  if (closeIdx === -1) return raw;
  return lines.slice(closeIdx + 1).join('\n');
}

// File paths
const planPath = path.join(agentsDir, 'qrspi-plan.md');
const planWriterPath = path.join(agentsDir, 'qrspi-plan-writer.md');
const taskSpecWriterPath = path.join(agentsDir, 'qrspi-task-spec-writer.md');
const taskSpecReviewerPath = path.join(
  agentsDir,
  'qrspi-task-spec-reviewer.md',
);
const planReviewerPath = path.join(agentsDir, 'qrspi-plan-reviewer.md');
const baselineCheckerPath = path.join(agentsDir, 'qrspi-baseline-checker.md');

const planFM = parseFrontmatter(planPath);
const planWriterFM = parseFrontmatter(planWriterPath);
const taskSpecWriterFM = parseFrontmatter(taskSpecWriterPath);
const taskSpecReviewerFM = parseFrontmatter(taskSpecReviewerPath);
const planReviewerFM = parseFrontmatter(planReviewerPath);
const baselineCheckerFM = parseFrontmatter(baselineCheckerPath);

const planBody = getBody(planPath);
const planWriterBody = getBody(planWriterPath);
const taskSpecWriterBody = getBody(taskSpecWriterPath);
const taskSpecReviewerBody = getBody(taskSpecReviewerPath);
const planReviewerBody = getBody(planReviewerPath);
const baselineCheckerBody = getBody(baselineCheckerPath);

// Expected frontmatter fields in all six agent types
const REQUIRED_FIELDS = [
  'description',
  'tools',
  'model',
  'thinking',
  'max_turns',
  'prompt_mode',
  'extensions',
  'enabled',
];

// ---------------------------------------------------------------------------
// A. File existence and parseability
// ---------------------------------------------------------------------------

test('qrspi-plan.md file exists and has parseable frontmatter', () => {
  assert.ok(planFM !== null, 'qrspi-plan.md has parseable frontmatter');
});

test('qrspi-plan-writer.md file exists and has parseable frontmatter', () => {
  assert.ok(
    planWriterFM !== null,
    'qrspi-plan-writer.md has parseable frontmatter',
  );
});

test('qrspi-task-spec-writer.md file exists and has parseable frontmatter', () => {
  assert.ok(
    taskSpecWriterFM !== null,
    'qrspi-task-spec-writer.md has parseable frontmatter',
  );
});

test('qrspi-task-spec-reviewer.md file exists and has parseable frontmatter', () => {
  assert.ok(
    taskSpecReviewerFM !== null,
    'qrspi-task-spec-reviewer.md has parseable frontmatter',
  );
});

test('qrspi-plan-reviewer.md file exists and has parseable frontmatter', () => {
  assert.ok(
    planReviewerFM !== null,
    'qrspi-plan-reviewer.md has parseable frontmatter',
  );
});

test('qrspi-baseline-checker.md file exists and has parseable frontmatter', () => {
  assert.ok(
    baselineCheckerFM !== null,
    'qrspi-baseline-checker.md has parseable frontmatter',
  );
});

// ---------------------------------------------------------------------------
// B. Frontmatter: exact required fields
// ---------------------------------------------------------------------------

test('qrspi-plan.md frontmatter — exact fields', () => {
  const keys = Object.keys(planFM).sort();
  assert.deepEqual(keys, [...REQUIRED_FIELDS].sort());
});

test('qrspi-plan-writer.md frontmatter — exact fields', () => {
  const keys = Object.keys(planWriterFM).sort();
  assert.deepEqual(keys, [...REQUIRED_FIELDS].sort());
});

test('qrspi-task-spec-writer.md frontmatter — exact fields', () => {
  const keys = Object.keys(taskSpecWriterFM).sort();
  assert.deepEqual(keys, [...REQUIRED_FIELDS].sort());
});

test('qrspi-task-spec-reviewer.md frontmatter — exact fields', () => {
  const keys = Object.keys(taskSpecReviewerFM).sort();
  assert.deepEqual(keys, [...REQUIRED_FIELDS].sort());
});

test('qrspi-plan-reviewer.md frontmatter — exact fields', () => {
  const keys = Object.keys(planReviewerFM).sort();
  assert.deepEqual(keys, [...REQUIRED_FIELDS].sort());
});

test('qrspi-baseline-checker.md frontmatter — exact fields', () => {
  const keys = Object.keys(baselineCheckerFM).sort();
  assert.deepEqual(keys, [...REQUIRED_FIELDS].sort());
});

// ---------------------------------------------------------------------------
// C. Frontmatter: tools field
// ---------------------------------------------------------------------------

test('qrspi-plan.md frontmatter — tools field', () => {
  assert.equal(
    planFM.tools,
    'read, bash, grep, find, ls, write, edit, qrspi_dispatch',
  );
});

test('qrspi-plan-writer.md frontmatter — tools includes write and edit', () => {
  const tools = planWriterFM.tools;
  assert.ok(tools.includes('write'), 'tools should include write');
  assert.ok(tools.includes('edit'), 'tools should include edit');
});

test('qrspi-task-spec-writer.md frontmatter — tools includes write and edit', () => {
  const tools = taskSpecWriterFM.tools;
  assert.ok(tools.includes('write'), 'tools should include write');
  assert.ok(tools.includes('edit'), 'tools should include edit');
});

test('qrspi-task-spec-reviewer.md frontmatter — tools field (read-only)', () => {
  assert.equal(taskSpecReviewerFM.tools, 'read, bash, grep, find, ls');
});

test('qrspi-plan-reviewer.md frontmatter — tools field (read-only)', () => {
  assert.equal(planReviewerFM.tools, 'read, bash, grep, find, ls');
});

test('qrspi-baseline-checker.md frontmatter — tools field (read-only)', () => {
  assert.equal(baselineCheckerFM.tools, 'read, bash, grep, find, ls');
});

// ---------------------------------------------------------------------------
// D. Frontmatter: model field
// ---------------------------------------------------------------------------

test('qrspi-plan.md frontmatter — model field', () => {
  assert.equal(planFM.model, 'deepseek-v4-pro');
});

test('qrspi-plan-writer.md frontmatter — model field', () => {
  assert.equal(planWriterFM.model, 'deepseek-v4-pro');
});

test('qrspi-task-spec-writer.md frontmatter — model field', () => {
  assert.equal(taskSpecWriterFM.model, 'deepseek-v4-pro');
});

test('qrspi-task-spec-reviewer.md frontmatter — model field', () => {
  assert.equal(taskSpecReviewerFM.model, 'deepseek-v4-pro');
});

test('qrspi-plan-reviewer.md frontmatter — model field', () => {
  assert.equal(planReviewerFM.model, 'deepseek-v4-pro');
});

test('qrspi-baseline-checker.md frontmatter — model field', () => {
  assert.equal(baselineCheckerFM.model, 'deepseek-v4-pro');
});

// ---------------------------------------------------------------------------
// E. Frontmatter: max_turns field
// ---------------------------------------------------------------------------

test('qrspi-plan.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(planFM.max_turns, 10), 80);
});

test('qrspi-plan-writer.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(planWriterFM.max_turns, 10), 60);
});

test('qrspi-task-spec-writer.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(taskSpecWriterFM.max_turns, 10), 40);
});

test('qrspi-task-spec-reviewer.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(taskSpecReviewerFM.max_turns, 10), 25);
});

test('qrspi-plan-reviewer.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(planReviewerFM.max_turns, 10), 30);
});

test('qrspi-baseline-checker.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(baselineCheckerFM.max_turns, 10), 20);
});

// ---------------------------------------------------------------------------
// F. Cross-file: thinking, extensions, enabled, prompt_mode
// ---------------------------------------------------------------------------

test('All 6 agents — thinking field is high', () => {
  assert.equal(planFM.thinking, 'high', 'qrspi-plan thinking must be high');
  assert.equal(
    planWriterFM.thinking,
    'high',
    'qrspi-plan-writer thinking must be high',
  );
  assert.equal(
    taskSpecWriterFM.thinking,
    'high',
    'qrspi-task-spec-writer thinking must be high',
  );
  assert.equal(
    taskSpecReviewerFM.thinking,
    'high',
    'qrspi-task-spec-reviewer thinking must be high',
  );
  assert.equal(
    planReviewerFM.thinking,
    'high',
    'qrspi-plan-reviewer thinking must be high',
  );
  assert.equal(
    baselineCheckerFM.thinking,
    'high',
    'qrspi-baseline-checker thinking must be high',
  );
});

test('All 6 agents — extensions field is false', () => {
  assert.equal(
    planFM.extensions,
    'false',
    'qrspi-plan extensions must be false',
  );
  assert.equal(
    planWriterFM.extensions,
    'false',
    'qrspi-plan-writer extensions must be false',
  );
  assert.equal(
    taskSpecWriterFM.extensions,
    'false',
    'qrspi-task-spec-writer extensions must be false',
  );
  assert.equal(
    taskSpecReviewerFM.extensions,
    'false',
    'qrspi-task-spec-reviewer extensions must be false',
  );
  assert.equal(
    planReviewerFM.extensions,
    'false',
    'qrspi-plan-reviewer extensions must be false',
  );
  assert.equal(
    baselineCheckerFM.extensions,
    'false',
    'qrspi-baseline-checker extensions must be false',
  );
});

test('All 6 agents — enabled field is false', () => {
  assert.equal(planFM.enabled, 'false', 'qrspi-plan enabled must be false');
  assert.equal(
    planWriterFM.enabled,
    'false',
    'qrspi-plan-writer enabled must be false',
  );
  assert.equal(
    taskSpecWriterFM.enabled,
    'false',
    'qrspi-task-spec-writer enabled must be false',
  );
  assert.equal(
    taskSpecReviewerFM.enabled,
    'false',
    'qrspi-task-spec-reviewer enabled must be false',
  );
  assert.equal(
    planReviewerFM.enabled,
    'false',
    'qrspi-plan-reviewer enabled must be false',
  );
  assert.equal(
    baselineCheckerFM.enabled,
    'false',
    'qrspi-baseline-checker enabled must be false',
  );
});

test('All 6 agents — prompt_mode field is replace', () => {
  assert.equal(
    planFM.prompt_mode,
    'replace',
    'qrspi-plan prompt_mode must be replace',
  );
  assert.equal(
    planWriterFM.prompt_mode,
    'replace',
    'qrspi-plan-writer prompt_mode must be replace',
  );
  assert.equal(
    taskSpecWriterFM.prompt_mode,
    'replace',
    'qrspi-task-spec-writer prompt_mode must be replace',
  );
  assert.equal(
    taskSpecReviewerFM.prompt_mode,
    'replace',
    'qrspi-task-spec-reviewer prompt_mode must be replace',
  );
  assert.equal(
    planReviewerFM.prompt_mode,
    'replace',
    'qrspi-plan-reviewer prompt_mode must be replace',
  );
  assert.equal(
    baselineCheckerFM.prompt_mode,
    'replace',
    'qrspi-baseline-checker prompt_mode must be replace',
  );
});

// ---------------------------------------------------------------------------
// G. Orchestrator body: dispatch references
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — uses qrspi_dispatch (not task) for subagent dispatch', () => {
  assert.ok(
    planBody.includes('qrspi_dispatch'),
    'body must contain qrspi_dispatch',
  );
  assert.ok(
    !planBody.includes('the task tool'),
    'body must not contain "the task tool"',
  );
  assert.ok(
    !planBody.includes('Invoke'),
    'body must not contain "Invoke" as dispatch reference',
  );
});

test('qrspi-plan.md body — contains subagent_type: "qrspi-plan-writer"', () => {
  assert.ok(planBody.includes('subagent_type: "qrspi-plan-writer"'));
});

test('qrspi-plan.md body — contains subagent_type: "qrspi-plan-reviewer"', () => {
  assert.ok(planBody.includes('subagent_type: "qrspi-plan-reviewer"'));
});

test('qrspi-plan.md body — contains subagent_type: "qrspi-task-spec-writer"', () => {
  assert.ok(planBody.includes('subagent_type: "qrspi-task-spec-writer"'));
});

test('qrspi-plan.md body — contains subagent_type: "qrspi-task-spec-reviewer"', () => {
  assert.ok(planBody.includes('subagent_type: "qrspi-task-spec-reviewer"'));
});

test('qrspi-plan.md body — contains subagent_type: "qrspi-baseline-checker"', () => {
  assert.ok(planBody.includes('subagent_type: "qrspi-baseline-checker"'));
});

// ---------------------------------------------------------------------------
// H. Orchestrator body: Read/Bash conventions
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — uses Read not cat for artifact reads', () => {
  assert.ok(
    planBody.includes('Read .pipeline/'),
    'body must contain "Read .pipeline/"',
  );
  assert.ok(
    !planBody.includes('cat .pipeline/'),
    'body must not contain "cat .pipeline/"',
  );
});

test('qrspi-plan.md body — contains bash mkdir commands for pipeline directories', () => {
  assert.ok(
    planBody.includes('bash: mkdir -p .pipeline/'),
    'body must contain bash mkdir command',
  );
});

test('qrspi-plan.md body — does not contain @build subagent reference', () => {
  assert.ok(
    !planBody.includes('@build'),
    'body must not contain @build subagent reference',
  );
});

// ---------------------------------------------------------------------------
// I. Orchestrator body: Steps A-F
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — contains Step A heading', () => {
  assert.ok(planBody.includes('Step A'), 'body must contain Step A heading');
});

test('qrspi-plan.md body — contains Step B heading', () => {
  assert.ok(planBody.includes('Step B'), 'body must contain Step B heading');
});

test('qrspi-plan.md body — contains Step C heading', () => {
  assert.ok(planBody.includes('Step C'), 'body must contain Step C heading');
});

test('qrspi-plan.md body — contains Step D heading', () => {
  assert.ok(planBody.includes('Step D'), 'body must contain Step D heading');
});

test('qrspi-plan.md body — contains Step E heading', () => {
  assert.ok(planBody.includes('Step E'), 'body must contain Step E heading');
});

test('qrspi-plan.md body — contains Step F heading', () => {
  assert.ok(planBody.includes('Step F'), 'body must contain Step F heading');
});

// ---------------------------------------------------------------------------
// J. Orchestrator body: Quick-fix route handling
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — mentions quick-fix and exactly one task constraint', () => {
  assert.ok(planBody.includes('quick-fix'), 'body must mention quick-fix');
  assert.ok(
    planBody.includes('exactly one task') ||
      planBody.includes('exactly one outline') ||
      planBody.includes('single task'),
    'body must contain exactly-one-task constraint for quick-fix',
  );
});

test('qrspi-plan.md body — contains instructions for omitting DESIGN and STRUCTURE on quick-fix', () => {
  assert.ok(
    planBody.includes('quick-fix') && planBody.includes('DESIGN'),
    'body must reference quick-fix and DESIGN omission',
  );
  assert.ok(
    planBody.includes('quick-fix') && planBody.includes('STRUCTURE'),
    'body must reference quick-fix and STRUCTURE omission',
  );
});

// ---------------------------------------------------------------------------
// K. Orchestrator body: Review loop invariants
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — contains review_round with 6-round cap', () => {
  assert.ok(
    planBody.includes('review_round'),
    'body must reference review_round',
  );
  assert.ok(
    planBody.includes('review_round = 6'),
    'body must reference review_round = 6 cap',
  );
  assert.ok(
    planBody.includes('review_round < 6'),
    'body must reference review_round < 6 loop condition',
  );
});

test('qrspi-plan.md body — contains stable-cap detection logic', () => {
  assert.ok(
    planBody.includes('stable-cap'),
    'body must reference stable-cap terminal state',
  );
  assert.ok(
    planBody.includes('Fix Guidance'),
    'body must reference Fix Guidance for stable-cap detection',
  );
});

test('qrspi-plan.md body — contains unclean-cap terminal state', () => {
  assert.ok(
    planBody.includes('unclean-cap'),
    'body must reference unclean-cap terminal state',
  );
});

test('qrspi-plan.md body — three-way decision: PASS stop, FAIL+<6 retry, FAIL+6 unclean-cap', () => {
  assert.ok(planBody.includes('PASS'), 'body must reference PASS stop');
  assert.ok(planBody.includes('FAIL'), 'body must reference FAIL state');
  assert.ok(
    planBody.includes('unclean-cap'),
    'body must reference unclean-cap state',
  );
  assert.ok(
    planBody.includes('PASS') &&
      planBody.includes('FAIL') &&
      planBody.includes('unclean-cap'),
    'body must have 3-way decision: PASS stop, FAIL+<6 retry, FAIL+6 unclean-cap',
  );
});

// ---------------------------------------------------------------------------
// L. Orchestrator body: Return contract
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — contains Status — PASS and Status — FAIL return format', () => {
  assert.ok(
    planBody.includes('### Status — PASS'),
    'body must contain PASS return format',
  );
  assert.ok(
    planBody.includes('### Status — FAIL'),
    'body must contain FAIL return format',
  );
});

test('qrspi-plan.md body — contains Files Written, Summary, and Telemetry return fields', () => {
  assert.ok(
    planBody.includes('### Files Written'),
    'body must contain Files Written field',
  );
  assert.ok(
    planBody.includes('### Summary'),
    'body must contain Summary field',
  );
  assert.ok(
    planBody.includes('### Telemetry'),
    'body must contain Telemetry field',
  );
});

// ---------------------------------------------------------------------------
// M. Orchestrator body: Quality gate
// ---------------------------------------------------------------------------

test('qrspi-plan.md body — references quality gate with hard-fail conditions', () => {
  assert.ok(
    planBody.includes('Quality Gate'),
    'body must reference Quality Gate',
  );
  assert.ok(
    planBody.includes('not addressed'),
    'body must reference missing AC coverage',
  );
  assert.ok(
    planBody.includes('depends on a later task'),
    'body must reference forward dependencies',
  );
  assert.ok(
    planBody.includes('placeholders'),
    'body must reference placeholders',
  );
  assert.ok(
    planBody.includes('quick-fix') && planBody.includes('more than one task'),
    'body must reference quick-fix cardinality in quality gate',
  );
});

// ---------------------------------------------------------------------------
// N. Plan writer body: Output contract
// ---------------------------------------------------------------------------

test('qrspi-plan-writer.md body — contains ### plan.md output section', () => {
  assert.ok(
    planWriterBody.includes('### plan.md'),
    'body must contain ### plan.md output section',
  );
});

test('qrspi-plan-writer.md body — contains ### phase-manifest.md output section', () => {
  assert.ok(
    planWriterBody.includes('### phase-manifest.md'),
    'body must contain ### phase-manifest.md output section',
  );
});

test('qrspi-plan-writer.md body — contains ### task-NN.outline output section', () => {
  assert.ok(
    planWriterBody.includes('### task-NN.outline') ||
      planWriterBody.includes('### task-'),
    'body must contain task outline output section',
  );
});

test('qrspi-plan-writer.md body — uses artifact-section output contract, not Status-based return format', () => {
  assert.ok(
    !planWriterBody.includes('### Status — PASS') &&
      !planWriterBody.includes('### Status — FAIL'),
    'plan-writer uses artifact-section output contract (### plan.md, ### phase-manifest.md, ### task-NN.outline); must NOT contain Status — PASS or Status — FAIL return format',
  );
});

// ---------------------------------------------------------------------------
// O. Plan writer body: Hard requirements
// ---------------------------------------------------------------------------

test('qrspi-plan-writer.md body — contains No placeholders rule', () => {
  assert.ok(
    planWriterBody.includes('No placeholders'),
    'body must contain No placeholders rule',
  );
});

test('qrspi-plan-writer.md body — contains Coverage Notes are complete rule', () => {
  assert.ok(
    planWriterBody.includes('Coverage Notes are complete'),
    'body must contain Coverage Notes are complete rule',
  );
});

test('qrspi-plan-writer.md body — contains Quick-fix cardinality exactly one task rule', () => {
  assert.ok(
    planWriterBody.includes('Quick-fix cardinality') ||
      planWriterBody.includes('exactly one task outline'),
    'body must contain quick-fix cardinality rule',
  );
});

test('qrspi-plan-writer.md body — contains Completed phases are immutable rule', () => {
  assert.ok(
    planWriterBody.includes('Completed phases are immutable'),
    'body must contain Completed phases are immutable rule',
  );
});

test('qrspi-plan-writer.md body — contains AGENTS Guidance is applied rule', () => {
  assert.ok(
    planWriterBody.includes('AGENTS Guidance is applied'),
    'body must contain AGENTS Guidance is applied rule',
  );
});

// ---------------------------------------------------------------------------
// P. Task spec writer body: Output contract
// ---------------------------------------------------------------------------

test('qrspi-task-spec-writer.md body — contains Status — PASS and Status — FAIL return format', () => {
  assert.ok(
    taskSpecWriterBody.includes('### Status — PASS'),
    'body must contain PASS return format',
  );
  assert.ok(
    taskSpecWriterBody.includes('### Status — FAIL'),
    'body must contain FAIL return format',
  );
});

test('qrspi-task-spec-writer.md body — contains required reads list', () => {
  assert.ok(
    taskSpecWriterBody.includes('goals.md'),
    'body must reference goals.md in required reads',
  );
  assert.ok(
    taskSpecWriterBody.includes('requirements.md'),
    'body must reference requirements.md in required reads',
  );
  assert.ok(
    taskSpecWriterBody.includes('research/summary.md'),
    'body must reference research/summary.md in required reads',
  );
  assert.ok(
    taskSpecWriterBody.includes('plan.md'),
    'body must reference plan.md in required reads',
  );
  assert.ok(
    taskSpecWriterBody.includes('phase-manifest.md'),
    'body must reference phase-manifest.md in required reads',
  );
});

// ---------------------------------------------------------------------------
// Q. Task spec writer body: Hard invariants
// ---------------------------------------------------------------------------

test('qrspi-task-spec-writer.md body — contains Do not invent constraint', () => {
  assert.ok(
    taskSpecWriterBody.includes('Do not invent'),
    'body must contain Do not invent constraint',
  );
});

test('qrspi-task-spec-writer.md body — contains Files paths must come from approved sources only', () => {
  assert.ok(
    taskSpecWriterBody.includes('from approved sources only') ||
      taskSpecWriterBody.includes('approved sources'),
    'body must contain approved-sources path constraint',
  );
});

// ---------------------------------------------------------------------------
// R. Task spec reviewer body: Read-only behavior
// ---------------------------------------------------------------------------

test('qrspi-task-spec-reviewer.md body — contains Do not edit files read-only instruction', () => {
  assert.ok(
    taskSpecReviewerBody.includes('Do not edit files'),
    'body must contain read-only instruction',
  );
});

test('qrspi-task-spec-reviewer.md body — contains ### Mutations Applied output section', () => {
  assert.ok(
    taskSpecReviewerBody.includes('### Mutations Applied'),
    'body must contain Mutations Applied output section',
  );
});

test('qrspi-task-spec-reviewer.md body — does not contain instructions to edit task files in place', () => {
  assert.ok(
    !taskSpecReviewerBody.includes('edit task'),
    'body must not instruct editing task files in place',
  );
});

// ---------------------------------------------------------------------------
// S. Task spec reviewer body: Output format
// ---------------------------------------------------------------------------

test('qrspi-task-spec-reviewer.md body — contains ### Review Findings table', () => {
  assert.ok(
    taskSpecReviewerBody.includes('### Review Findings'),
    'body must contain Review Findings table',
  );
});

test('qrspi-task-spec-reviewer.md body — contains ### Unresolved Cross-Task Conflicts section', () => {
  assert.ok(
    taskSpecReviewerBody.includes('### Unresolved Cross-Task Conflicts'),
    'body must contain Unresolved Cross-Task Conflicts section',
  );
});

test('qrspi-task-spec-reviewer.md body — contains the 10 review areas', () => {
  const reviewAreas = [
    'Outline fidelity',
    'Structure-slice fidelity',
    'Source-traceability completeness',
    'Acceptance-criteria and NFR fidelity',
    'Dependency correctness',
    'Self-containment',
    'Test expectation quality',
    'Placeholder-free quality',
    'AGENTS compliance',
    'Cross-task consistency',
  ];
  for (const area of reviewAreas) {
    assert.ok(
      taskSpecReviewerBody.includes(area),
      `Review Findings must include: ${area}`,
    );
  }
});

// ---------------------------------------------------------------------------
// T. Plan reviewer body: Output format
// ---------------------------------------------------------------------------

test('qrspi-plan-reviewer.md body — contains ### Review Findings with 16 review areas', () => {
  const reviewAreas = [
    'Goals coverage',
    'NFR coverage',
    'Dependency correctness',
    'Phase and wave coherence',
    'Phase cohesion',
    'Cross-phase coupling',
    'Outline completeness',
    'Acceptance traceability',
    'Outline traceability',
    'File specificity',
    'Test coverage scope',
    'Test strategy depth',
    'Replan gate traceability',
    'Completed-phase preservation',
    'AGENTS compliance',
    'Placeholder-free quality',
  ];
  for (const area of reviewAreas) {
    assert.ok(
      planReviewerBody.includes(area),
      `Review Findings must include: ${area}`,
    );
  }
});

test('qrspi-plan-reviewer.md body — contains ### Fix Guidance, ### Weakest Areas, and ### Summary', () => {
  assert.ok(
    planReviewerBody.includes('### Fix Guidance'),
    'body must contain Fix Guidance section',
  );
  assert.ok(
    planReviewerBody.includes('### Weakest Areas'),
    'body must contain Weakest Areas section',
  );
  assert.ok(
    planReviewerBody.includes('### Summary'),
    'body must contain Summary section',
  );
});

test('qrspi-plan-reviewer.md body — contains worked examples', () => {
  assert.ok(
    planReviewerBody.includes('Good review'),
    'body must contain good review example',
  );
  assert.ok(
    planReviewerBody.includes('Bad review'),
    'body must contain bad review example',
  );
});

// ---------------------------------------------------------------------------
// U. Plan reviewer body: Red flags
// ---------------------------------------------------------------------------

test('qrspi-plan-reviewer.md body — contains red flags for key defect categories', () => {
  assert.ok(
    planReviewerBody.includes('forward'),
    'body must flag forward dependencies',
  );
  assert.ok(
    planReviewerBody.includes('placeholder') ||
      planReviewerBody.includes('TBD'),
    'body must flag placeholders',
  );
  assert.ok(
    planReviewerBody.includes('quick-fix'),
    'body must flag quick-fix cardinality issues',
  );
  assert.ok(
    planReviewerBody.includes('acceptance criterion'),
    'body must flag missing acceptance criteria',
  );
});

// ---------------------------------------------------------------------------
// V. Baseline checker body: Command execution
// ---------------------------------------------------------------------------

test('qrspi-baseline-checker.md body — does not contain @build subagent dispatch reference', () => {
  assert.ok(
    !baselineCheckerBody.includes('@build'),
    'body must not contain @build subagent reference',
  );
});

test('qrspi-baseline-checker.md body — contains instructions to discover commands from package.json using bash', () => {
  assert.ok(
    baselineCheckerBody.includes('package.json'),
    'body must reference package.json',
  );
  assert.ok(
    baselineCheckerBody.includes('bash'),
    'body must reference bash for command execution',
  );
});

test('qrspi-baseline-checker.md body — contains the four status categories', () => {
  assert.ok(
    baselineCheckerBody.includes('PASS'),
    'body must contain PASS status',
  );
  assert.ok(
    baselineCheckerBody.includes('FAIL'),
    'body must contain FAIL status',
  );
  assert.ok(
    baselineCheckerBody.includes('NOT CONFIGURED'),
    'body must contain NOT CONFIGURED status',
  );
  assert.ok(
    baselineCheckerBody.includes('SKIPPED'),
    'body must contain SKIPPED status',
  );
});

// ---------------------------------------------------------------------------
// W. Baseline checker body: Output format
// ---------------------------------------------------------------------------

test('qrspi-baseline-checker.md body — contains ### Baseline Status — CLEAN or DIRTY', () => {
  assert.ok(
    baselineCheckerBody.includes('### Baseline Status'),
    'body must contain Baseline Status header',
  );
  assert.ok(
    baselineCheckerBody.includes('CLEAN'),
    'body must reference CLEAN status',
  );
  assert.ok(
    baselineCheckerBody.includes('DIRTY'),
    'body must reference DIRTY status',
  );
});

test('qrspi-baseline-checker.md body — contains ### Check Results, ### Failure Inventory, and ### Stage Summary', () => {
  assert.ok(
    baselineCheckerBody.includes('### Check Results'),
    'body must contain Check Results table',
  );
  assert.ok(
    baselineCheckerBody.includes('### Failure Inventory'),
    'body must contain Failure Inventory table',
  );
  assert.ok(
    baselineCheckerBody.includes('### Stage Summary'),
    'body must contain Stage Summary section',
  );
});

// ---------------------------------------------------------------------------
// X. Cross-file: no opencode permission system references
// ---------------------------------------------------------------------------

test('All 6 agents — no opencode permission system references', () => {
  const forbiddenPatterns = [
    /permission\.edit/,
    /permission\.bash/,
    /permission\.task/,
    /permission\.webfetch/,
    /permission\.question/,
    /permission\.todowrite/,
    /allowed-list/,
    /Rule\s*11/,
  ];

  const allBodies = {
    'qrspi-plan': planBody,
    'qrspi-plan-writer': planWriterBody,
    'qrspi-task-spec-writer': taskSpecWriterBody,
    'qrspi-task-spec-reviewer': taskSpecReviewerBody,
    'qrspi-plan-reviewer': planReviewerBody,
    'qrspi-baseline-checker': baselineCheckerBody,
  };

  for (const [name, body] of Object.entries(allBodies)) {
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(body),
        `${name} agent body must not contain "${pattern.source}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Y. Cross-file: Model profile compliance
// ---------------------------------------------------------------------------

test('All Stage 6 planning agents use deepseek-v4-pro', () => {
  assert.equal(
    planFM.model,
    'deepseek-v4-pro',
    'qrspi-plan must use deepseek-v4-pro',
  );
  assert.equal(
    planWriterFM.model,
    'deepseek-v4-pro',
    'qrspi-plan-writer must use deepseek-v4-pro',
  );
  assert.equal(
    taskSpecWriterFM.model,
    'deepseek-v4-pro',
    'qrspi-task-spec-writer must use deepseek-v4-pro',
  );
  assert.equal(
    taskSpecReviewerFM.model,
    'deepseek-v4-pro',
    'qrspi-task-spec-reviewer must use deepseek-v4-pro',
  );
  assert.equal(
    planReviewerFM.model,
    'deepseek-v4-pro',
    'qrspi-plan-reviewer must use deepseek-v4-pro',
  );
  assert.equal(
    baselineCheckerFM.model,
    'deepseek-v4-pro',
    'qrspi-baseline-checker must use deepseek-v4-pro',
  );
});

// ---------------------------------------------------------------------------
// Z. Cross-file: Body non-empty
// ---------------------------------------------------------------------------

test('All 6 agents — body is non-empty', () => {
  assert.ok(planBody.length > 0, 'qrspi-plan body must be non-empty');
  assert.ok(
    planWriterBody.length > 0,
    'qrspi-plan-writer body must be non-empty',
  );
  assert.ok(
    taskSpecWriterBody.length > 0,
    'qrspi-task-spec-writer body must be non-empty',
  );
  assert.ok(
    taskSpecReviewerBody.length > 0,
    'qrspi-task-spec-reviewer body must be non-empty',
  );
  assert.ok(
    planReviewerBody.length > 0,
    'qrspi-plan-reviewer body must be non-empty',
  );
  assert.ok(
    baselineCheckerBody.length > 0,
    'qrspi-baseline-checker body must be non-empty',
  );
});
