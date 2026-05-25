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

  // Find opening and closing `---`
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
const orchestratorPath = path.join(agentsDir, 'qrspi-goals.md');
const synthesizerPath = path.join(agentsDir, 'qrspi-goals-synthesizer.md');
const reviewerPath = path.join(agentsDir, 'qrspi-goals-reviewer.md');

const orchFM = parseFrontmatter(orchestratorPath);
const synthFM = parseFrontmatter(synthesizerPath);
const reviewFM = parseFrontmatter(reviewerPath);

const orchBody = getBody(orchestratorPath);
const synthBody = getBody(synthesizerPath);
const reviewBody = getBody(reviewerPath);

// Expected frontmatter fields in all three agent types
const EXPECTED_FIELDS = [
  'description',
  'tools',
  'model',
  'thinking',
  'max_turns',
  'prompt_mode',
  'extensions',
];

// ---------------------------------------------------------------------------
// qrspi-goals.md — Frontmatter
// ---------------------------------------------------------------------------

test('qrspi-goals.md frontmatter — exact fields', () => {
  const keys = Object.keys(orchFM).sort();
  assert.deepEqual(keys, [...EXPECTED_FIELDS].sort());
});

test('qrspi-goals.md frontmatter — tools field', () => {
  assert.equal(
    orchFM.tools,
    'read, bash, grep, find, ls, write, edit, qrspi_dispatch, ask_user',
  );
});

test('qrspi-goals.md frontmatter — model field', () => {
  assert.equal(orchFM.model, 'deepseek-v4-pro');
});

test('qrspi-goals.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(orchFM.max_turns, 10), 80);
});

// ---------------------------------------------------------------------------
// qrspi-goals-synthesizer.md — Frontmatter
// ---------------------------------------------------------------------------

test('qrspi-goals-synthesizer.md frontmatter — exact fields', () => {
  const keys = Object.keys(synthFM).sort();
  assert.deepEqual(keys, [...EXPECTED_FIELDS].sort());
});

test('qrspi-goals-synthesizer.md frontmatter — tools includes write and edit', () => {
  const tools = synthFM.tools;
  assert.ok(tools.includes('write'), 'tools should include write');
  assert.ok(tools.includes('edit'), 'tools should include edit');
});

test('qrspi-goals-synthesizer.md frontmatter — model field', () => {
  assert.equal(synthFM.model, 'deepseek-v4-pro');
});

test('qrspi-goals-synthesizer.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(synthFM.max_turns, 10), 40);
});

// ---------------------------------------------------------------------------
// qrspi-goals-reviewer.md — Frontmatter
// ---------------------------------------------------------------------------

test('qrspi-goals-reviewer.md frontmatter — exact fields', () => {
  const keys = Object.keys(reviewFM).sort();
  assert.deepEqual(keys, [...EXPECTED_FIELDS].sort());
});

test('qrspi-goals-reviewer.md frontmatter — tools field (read-only)', () => {
  assert.equal(reviewFM.tools, 'read, bash, grep, find, ls');
});

test('qrspi-goals-reviewer.md frontmatter — model field', () => {
  assert.equal(reviewFM.model, 'deepseek-v4-pro');
});

test('qrspi-goals-reviewer.md frontmatter — max_turns field', () => {
  assert.equal(parseInt(reviewFM.max_turns, 10), 20);
});

// ---------------------------------------------------------------------------
// qrspi-goals.md — Body: dispatch, question, and read conventions
// ---------------------------------------------------------------------------

test('qrspi-goals.md body — uses qrspi_dispatch (not task) for subagent dispatch', () => {
  assert.ok(
    orchBody.includes('qrspi_dispatch'),
    'body must contain qrspi_dispatch',
  );
  // Verify "task" is not used as a dispatch tool reference
  // "the task tool" and "via task" are opencode-isms that should not appear
  assert.ok(
    !orchBody.includes('the task tool'),
    'body must not contain "the task tool"',
  );
  assert.ok(
    !/via\s+task\b/i.test(orchBody),
    'body must not use "via task" as dispatch reference',
  );
});

test('qrspi-goals.md body — contains subagent_type: "qrspi-goals-synthesizer"', () => {
  assert.ok(orchBody.includes('subagent_type: "qrspi-goals-synthesizer"'));
});

test('qrspi-goals.md body — contains subagent_type: "qrspi-goals-reviewer"', () => {
  assert.ok(orchBody.includes('subagent_type: "qrspi-goals-reviewer"'));
});

test('qrspi-goals.md body — uses ask_user for human gate', () => {
  assert.ok(orchBody.includes('ask_user'), 'body must contain ask_user');
  // Verify "question" is not used as a standalone tool reference
  assert.ok(
    !orchBody.includes('the question tool'),
    'body must not reference "the question tool"',
  );
});

test('qrspi-goals.md body — uses Read not cat for artifact reads', () => {
  assert.ok(
    orchBody.includes('Read .pipeline/'),
    'body must contain "Read .pipeline/"',
  );
  assert.ok(
    !orchBody.includes('cat .pipeline/'),
    'body must not contain "cat .pipeline/"',
  );
});

// ---------------------------------------------------------------------------
// qrspi-goals.md — Body: full pipeline protocol
// ---------------------------------------------------------------------------

test('qrspi-goals.md body — contains Step A0 (Preserve Initial Requirements)', () => {
  assert.ok(orchBody.includes('Step A0'), 'body must contain Step A0 heading');
  assert.ok(
    orchBody.includes('requirements.md'),
    'body must reference requirements.md in Step A0',
  );
});

test('qrspi-goals.md body — contains Step A Interview Loop (A1 through A4)', () => {
  assert.ok(orchBody.includes('Step A1'), 'body must contain Step A1');
  assert.ok(orchBody.includes('Step A2'), 'body must contain Step A2');
  assert.ok(orchBody.includes('Step A3'), 'body must contain Step A3');
  assert.ok(orchBody.includes('Step A4'), 'body must contain Step A4');
});

test('qrspi-goals.md body — contains Step B (Dispatch Synthesizer)', () => {
  assert.ok(orchBody.includes('Step B'), 'body must contain Step B heading');
});

test('qrspi-goals.md body — contains Step C (Write Artifacts)', () => {
  assert.ok(orchBody.includes('Step C'), 'body must contain Step C heading');
  assert.ok(
    orchBody.includes('goals.md'),
    'body must reference goals.md in Step C',
  );
  assert.ok(
    orchBody.includes('config.md'),
    'body must reference config.md in Step C',
  );
});

test('qrspi-goals.md body — contains Step D (Checklist Review Loop) with 5-round cap', () => {
  assert.ok(orchBody.includes('Step D'), 'body must contain Step D heading');
  assert.ok(
    orchBody.includes('review_round'),
    'body must reference review_round',
  );
  assert.ok(
    orchBody.includes('goals-reviewer'),
    'body must reference goals-reviewer in Step D',
  );
  assert.ok(
    orchBody.includes('review_round < 5'),
    'body must reference review_round < 5 cap',
  );
  assert.ok(
    orchBody.includes('review_round = 5'),
    'body must reference review_round = 5 cap',
  );
  assert.ok(
    orchBody.includes('unclean-cap'),
    'body must reference unclean-cap terminal state',
  );
});

test('qrspi-goals.md body — Step D three-way loop decision text is fully specified', () => {
  // The loop decision section must contain all three branches explicitly
  assert.ok(
    orchBody.includes('PASS'),
    'Step D must reference PASS terminal state',
  );
  assert.ok(orchBody.includes('FAIL'), 'Step D must reference FAIL state');
  assert.ok(
    orchBody.includes('review_round < 5'),
    'Step D must specify re-dispatch condition (< 5)',
  );
  assert.ok(
    orchBody.includes('review_round = 5'),
    'Step D must specify cap hit condition (= 5)',
  );
  assert.ok(
    orchBody.includes('unclean-cap'),
    'Step D must reference unclean-cap terminal state',
  );
  // Verify the 3-way decision pattern: PASS stop, FAIL+<5 re-dispatch, FAIL+5 unclean-cap
  assert.ok(
    orchBody.includes('PASS') &&
      orchBody.includes('FAIL') &&
      orchBody.includes('unclean-cap'),
    'Step D must have 3-way decision: PASS → clean, FAIL+<5 → retry, FAIL+5 → unclean-cap',
  );
});

test('qrspi-goals.md body — contains Step E (Human Gate) with feedback loop', () => {
  assert.ok(orchBody.includes('Step E'), 'body must contain Step E heading');
  assert.ok(
    orchBody.includes('approve'),
    'body must mention approve flow in Step E',
  );
  assert.ok(
    orchBody.includes('feedback'),
    'body must reference feedback handling in Step E',
  );
});

test('qrspi-goals.md body — Step E feedback loop includes full orchestration substeps', () => {
  // Verify feedback file writing paths
  assert.ok(
    orchBody.includes('feedback/goals-round-'),
    'Step E must specify feedback file path with goals-round-{NN}.md',
  );
  assert.ok(
    orchBody.includes('mkdir -p') && orchBody.includes('feedback'),
    'Step E must create feedback directory',
  );
  // Verify requirements.md rebuild
  assert.ok(
    orchBody.includes('requirements.md'),
    'Step E must reference rebuilding requirements.md',
  );
  // Verify FEEDBACK HISTORY for re-dispatch
  assert.ok(
    orchBody.includes('FEEDBACK HISTORY'),
    'Step E must include FEEDBACK HISTORY section for synthesizer re-dispatch',
  );
  // Verify review_round reset after feedback
  assert.ok(
    orchBody.includes('review_round = 1') ||
      orchBody.includes('review_round=1'),
    'Step E must reset review_round to 1 after feedback',
  );
  // Verify re-dispatch of synthesizer
  assert.ok(
    orchBody.includes('qrspi-goals-synthesizer'),
    'Step E must re-dispatch qrspi-goals-synthesizer on feedback',
  );
});

test('qrspi-goals.md body — Step E pre-condition check guards against unclean-cap', () => {
  assert.ok(
    orchBody.includes('unclean-cap'),
    'body must contain unclean-cap guard term',
  );
  assert.ok(
    orchBody.includes('Pre-condition check'),
    'body must contain pre-condition check directive',
  );
  assert.ok(
    orchBody.includes('### Status — FAIL'),
    'body must contain unrecoverable FAIL return template',
  );
});

test('qrspi-goals.md body — Step E unclean-cap skip logic uses unrecoverable-failure template', () => {
  // Verify the actual skip instruction that prevents human gate when unclean-cap is hit
  assert.ok(
    orchBody.includes('skip this step entirely'),
    'Step E pre-condition must contain "skip this step entirely" directive for unclean-cap',
  );
  assert.ok(
    orchBody.includes('unrecoverable-failure'),
    'Step E must reference "unrecoverable-failure" template for unclean-cap skip path',
  );
  // Verify the pre-condition connects unclean-cap directly to skipping human gate
  assert.ok(
    orchBody.includes('unclean-cap') &&
      orchBody.includes('skip this step entirely'),
    'unclean-cap pre-condition must connect to skip directive',
  );
});

test('qrspi-goals.md body — contains Critical Rule directives', () => {
  assert.ok(
    orchBody.includes('No code edits'),
    'body must contain Critical Rule 1: No code edits',
  );
  assert.ok(
    orchBody.includes('End your turn'),
    'body must contain Critical Rule 3: End your turn',
  );
  assert.ok(
    orchBody.includes('Dispatch subagents directly'),
    'body must contain Critical Rule 2: Dispatch subagents directly',
  );
});

test('qrspi-goals.md body — Critical Rules include full sub-instruction text', () => {
  // Rule 1: No code edits + pipeline file restriction
  assert.ok(
    orchBody.includes('No code edits') &&
      orchBody.includes('Write only pipeline state files'),
    'Critical Rule 1 must include sub-instruction about pipeline state files',
  );
  // Rule 2: Dispatch subagents directly + handoff prohibition
  assert.ok(
    orchBody.includes('Dispatch subagents directly') &&
      orchBody.includes('Never describe a handoff in plain text'),
    'Critical Rule 2 must include sub-instruction about handoff prohibition',
  );
  // Rule 3: Stop after each subagent dispatch + end turn + wait
  assert.ok(
    orchBody.includes('Stop after each subagent dispatch') &&
      orchBody.includes('End your turn') &&
      orchBody.includes('wait for the response'),
    'Critical Rule 3 must include full stop-dispatch-wait sub-instructions',
  );
});

test('qrspi-goals.md body — contains core behavioral rules', () => {
  const coverageBranches = [
    'Problem and motivation',
    'Current behavior',
    'Constraints',
    'Non-goals',
    'Acceptance criteria',
    'Testing expectations',
    'Route and size',
  ];
  for (const branch of coverageBranches) {
    assert.ok(
      orchBody.includes(branch),
      `body must contain coverage branch: ${branch}`,
    );
  }

  assert.ok(
    orchBody.includes('12') && orchBody.includes('user-facing questions'),
    'body must contain 12-question stop condition',
  );

  assert.ok(
    orchBody.includes('Scope decomposition') ||
      orchBody.includes('scope decomposition'),
    'body must contain scope-decomposition trigger (A4.4)',
  );

  assert.ok(
    orchBody.includes('Pre-condition check') &&
      orchBody.includes('unclean-cap'),
    'body must contain Step E pre-condition check with unclean-cap guard',
  );

  assert.ok(
    orchBody.includes('PASS') &&
      orchBody.includes('FAIL') &&
      orchBody.includes('unclean-cap'),
    'body must contain Step D 3-way loop decision terms: PASS, FAIL, unclean-cap',
  );
});

test('qrspi-goals.md body — contains Return contract with required fields', () => {
  assert.ok(orchBody.includes('### Status'), 'body must contain Status field');
  assert.ok(
    orchBody.includes('### Files Written'),
    'body must contain Files Written field',
  );
  assert.ok(orchBody.includes('### Route'), 'body must contain Route field');
  assert.ok(
    orchBody.includes('### Summary'),
    'body must contain Summary field',
  );
  assert.ok(
    orchBody.includes('### Telemetry'),
    'body must contain Telemetry field',
  );
});

// ---------------------------------------------------------------------------
// qrspi-goals-synthesizer.md — Body: output format and rules
// ---------------------------------------------------------------------------

test('qrspi-goals-synthesizer.md body — specifies output sections ### goals.md and ### config.md', () => {
  assert.ok(
    synthBody.includes('### goals.md'),
    'body must contain ### goals.md output section',
  );
  assert.ok(
    synthBody.includes('### config.md'),
    'body must contain ### config.md output section',
  );
});

test('qrspi-goals-synthesizer.md body — goals.md structure contains all required sections', () => {
  assert.ok(
    synthBody.includes('## Intent'),
    'body must specify Intent section',
  );
  assert.ok(
    synthBody.includes('## Functional Requirements'),
    'body must specify Functional Requirements section',
  );
  assert.ok(
    synthBody.includes('## Non-Functional Requirements'),
    'body must specify Non-Functional Requirements section',
  );
  assert.ok(
    synthBody.includes('## Technical Specification'),
    'body must specify Technical Specification section',
  );
  assert.ok(
    synthBody.includes('## Constraints'),
    'body must specify Constraints section',
  );
  assert.ok(
    synthBody.includes('## Non-Goals'),
    'body must specify Non-Goals section',
  );
  assert.ok(
    synthBody.includes('## Acceptance Criteria'),
    'body must specify Acceptance Criteria section',
  );
});

test('qrspi-goals-synthesizer.md body — config.md structure contains required and optional fields', () => {
  assert.ok(synthBody.includes('created:'), 'body must specify created field');
  assert.ok(synthBody.includes('route:'), 'body must specify route field');
  assert.ok(synthBody.includes('run_id:'), 'body must specify run_id field');
  assert.ok(
    synthBody.includes('coverage_threshold:'),
    'body must reference optional coverage_threshold',
  );
  assert.ok(
    synthBody.includes('test_globs:'),
    'body must reference optional test_globs',
  );
});

test('qrspi-goals-synthesizer.md body — source authority: user-answer and user-confirmed-finding are authoritative', () => {
  assert.ok(
    synthBody.includes('user-answer') &&
      synthBody.includes('user-confirmed-finding'),
    'body must reference user-answer and user-confirmed-finding as authoritative',
  );
  assert.ok(
    synthBody.includes('authoritative') || synthBody.includes('Authoritative'),
    'body must state user-input-is-authoritative rule',
  );
});

test('qrspi-goals-synthesizer.md body — repo-finding must not appear in FR, Constraints, AC', () => {
  assert.ok(
    synthBody.includes('repo-finding'),
    'body must reference repo-finding',
  );
  // The critical rule: repo-finding excluded from requirement-bearing sections
  assert.ok(
    synthBody.includes('Functional Requirements') &&
      synthBody.includes('Constraints') &&
      synthBody.includes('Acceptance Criteria'),
    'prerequisite sections must be referenced',
  );
  // Verify the exclusion statement exists in proximity to repo-finding
  assert.ok(
    synthBody.includes('must not appear') ||
      synthBody.includes('not appear in') ||
      synthBody.includes('must not be in'),
    'body must contain exclusion rule for repo-finding',
  );
});

// ---------------------------------------------------------------------------
// qrspi-goals-reviewer.md — Body: review output format
// ---------------------------------------------------------------------------

test('qrspi-goals-reviewer.md body — specifies output sections', () => {
  assert.ok(
    reviewBody.includes('### Status — PASS or FAIL'),
    'body must contain Status header',
  );
  assert.ok(
    reviewBody.includes('### Review Findings'),
    'body must contain Review Findings header',
  );
  assert.ok(
    reviewBody.includes('### Fix Guidance'),
    'body must contain Fix Guidance header',
  );
  assert.ok(
    reviewBody.includes('### Summary'),
    'body must contain Summary header',
  );
});

test('qrspi-goals-reviewer.md body — Review Findings contains 9 check areas', () => {
  const checkAreas = [
    'Intent clarity',
    'FR completeness',
    'NFR specificity',
    'Constraint specificity',
    'Scope boundaries',
    'Acceptance testability',
    'Single-run scope',
    'Implicit assumptions',
    'Inference integrity',
  ];
  for (const area of checkAreas) {
    assert.ok(
      reviewBody.includes(area),
      `Review Findings must include: ${area}`,
    );
  }
});

test('qrspi-goals-reviewer.md body — Inference integrity check traces to user-answer/user-confirmed-finding', () => {
  // The inference integrity check must mention tracing to user-answer or user-confirmed-finding
  assert.ok(
    reviewBody.includes('Inference integrity'),
    'body must contain Inference integrity check',
  );
  assert.ok(
    reviewBody.includes('user-answer') ||
      reviewBody.includes('user-confirmed-finding'),
    'Inference integrity check must reference user-answer or user-confirmed-finding',
  );
});

// ---------------------------------------------------------------------------
// Cross-file: no opencode permission system references
// ---------------------------------------------------------------------------

test('Agents — no opencode permission system references in any agent file', () => {
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
    orchestrator: orchBody,
    synthesizer: synthBody,
    reviewer: reviewBody,
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
// Cross-file: model profile compliance
// ---------------------------------------------------------------------------

test('All Stage 1 agents use deepseek-v4-pro', () => {
  assert.equal(
    reviewFM.model,
    'deepseek-v4-pro',
    'reviewer must use deepseek-v4-pro',
  );
  assert.equal(
    orchFM.model,
    'deepseek-v4-pro',
    'orchestrator must use deepseek-v4-pro',
  );
  assert.equal(
    synthFM.model,
    'deepseek-v4-pro',
    'synthesizer must use deepseek-v4-pro',
  );
});

// ---------------------------------------------------------------------------
// Boundary: files exist and are parseable
// ---------------------------------------------------------------------------

test('Agents — all three agent files exist and have parseable frontmatter', () => {
  assert.ok(orchFM !== null, 'qrspi-goals.md has parseable frontmatter');
  assert.ok(
    synthFM !== null,
    'qrspi-goals-synthesizer.md has parseable frontmatter',
  );
  assert.ok(
    reviewFM !== null,
    'qrspi-goals-reviewer.md has parseable frontmatter',
  );
});
