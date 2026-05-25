const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);

// --- package.json shape ---

test('package.json scripts.prepare runs "npm run build" so git-source installs build the extension automatically', () => {
  assert.equal(
    pkg.scripts && pkg.scripts.prepare,
    'npm run build',
    "scripts.prepare must be 'npm run build'; npm runs this after install from a git URL/tarball and before publish, ensuring dist/ exists",
  );
});

test('package.json "main" points at the root index.js stub, not directly at dist/', () => {
  assert.equal(
    pkg.main,
    'index.js',
    "main must be 'index.js' so the root stub can produce a loud error when dist/ is missing",
  );
});

test('package.json "files" array includes index.js, dist/, agents/, and skills/', () => {
  assert.ok(Array.isArray(pkg.files), 'files must be an array');
  for (const required of ['index.js', 'dist/', 'agents/', 'skills/']) {
    assert.ok(
      pkg.files.includes(required),
      `files array must include ${required}`,
    );
  }
});

// --- root index.js stub behavior ---

test('root index.js re-exports the same default activate function as dist/index.js when dist/ is present', () => {
  const distIndex = path.join(projectRoot, 'dist', 'index.js');
  assert.ok(
    fs.existsSync(distIndex),
    'dist/index.js must exist for this test (build runs before the test suite)',
  );

  // Drop module cache for both modules so we get fresh requires.
  delete require.cache[path.join(projectRoot, 'index.js')];
  delete require.cache[distIndex];

  const stubExports = require(path.join(projectRoot, 'index.js'));
  const distExports = require(distIndex);

  assert.equal(
    typeof stubExports.default,
    'function',
    'stub must expose default as a function (activate)',
  );
  assert.equal(
    stubExports.default,
    distExports.default,
    'stub default export must be the same function instance as dist/index.js default',
  );
});

test('root index.js throws a loud, actionable error when dist/index.js is missing', () => {
  // Copy the stub to a temp dir with no dist/, then spawn node to require it.
  // We do NOT touch the real dist/ — this test must be safe to run alongside
  // other tests that depend on dist/ being intact.
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pi-deepwork-stub-test-'),
  );
  try {
    const stubSrc = fs.readFileSync(path.join(projectRoot, 'index.js'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'index.js'), stubSrc, 'utf8');

    const result = spawnSync(
      process.execPath,
      ['-e', "require('./index.js')"],
      { cwd: tmpDir, encoding: 'utf8' },
    );

    assert.notEqual(
      result.status,
      0,
      'node must exit with non-zero status when dist/index.js is missing',
    );
    const combined = (result.stderr || '') + (result.stdout || '');
    assert.match(
      combined,
      /pi-deepwork/,
      "error must mention pi-deepwork so it's identifiable in pi's extension log",
    );
    assert.match(
      combined,
      /dist[/\\]index\.js/,
      'error must mention the missing dist/index.js path',
    );
    assert.match(
      combined,
      /npm install && npm run build/,
      'error must include the recovery command',
    );
    assert.match(
      combined,
      new RegExp(tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'error must include the package directory (__dirname) so the user knows where to cd',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('root index.js re-throws non-MODULE_NOT_FOUND errors from dist/ untouched', () => {
  // Simulate a dist/index.js that throws a SyntaxError-style error at require
  // time. We use a temp dir with a real dist/index.js that throws.
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'pi-deepwork-stub-test-'),
  );
  try {
    const stubSrc = fs.readFileSync(path.join(projectRoot, 'index.js'), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'index.js'), stubSrc, 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'dist'));
    fs.writeFileSync(
      path.join(tmpDir, 'dist', 'index.js'),
      "throw new Error('deliberate inner failure');\n",
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      ['-e', "require('./index.js')"],
      { cwd: tmpDir, encoding: 'utf8' },
    );

    assert.notEqual(result.status, 0);
    const combined = (result.stderr || '') + (result.stdout || '');
    assert.match(
      combined,
      /deliberate inner failure/,
      'stub must not swallow non-MODULE_NOT_FOUND errors',
    );
    assert.ok(
      !/npm install && npm run build/.test(combined),
      'stub must NOT mistake a genuine load error for a missing-dist error',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
