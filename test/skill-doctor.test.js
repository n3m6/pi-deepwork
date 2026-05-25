const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const skillPath = path.join(
  projectRoot,
  'skills',
  'deepwork-doctor',
  'SKILL.md',
);

let skillContent;
try {
  skillContent = fs.readFileSync(skillPath, 'utf8');
} catch {
  skillContent = null;
}

test('deepwork-doctor SKILL.md exists at skills/deepwork-doctor/SKILL.md', () => {
  assert.ok(
    skillContent !== null,
    'deepwork-doctor SKILL.md must exist as a fallback when the registered /deepwork-doctor command is unavailable',
  );
  assert.ok(skillContent.length > 500, 'skill body must be substantive');
});

test('deepwork-doctor SKILL.md has YAML frontmatter with name: deepwork-doctor', () => {
  const trimmed = skillContent.trimStart();
  const frontmatterMatch = trimmed.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatterMatch, 'must start with YAML frontmatter');
  assert.match(frontmatterMatch[1], /^name:\s+deepwork-doctor$/m);
  assert.match(frontmatterMatch[1], /^description:\s+.+$/m);
});

test('deepwork-doctor SKILL.md is read-only and forbids touching .pi/agents/', () => {
  assert.match(
    skillContent,
    /read-only/i,
    'skill must declare itself read-only',
  );
  assert.ok(
    /Do not[\s\S]*?(mirror|copy|symlink)/i.test(skillContent),
    'skill must forbid mirroring/copying/symlinking under .pi/agents/',
  );
  assert.match(
    skillContent,
    /\.pi\/agents/,
    'skill must reference the .pi/agents/ directory it must not touch',
  );
});

test('deepwork-doctor SKILL.md includes the package-root discovery recipe', () => {
  assert.match(
    skillContent,
    /find ~\/\.pi.*pi-deepwork/,
    'skill must show the `find ~/.pi ... pi-deepwork` discovery command',
  );
});

test('deepwork-doctor SKILL.md checks for dist/index.js and proposes the build recovery command', () => {
  assert.match(
    skillContent,
    /dist\/index\.js/,
    'skill must check for dist/index.js',
  );
  assert.match(skillContent, /npm install/, 'skill must propose npm install');
  assert.match(
    skillContent,
    /npm run build/,
    'skill must propose npm run build',
  );
});

test('deepwork-doctor SKILL.md instructs the model to check subagent list for qrspi-* agents', () => {
  assert.match(
    skillContent,
    /subagent list/i,
    'skill must check subagent list',
  );
  assert.match(
    skillContent,
    /qrspi-/,
    'skill must reference qrspi-* agent prefix',
  );
});

test('deepwork-doctor SKILL.md forbids running the pipeline from inside the skill', () => {
  assert.ok(
    /do not[\s\S]*?(start a deepwork pipeline|run the pipeline|dispatch.*qrspi)/i.test(
      skillContent,
    ),
    'skill must explicitly forbid starting the pipeline itself',
  );
});

test('deepwork-doctor SKILL.md forbids writing the .pi/deepwork-doctor-report.md path owned by the registered command', () => {
  assert.ok(
    /Do not[\s\S]*?\.pi\/deepwork-doctor-report\.md/i.test(skillContent),
    'skill must not write to the report path owned by the registered command handler',
  );
});

test('deepwork-doctor SKILL.md produces a final fenced report block with the documented fields', () => {
  assert.match(
    skillContent,
    /extension_package_root:/,
    'report must include extension_package_root',
  );
  assert.match(
    skillContent,
    /extension_built:/,
    'report must include extension_built',
  );
  assert.match(skillContent, /root_cause:/, 'report must include root_cause');
  assert.match(skillContent, /recovery:/, 'report must include recovery');
});
