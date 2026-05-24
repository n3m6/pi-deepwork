const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

// --- Directory creation ---

test('skills/deepwork/ directory exists', () => {
  const stat = fs.statSync(path.join(projectRoot, 'skills', 'deepwork'));
  assert.ok(stat.isDirectory());
});

// --- Package identity ---

test('package.json name is pi-deepwork', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(pkg.name, 'pi-deepwork');
});

test('package.json description matches QRSPI spec', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(
    pkg.description,
    'QRSPI deepwork pipeline extension for pi — automated multi-stage agent orchestration via subagents',
  );
});

test('package.json pins the minimum compatible @tintinweb/pi-subagents peer version', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(
    pkg.peerDependencies && '@tintinweb/pi-subagents' in pkg.peerDependencies,
  );
  assert.equal(pkg.peerDependencies['@tintinweb/pi-subagents'], '>=0.7.3');
});

test('README documents flat pi-subagents agent discovery paths', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  assert.ok(readme.includes('~/.pi/agent/agents/'));
  assert.ok(readme.includes('.pi/agents/'));
  assert.ok(readme.includes('unknown agent type'));
  assert.ok(readme.includes('falls back to `general-purpose`'));
  assert.ok(
    readme.includes(
      'for file in "$(pwd)"/agents/*.md; do ln -sf "$file" ~/.pi/agent/agents/; done',
    ),
  );
  assert.ok(
    readme.includes(
      'Nested directories such as `.pi/agents/qrspi/` or `~/.pi/agent/agents/qrspi/` are not scanned.',
    ),
  );
  assert.ok(readme.includes('## Manual pi Smoke-Test Checklist'));
  assert.ok(readme.includes('qrspi_get_subagent_result'));
});

test('README keeps git install guidance aligned with the repo locator', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  assert.ok(readme.includes('pi install git:github.com/n3m6/pi-deepwork@main'));
  assert.ok(
    readme.includes(
      'The GitHub repository and `package.json` now both use `pi-deepwork`.',
    ),
  );
  assert.ok(readme.includes('~/.pi/agent/npm/node_modules/@n3m6/pi-deepwork/'));
  assert.ok(readme.includes('creates an npm-compatible compatibility install'));
});

test('package.json has test:watch script with correct value', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(
    pkg.scripts['test:watch'],
    'npm run build && tsc -p tsconfig.test.json && node --test --watch ./test/*.test.js ./dist/test/*.test.js ./dist/test/agents/*.test.js',
  );
});

test('package.json main entry is dist/index.js', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(pkg.main, 'dist/index.js');
});

test('package.json repository.url contains pi-deepwork', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(
    pkg.repository &&
      pkg.repository.url &&
      pkg.repository.url.includes('pi-deepwork'),
  );
});

test('package.json bugs.url contains pi-deepwork', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.bugs && pkg.bugs.url && pkg.bugs.url.includes('pi-deepwork'));
});

test('package.json homepage contains pi-deepwork', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.homepage && pkg.homepage.includes('pi-deepwork'));
});

// --- TypeScript config validity ---

test('tsconfig.json is valid strict JSON with no comments or trailing commas', () => {
  const raw = fs.readFileSync(path.join(projectRoot, 'tsconfig.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(typeof parsed === 'object');
  assert.equal(parsed.compilerOptions.module, 'commonjs');
  assert.equal(parsed.compilerOptions.target, 'es2020');
  assert.equal(parsed.compilerOptions.rootDir, 'src');
  assert.equal(parsed.compilerOptions.outDir, 'dist');
  assert.equal(parsed.compilerOptions.strict, true);
  assert.equal(parsed.compilerOptions.esModuleInterop, true);
  assert.equal(parsed.compilerOptions.declaration, true);
  assert.equal(parsed.compilerOptions.declarationMap, true);
  assert.equal(parsed.compilerOptions.sourceMap, true);
});

// --- DEEPWORK.md removal ---

test('DEEPWORK.md does not exist at project root', () => {
  const stats = fs.existsSync(path.join(projectRoot, 'DEEPWORK.md'));
  assert.equal(stats, false);
});

// --- .gitignore coverage ---

test('.gitignore contains .pipeline/ entry on its own line', () => {
  const content = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
  const lines = content.split('\n');
  assert.ok(
    lines.some((line) => line === '.pipeline/'),
    'Expected .gitignore to contain .pipeline/ as its own line',
  );
});

// --- Build output preservation ---

test('dist/index.js exists after TypeScript compilation', () => {
  assert.ok(fs.existsSync(path.join(projectRoot, 'dist', 'index.js')));
});

// --- Manifest validity ---

test('npm install --dry-run succeeds with no peer dependency errors', () => {
  execSync('npm install --dry-run', {
    cwd: projectRoot,
    stdio: 'pipe',
    timeout: 30000,
  });
});
