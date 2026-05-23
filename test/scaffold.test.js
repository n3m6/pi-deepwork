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

test('package.json name is deepwork-pi', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(pkg.name, 'deepwork-pi');
});

test('package.json description matches QRSPI spec', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(
    pkg.description,
    'QRSPI deepwork pipeline extension for pi — automated multi-stage agent orchestration via subagents'
  );
});

test('package.json has @tintinweb/pi-subagents as peer dependency', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.peerDependencies && '@tintinweb/pi-subagents' in pkg.peerDependencies);
});

test('package.json has test:watch script with correct value', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(
    pkg.scripts['test:watch'],
    'npm run build && node --test --watch ./test/**/*.test.js'
  );
});

test('package.json main entry is dist/index.js', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.equal(pkg.main, 'dist/index.js');
});

test('package.json repository.url contains deepwork-pi', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.repository && pkg.repository.url && pkg.repository.url.includes('deepwork-pi'));
});

test('package.json bugs.url contains deepwork-pi', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.bugs && pkg.bugs.url && pkg.bugs.url.includes('deepwork-pi'));
});

test('package.json homepage contains deepwork-pi', () => {
  const pkg = require(path.join(projectRoot, 'package.json'));
  assert.ok(pkg.homepage && pkg.homepage.includes('deepwork-pi'));
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
    lines.some(line => line === '.pipeline/'),
    'Expected .gitignore to contain .pipeline/ as its own line'
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
    timeout: 30000
  });
});
