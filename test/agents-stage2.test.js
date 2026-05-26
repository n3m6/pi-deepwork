const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(projectRoot, 'agents');
const INTERCOM_EXTENSION = '~/.pi/agent/npm/node_modules/pi-intercom/index.ts';

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

const REQUIRED_FIELDS = [
  'description',
  'tools',
  'model',
  'thinking',
  'max_turns',
  'extensions',
  'name',
  'systemPromptMode',
];

const STAGE2_AGENTS = [
  {
    file: 'qrspi-questions.md',
    name: 'qrspi-questions',
    tools: 'subagent, read, bash, grep, find, ls, write, edit',
    extensions: INTERCOM_EXTENSION,
  },
  {
    file: 'qrspi-question-generator.md',
    name: 'qrspi-question-generator',
    tools: 'read, bash, grep, find, ls, write, edit',
    extensions: '',
  },
  {
    file: 'qrspi-question-leakage-reviewer.md',
    name: 'qrspi-question-leakage-reviewer',
    tools: 'read, bash, grep, find, ls',
    extensions: '',
  },
  {
    file: 'qrspi-question-quality-reviewer.md',
    name: 'qrspi-question-quality-reviewer',
    tools: 'read, bash, grep, find, ls',
    extensions: '',
  },
  {
    file: 'qrspi-research.md',
    name: 'qrspi-research',
    tools: 'subagent, read, bash, grep, find, ls, write, edit',
    extensions: INTERCOM_EXTENSION,
  },
  {
    file: 'qrspi-research-pass.md',
    name: 'qrspi-research-pass',
    tools: 'subagent, read, bash, grep, find, ls, write, edit',
    extensions: '',
  },
  {
    file: 'qrspi-codebase-researcher.md',
    name: 'qrspi-codebase-researcher',
    tools: 'read, bash, grep, find, ls',
    extensions: '',
  },
  {
    file: 'qrspi-web-researcher.md',
    name: 'qrspi-web-researcher',
    tools: 'read, bash',
    extensions: '',
  },
  {
    file: 'qrspi-research-synthesizer.md',
    name: 'qrspi-research-synthesizer',
    tools: 'read, bash, grep, find, ls, write, edit',
    extensions: '',
  },
  {
    file: 'qrspi-research-reviewer.md',
    name: 'qrspi-research-reviewer',
    tools: 'read, bash, grep, find, ls',
    extensions: '',
  },
];

for (const agent of STAGE2_AGENTS) {
  const filePath = path.join(agentsDir, agent.file);
  const fm = parseFrontmatter(filePath);

  test(`${agent.file} frontmatter parses`, () => {
    assert.ok(fm !== null, `${agent.file} has parseable frontmatter`);
  });

  test(`${agent.file} frontmatter has required fields`, () => {
    assert.deepEqual(Object.keys(fm).sort(), [...REQUIRED_FIELDS].sort());
  });

  test(`${agent.file} frontmatter name matches file`, () => {
    assert.equal(fm.name, agent.name);
  });

  test(`${agent.file} frontmatter uses expected tools`, () => {
    assert.equal(fm.tools, agent.tools);
  });

  test(`${agent.file} frontmatter uses expected model`, () => {
    assert.equal(fm.model, 'deepseek-v4-pro');
  });

  test(`${agent.file} frontmatter uses expected thinking level`, () => {
    assert.equal(fm.thinking, 'high');
  });

  test(`${agent.file} frontmatter uses expected extensions`, () => {
    assert.equal(fm.extensions, agent.extensions);
  });

  test(`${agent.file} frontmatter pins replace system prompt mode`, () => {
    assert.equal(fm.systemPromptMode, 'replace');
  });
}