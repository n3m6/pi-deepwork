'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const skillPath = path.join(projectRoot, 'skills', 'deepwork', 'SKILL.md');

let skillRaw;
let skillBody;
let skillFrontmatter;

test('SKILL.md exists and is non-empty', () => {
  assert.ok(fs.existsSync(skillPath), `expected SKILL.md at ${skillPath}`);
  skillRaw = fs.readFileSync(skillPath, 'utf8');
  assert.ok(skillRaw.trim().length > 0, 'SKILL.md must not be empty');
});

test('SKILL.md has YAML frontmatter with name and description', () => {
  const lines = skillRaw.split('\n');
  let open = -1;
  let close = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (open === -1) open = i;
      else { close = i; break; }
    }
  }
  assert.notStrictEqual(open, -1, 'missing opening ---');
  assert.notStrictEqual(close, -1, 'missing closing ---');

  skillFrontmatter = {};
  for (let i = open + 1; i < close; i++) {
    const idx = lines[i].indexOf(':');
    if (idx === -1) continue;
    const key = lines[i].slice(0, idx).trim();
    const val = lines[i].slice(idx + 1).trim();
    if (key) skillFrontmatter[key] = val;
  }
  skillBody = lines.slice(close + 1).join('\n');

  assert.strictEqual(skillFrontmatter.name, 'deepwork', 'name must be "deepwork"');
  assert.ok(skillFrontmatter.description && skillFrontmatter.description.length > 10,
    'description must be present and non-trivial');
});

test('SKILL.md contains the required top-level headers', () => {
  const required = [
    '### CRITICAL RULES',
    '### Pre-Flight',
    '### Stage 1 — Goals',
    '### Stage 2 — Research',
    '### Stage 5 — Plan',
    '### Resume Mode',
  ];
  for (const h of required) {
    assert.ok(skillBody.includes(h), `missing header: ${h}`);
  }
});

test('SKILL.md uses the native Agent tool with subagent_type for dispatch', () => {
  assert.ok(/native Agent tool/i.test(skillBody),
    'SKILL.md must dispatch via the native Agent tool');
  assert.ok(/subagent_type:\s*"qrspi-/.test(skillBody),
    'SKILL.md must reference qrspi-* via subagent_type');
});

test('SKILL.md uses ask_user with required parameters', () => {
  assert.ok(/ask_user/.test(skillBody), 'must reference ask_user');
  assert.ok(/allowFreeform/.test(skillBody), 'ask_user calls must specify allowFreeform');
  assert.ok(/displayMode/.test(skillBody), 'ask_user calls must specify displayMode');
});

test('SKILL.md does NOT reference legacy/deprecated tools or paths', () => {
  const forbidden = [
    // deprecated tool names
    /\btask\s*\(/,
    /\btodowrite\b/i,
    /\bquestion\s*\(/,
    /permission\./i,
    /\bprotocol\//,
    // old extension surface
    /sendUserMessage/,
    /skill-compat/,
    /bootstrap\.json/i,
    /Extension recovery recipe/i,
    /Extension-Scaffolded Handoff/,
    /=== RUNTIME DISCOVERY ===/,
    /=== NEXT DISPATCH ===/,
    /\/deepwork-doctor/,
    // build/install artifacts that no longer exist
    /\bdist\//,
    /\btsc\b/,
    /--omit=dev/,
    /npm run build/,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(skillBody), `SKILL.md must not contain ${re}`);
  }
});

test('SKILL.md Pre-Flight Step 0 documents the install verification recipe', () => {
  assert.ok(/Install verification recipe/i.test(skillBody),
    'Pre-Flight Step 0 must reference the install verification recipe');
  assert.ok(/git clone https:\/\/github\.com\/n3m6\/pi-deepwork/.test(skillBody),
    'recipe must contain the git clone command');
  assert.ok(/~\/.pi\/agent\/agents/.test(skillBody),
    'recipe must target ~/.pi/agent/agents');
  assert.ok(/ln -sf.*qrspi-\*\.md/.test(skillBody),
    'recipe must symlink qrspi-*.md');
});

test('SKILL.md generates run IDs via date +%Y%m%d-%H%M%S', () => {
  assert.ok(/date \+%Y%m%d-%H%M%S/.test(skillBody),
    'run ID generation must use `date +%Y%m%d-%H%M%S`');
  assert.ok(/qrspi-<run-id>|qrspi-<timestamp>/.test(skillBody),
    'run IDs must be namespaced under qrspi-');
});

test('SKILL.md writes pipeline state under .pipeline/qrspi-<run-id>/', () => {
  assert.ok(/\.pipeline\/qrspi-<run-id>\//.test(skillBody),
    'state must live under .pipeline/qrspi-<run-id>/');
  assert.ok(/telemetry\/events\.jsonl/.test(skillBody),
    'telemetry stream path must be telemetry/events.jsonl');
  assert.ok(/state\.md/.test(skillBody), 'must reference state.md');
});

test('SKILL.md documents inbound intercom forwarding', () => {
  assert.ok(/contact_supervisor/.test(skillBody),
    'SKILL.md must reference contact_supervisor for inbound forwarding rule');
  assert.ok(/intercom\(\{ action: "reply"/.test(skillBody),
    'SKILL.md must reference intercom({ action: "reply" ... }) for replying to child asks');
  assert.ok(/responses/.test(skillBody),
    'SKILL.md intercom reply must include responses shape');
});

test('SKILL.md documents the spawn_request handle protocol', () => {
  assert.ok(/reason: "spawn_request"/.test(skillBody),
    'SKILL.md Rule 7 must handle reason: "spawn_request"');
  assert.ok(/reason: "spawn_poll"/.test(skillBody),
    'SKILL.md Rule 7 must handle reason: "spawn_poll"');
  assert.ok(/ok: true/.test(skillBody) || /"ok":.*true/.test(skillBody),
    'SKILL.md spawn_request reply must include ok: true');
  assert.ok(/handle/.test(skillBody),
    'SKILL.md spawn_request reply must include handle field');
  assert.ok(/spawn\.requested/.test(skillBody),
    'SKILL.md telemetry event types must include spawn.requested');
});

test('SKILL.md preflight checks pi-intercom connectivity', () => {
  assert.ok(/intercom\(\{ action: "status"/.test(skillBody),
    'SKILL.md Pre-Flight must verify pi-intercom via intercom({ action: "status" })');
});
