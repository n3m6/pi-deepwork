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

// Nested dispatchers that must use direct subagent(...) calls.
const DISPATCHERS = [
  'qrspi-goals.md',
  'qrspi-questions.md',
  'qrspi-research.md',
  'qrspi-design.md',
  'qrspi-structure.md',
  'qrspi-plan.md',
  'qrspi-implement.md',
  'qrspi-fast-impl-loop.md',
  'qrspi-accept.md',
  'qrspi-acceptance-tester.md',
  'qrspi-replan.md',
  'qrspi-verify.md',
  'qrspi-report.md',
  'qrspi-research-pass.md',
];

// Known valid qrspi child-agent values used in direct subagent payloads.
const KNOWN_AGENTS = [
  'qrspi-goals-synthesizer',
  'qrspi-goals-reviewer',
  'qrspi-question-generator',
  'qrspi-question-leakage-reviewer',
  'qrspi-question-quality-reviewer',
  'qrspi-questions',
  'qrspi-research-pass',
  'qrspi-codebase-researcher',
  'qrspi-web-researcher',
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
];

for (const agentFile of DISPATCHERS) {
  const body = readBody(agentFile);

  test(`${agentFile} — contains direct subagent call`, () => {
    assert.ok(
      body.includes('subagent({'),
      `${agentFile} must contain subagent({ for direct nested dispatch`,
    );
  });

  test(`${agentFile} — does not contain old bridge strings`, () => {
    assert.ok(!body.includes('spawn_request'), `${agentFile} must not contain spawn_request`);
    assert.ok(!body.includes('spawn_poll'), `${agentFile} must not contain spawn_poll`);
    assert.ok(!body.includes('get_subagent_result'), `${agentFile} must not contain get_subagent_result`);
    assert.ok(!body.includes('subagent_type:'), `${agentFile} must not contain subagent_type dispatch`);
  });

  test(`${agentFile} — at least one known agent in subagent payload`, () => {
    const hasKnownAgent = KNOWN_AGENTS.some(
      (agent) => body.includes(`agent: "${agent}"`),
    );
    assert.ok(
      hasKnownAgent,
      `${agentFile} must reference at least one known agent in a subagent payload`,
    );
  });
}
