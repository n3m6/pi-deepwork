'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(projectRoot, 'agents');

function readBody(name) {
  const filePath = path.join(agentsDir, name);
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let closeIdx = -1;
  let dashesSeen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      dashesSeen++;
      if (dashesSeen === 2) { closeIdx = i; break; }
    }
  }
  return closeIdx === -1 ? raw : lines.slice(closeIdx + 1).join('\n');
}

// All nested dispatchers that must use spawn_request/spawn_poll
const DISPATCHERS = [
  'qrspi-goals.md',
  'qrspi-questions.md',
  'qrspi-research.md',
  'qrspi-design.md',
  'qrspi-structure.md',
  'qrspi-plan.md',
  'qrspi-implement.md',
  'qrspi-fast-impl-loop.md',
  'qrspi-fast-impl-code.md',
  'qrspi-accept.md',
  'qrspi-acceptance-tester.md',
  'qrspi-replan.md',
  'qrspi-verify.md',
  'qrspi-report.md',
];

// Known valid subagent_type values used in spawn payloads
const KNOWN_SUBTYPES = [
  'qrspi-goals-synthesizer',
  'qrspi-goals-reviewer',
  'qrspi-question-generator',
  'qrspi-question-leakage-reviewer',
  'qrspi-question-quality-reviewer',
  'qrspi-questions',
  'qrspi-research-pass',
  'qrspi-research-synthesizer',
  'qrspi-research-reviewer',
  'qrspi-design-synthesizer',
  'qrspi-design-reviewer',
  'qrspi-structure-mapper',
  'qrspi-structure-reviewer',
  'qrspi-plan-writer',
  'qrspi-plan-reviewer',
  'qrspi-task-spec-writer',
  'qrspi-task-spec-reviewer',
  'qrspi-baseline-checker',
  'qrspi-fast-impl-loop',
  'qrspi-fast-impl-code',
  'qrspi-fast-impl-test',
  'qrspi-fast-impl-verify',
  'qrspi-e2e-regression-checker',
  'qrspi-integration-checker',
  'qrspi-baseline-regression-checker',
  'qrspi-acceptance-tester',
  'qrspi-backward-loop-detector',
  'qrspi-coverage-planner',
  'qrspi-review-accept-goal-traceability',
  'qrspi-review-accept-spec',
  'qrspi-review-accept-code-quality',
  'qrspi-replan-writer',
  'qrspi-replan-reviewer',
  'qrspi-verifier',
  'qrspi-reporter',
  'general-purpose',
];

for (const agentFile of DISPATCHERS) {
  const body = readBody(agentFile);

  test(`${agentFile} — contains reason: "spawn_request"`, () => {
    assert.ok(
      body.includes('reason: "spawn_request"'),
      `${agentFile} must contain reason: "spawn_request" for nested dispatch`,
    );
  });

  test(`${agentFile} — contains bash sleep for polling cadence`, () => {
    assert.ok(
      /bash sleep \d+/.test(body),
      `${agentFile} must contain a bash sleep <N> polling cadence`,
    );
  });

  test(`${agentFile} — at least one known subagent_type in spawn payload`, () => {
    const hasKnownSubtype = KNOWN_SUBTYPES.some(
      (st) => body.includes(`subagent_type: "${st}"`),
    );
    assert.ok(
      hasKnownSubtype,
      `${agentFile} must reference at least one known subagent_type in a spawn payload`,
    );
  });
}
