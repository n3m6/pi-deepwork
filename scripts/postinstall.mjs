#!/usr/bin/env node
/**
 * pi-deepwork postinstall hook.
 *
 * Pi auto-discovers `skills/` of an installed pi package but not `agents/`.
 * pi-subagents only scans `<workspace>/.pi/agents/` and
 * `$PI_CODING_AGENT_DIR/agents/` (default `~/.pi/agent/agents/`). This
 * script bridges the gap by symlinking the bundled `agents/qrspi-*.md`
 * files into whichever scan dir matches the install scope.
 *
 * Heavily gated: runs only when the package lives under a path that
 * contains a `.pi/agent/git/` (global install) or `.pi/git/` (project
 * install) segment. In any other context (e.g. a curious clone someone
 * `npm install`s manually) it exits 0 without touching the filesystem.
 *
 * Fails open: any unexpected error becomes a single `console.warn` line
 * and exits 0, so `pi install` is never aborted by this hook.
 *
 * Owns the `qrspi-*.md` filename prefix inside the target dir: prunes
 * broken symlinks and stale files matching that glob before relinking.
 * Other filenames are never touched.
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_GLOB = /^qrspi-.+\.md$/;

function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const packageRoot = resolve(dirname(scriptPath), "..");
  const agentsSrcDir = join(packageRoot, "agents");

  if (!existsSync(agentsSrcDir)) {
    // Not our layout. Nothing to do.
    return;
  }

  const scope = detectScope(packageRoot);
  if (!scope) {
    // Gate: not running from inside a pi clone. No-op.
    return;
  }

  const targetDir = resolveTargetDir(scope, packageRoot);
  if (!targetDir) {
    console.warn(`pi-deepwork: could not resolve agents target dir for ${scope.kind} scope; skipping`);
    return;
  }

  mkdirSync(targetDir, { recursive: true });

  pruneOwnedEntries(targetDir, packageRoot);

  const linked = linkAgents(agentsSrcDir, targetDir);

  console.log(`pi-deepwork: linked ${linked} qrspi-* agents into ${targetDir}`);
}

/**
 * Walk the path's ancestors looking for a `.pi/agent/git/` (global) or
 * `.pi/git/` (project) marker. Returns the matched scope plus the
 * absolute path of the directory immediately containing the marker
 * (i.e. the parent of `.pi/`), so the project scope can recover the
 * workspace root.
 */
function detectScope(startDir) {
  const parts = resolve(startDir).split(sep);
  for (let i = 0; i + 2 < parts.length; i++) {
    if (parts[i] === ".pi" && parts[i + 1] === "agent" && parts[i + 2] === "git") {
      return { kind: "global", anchor: parts.slice(0, i).join(sep) || sep };
    }
    if (parts[i] === ".pi" && parts[i + 1] === "git") {
      return { kind: "project", anchor: parts.slice(0, i).join(sep) || sep };
    }
  }
  return undefined;
}

function resolveTargetDir(scope, _packageRoot) {
  if (scope.kind === "global") {
    const envDir = process.env.PI_CODING_AGENT_DIR;
    if (envDir && envDir.trim()) {
      return join(envDir, "agents");
    }
    return join(homedir(), ".pi", "agent", "agents");
  }
  // Project scope: workspace root is the parent of `.pi/`, which is `scope.anchor`.
  return join(scope.anchor, ".pi", "agents");
}

/**
 * Remove any `qrspi-*.md` entry in the target dir that is either broken
 * (target missing) or does not resolve into the current package root.
 * Leaves anything that doesn't match the prefix untouched.
 */
function pruneOwnedEntries(targetDir, packageRoot) {
  let entries;
  try {
    entries = readdirSync(targetDir);
  } catch {
    return;
  }
  const packageRootResolved = realpathSafe(packageRoot) ?? resolve(packageRoot);
  for (const name of entries) {
    if (!AGENT_GLOB.test(name)) continue;
    const entryPath = join(targetDir, name);
    let st;
    try {
      st = lstatSync(entryPath);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      const real = realpathSafe(entryPath);
      if (real == null) {
        // Broken symlink.
        safeUnlink(entryPath);
        continue;
      }
      if (!isInside(real, packageRootResolved)) {
        // Symlink owned by a different pi-deepwork clone (stale install).
        safeUnlink(entryPath);
      }
      continue;
    }
    // Regular file (or anything non-symlink) matching qrspi-*.md is stale.
    safeUnlink(entryPath);
  }
}

function linkAgents(agentsSrcDir, targetDir) {
  let files;
  try {
    files = readdirSync(agentsSrcDir).filter((f) => AGENT_GLOB.test(f));
  } catch (err) {
    console.warn(`pi-deepwork: cannot read ${agentsSrcDir}: ${err.message}`);
    return 0;
  }
  let linked = 0;
  for (const name of files) {
    const src = join(agentsSrcDir, name);
    const dest = join(targetDir, name);
    try {
      if (existsSync(dest) || isLstatSymlink(dest)) {
        safeUnlink(dest);
      }
      symlinkSync(src, dest);
      linked++;
    } catch (err) {
      console.warn(`pi-deepwork: could not link ${name}: ${err.message}`);
    }
  }
  return linked;
}

function realpathSafe(p) {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

function safeUnlink(p) {
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function isLstatSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

try {
  main();
} catch (err) {
  console.warn(`pi-deepwork: postinstall hook failed: ${err?.message ?? err}`);
}
