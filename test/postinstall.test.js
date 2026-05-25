'use strict';

// Tests for scripts/postinstall.mjs.
//
// The script is exercised as a subprocess so process.env reflects realistic
// install scenarios. Each test uses an isolated mkdtemp sandbox and never
// touches the real ~/.pi/.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..');
const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'postinstall.mjs');

let sandbox;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-deepwork-postinstall-'));
});

afterEach(() => {
  try { fs.chmodSync(path.join(sandbox, 'ro'), 0o700); } catch { /* not present */ }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function fakeClone(parentDir, opts = {}) {
  const agentNames = opts.agentNames || ['qrspi-alpha.md', 'qrspi-beta.md'];
  const pkgRoot = path.join(parentDir, 'github.com', 'n3m6', 'pi-deepwork');
  fs.mkdirSync(path.join(pkgRoot, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(pkgRoot, 'scripts'), { recursive: true });
  for (const name of agentNames) {
    fs.writeFileSync(path.join(pkgRoot, 'agents', name), `---\nname: ${name}\n---\nbody\n`);
  }
  fs.cpSync(REAL_SCRIPT, path.join(pkgRoot, 'scripts', 'postinstall.mjs'));
  return pkgRoot;
}

function runScript(pkgRoot, env = {}) {
  return spawnSync(process.execPath, [path.join(pkgRoot, 'scripts', 'postinstall.mjs')], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

function listSymlinks(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => {
    try { return fs.lstatSync(path.join(dir, name)).isSymbolicLink(); }
    catch { return false; }
  });
}

describe('postinstall.mjs', () => {
  it('no-ops when not inside a pi clone (gate)', () => {
    const pkgRoot = fakeClone(path.join(sandbox, 'random', 'place'));
    const agentDir = path.join(sandbox, 'agent-dir');

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(agentDir, 'agents')), false);
    assert.equal(result.stdout.trim(), '', 'should print nothing');
  });

  it('global scope: links into $PI_CODING_AGENT_DIR/agents', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    const targetDir = path.join(agentDir, 'agents');
    const links = listSymlinks(targetDir).sort();
    assert.deepEqual(links, ['qrspi-alpha.md', 'qrspi-beta.md']);
    for (const name of links) {
      const linkPath = path.join(targetDir, name);
      const expectedTarget = path.join(pkgRoot, 'agents', name);
      assert.equal(fs.realpathSync(linkPath), fs.realpathSync(expectedTarget));
    }
    assert.match(result.stdout, /linked 2 qrspi-\* agents into/);
  });

  it('project scope: links into <workspace>/.pi/agents', () => {
    const workspace = path.join(sandbox, 'workspace');
    const pkgRoot = fakeClone(path.join(workspace, '.pi', 'git'));

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: '' });

    assert.equal(result.status, 0, result.stderr);
    const targetDir = path.join(workspace, '.pi', 'agents');
    const links = listSymlinks(targetDir).sort();
    assert.deepEqual(links, ['qrspi-alpha.md', 'qrspi-beta.md']);
    assert.ok(result.stdout.includes(targetDir), `stdout should mention ${targetDir}; got: ${result.stdout}`);
  });

  it('is idempotent — running twice yields the same links', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');

    runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });
    const before = listSymlinks(path.join(agentDir, 'agents')).sort();
    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });
    const after = listSymlinks(path.join(agentDir, 'agents')).sort();

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(after, before);
    assert.deepEqual(after, ['qrspi-alpha.md', 'qrspi-beta.md']);
    assert.match(result.stdout, /linked 2 qrspi-\* agents/);
  });

  it('self-cleans broken qrspi-* symlinks, stale files, and foreign-clone symlinks', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');
    const targetDir = path.join(agentDir, 'agents');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.symlinkSync(path.join(sandbox, 'nowhere', 'missing.md'), path.join(targetDir, 'qrspi-broken.md'));
    fs.writeFileSync(path.join(targetDir, 'qrspi-stale.md'), 'stale');
    const foreignClone = fakeClone(path.join(sandbox, 'foreign', '.pi', 'agent', 'git'));
    fs.symlinkSync(path.join(foreignClone, 'agents', 'qrspi-alpha.md'), path.join(targetDir, 'qrspi-foreign.md'));

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    const remaining = fs.readdirSync(targetDir).sort();
    assert.deepEqual(remaining, ['qrspi-alpha.md', 'qrspi-beta.md']);
  });

  it('leaves non-qrspi files in the target dir untouched', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');
    const targetDir = path.join(agentDir, 'agents');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'other.md'), 'keep me');
    fs.writeFileSync(path.join(targetDir, 'notes.txt'), 'also keep me');

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    const remaining = fs.readdirSync(targetDir).sort();
    assert.deepEqual(remaining, ['notes.txt', 'other.md', 'qrspi-alpha.md', 'qrspi-beta.md']);
  });

  it('fails open when the target dir cannot be created (read-only parent)', { skip: process.getuid && process.getuid() === 0 ? 'requires non-root' : false }, () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const readOnlyParent = path.join(sandbox, 'ro');
    fs.mkdirSync(readOnlyParent, { recursive: true });
    fs.chmodSync(readOnlyParent, 0o500);
    const agentDir = path.join(readOnlyParent, 'agent-dir');

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    fs.chmodSync(readOnlyParent, 0o700);
    assert.equal(result.status, 0, 'must exit 0 even when filesystem mutation fails');
    assert.match(result.stderr + result.stdout, /pi-deepwork/);
  });

  it('global scope: plants the npm-path alias symlink at <agent_root>/npm/node_modules/@n3m6/pi-deepwork', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    const aliasPath = path.join(agentDir, 'npm', 'node_modules', '@n3m6', 'pi-deepwork');
    assert.equal(fs.lstatSync(aliasPath).isSymbolicLink(), true, `${aliasPath} should be a symlink`);
    assert.equal(fs.realpathSync(aliasPath), fs.realpathSync(pkgRoot));
    // The skill body must be readable through the alias path pi templates from.
    const skillStub = path.join(pkgRoot, 'skills', 'deepwork', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillStub), { recursive: true });
    fs.writeFileSync(skillStub, 'stub');
    const viaAlias = path.join(aliasPath, 'skills', 'deepwork', 'SKILL.md');
    assert.equal(fs.readFileSync(viaAlias, 'utf8'), 'stub');
    assert.match(result.stdout, /aliased .+@n3m6\/pi-deepwork -> /);
  });

  it('npm alias is idempotent — running twice keeps the same symlink target', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');

    runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });
    const aliasPath = path.join(agentDir, 'npm', 'node_modules', '@n3m6', 'pi-deepwork');
    const firstTarget = fs.realpathSync(aliasPath);
    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.lstatSync(aliasPath).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(aliasPath), firstTarget);
  });

  it('npm alias: leaves a pre-existing real directory at the alias path untouched', () => {
    const pkgRoot = fakeClone(path.join(sandbox, '.pi', 'agent', 'git'));
    const agentDir = path.join(sandbox, 'custom-agent-dir');
    const aliasPath = path.join(agentDir, 'npm', 'node_modules', '@n3m6', 'pi-deepwork');
    fs.mkdirSync(aliasPath, { recursive: true });
    fs.writeFileSync(path.join(aliasPath, 'package.json'), '{"name":"manual"}');

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: agentDir });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.lstatSync(aliasPath).isDirectory(), true, 'alias path must still be a real directory');
    assert.equal(fs.readFileSync(path.join(aliasPath, 'package.json'), 'utf8'), '{"name":"manual"}');
    assert.match(result.stderr + result.stdout, /leaving untouched/);
  });

  it('project scope: does NOT plant the npm-path alias', () => {
    const workspace = path.join(sandbox, 'workspace');
    const pkgRoot = fakeClone(path.join(workspace, '.pi', 'git'));

    const result = runScript(pkgRoot, { PI_CODING_AGENT_DIR: '' });

    assert.equal(result.status, 0, result.stderr);
    // No npm alias should appear anywhere under the workspace.
    const projectAlias = path.join(workspace, '.pi', 'npm', 'node_modules', '@n3m6', 'pi-deepwork');
    assert.equal(fs.existsSync(projectAlias), false);
    assert.doesNotMatch(result.stdout, /aliased/);
  });
});
