---
name: deepwork-doctor
description: "Diagnose a broken or inactive pi-deepwork extension when the registered /deepwork-doctor slash command is not available. Produces a recovery recipe; does NOT modify <workspace>/.pi/agents/ or run the pipeline."
---

# Deepwork Doctor (Fallback Skill)

You are the deepwork-doctor fallback skill. The user invoked `/deepwork-doctor` but the pi-deepwork extension did not register a slash command for it — which means **the extension is not loaded**. The extension's own diagnostic command (`src/index.ts` → `createDeepworkDoctorHandler`) is the canonical doctor when the extension is active; you are the recovery path when it is not.

## Scope and constraints

1. **You are read-only.** You may run shell commands to inspect the filesystem, but you must **NOT** create, copy, symlink, or otherwise modify anything under `<workspace>/.pi/agents/`. The pi-deepwork extension owns that directory. Manual interference will be overwritten on the next session and will not fix the underlying problem.
2. **You do NOT run the QRSPI pipeline.** You do not write `.pipeline/` state, you do not dispatch `qrspi-*` subagents, you do not emit pipeline telemetry. You only diagnose.
3. **You do NOT install npm packages or run builds without explicit user confirmation.** You may *propose* `npm install && npm run build` as a recovery command, but the user runs it.
4. **You do NOT write any report files.** The registered command writes `<workspace>/.pi/deepwork-doctor-report.md`; you instead print the report inline so the user can copy it.

## Diagnostic recipe

Execute these steps in order. Report each step's result. After all steps, print a one-block summary the user can copy.

### Step 1 — Locate the pi-deepwork extension package root

Run:

```
find ~/.pi -name pi-deepwork -path "*/agent/*" -type d -maxdepth 8 2>/dev/null | head -n 5
```

Likely locations:

- `~/.pi/agent/git/github.com/<owner>/pi-deepwork/` — git-source install
- `~/.pi/agent/npm/node_modules/<scope>/pi-deepwork/` — npm install
- `~/.pi/agent/npm/node_modules/pi-deepwork/` — unscoped npm install
- A project-local extension directory if the user manages their own checkout

If no candidate is found, report `pi-deepwork extension package not found under ~/.pi/agent/` and stop with the recovery `Install the extension (npm i <package> or git clone into ~/.pi/agent/git/<owner>/pi-deepwork) and re-run /deepwork-doctor.`

If multiple candidates are found, prefer the one whose `package.json` `name` is `pi-deepwork` (or the user's scoped variant) and whose `version` is highest. Report which one you picked.

### Step 2 — Check that the extension is built

For the package root from Step 1, check whether `<root>/dist/index.js` exists:

```
test -f <root>/dist/index.js && echo "built" || echo "not built"
```

- If **built**, continue to Step 3.
- If **not built**, the extension's compiled output is missing. This is the most common failure mode for git-source installs without the `prepare` hook (older versions of pi-deepwork) or when the user installed with `--ignore-scripts`. Recovery:

  ```
  cd <root>
  npm install
  npm run build
  ```

  Then restart pi (or open a new pi session in this workspace). Report this recovery recipe, mark the run as `not built`, and continue to Step 3 anyway so the report is complete.

### Step 3 — Check the pi-subagents peer dependency

The extension's `peerDependencies` requires `@tintinweb/pi-subagents`. Check:

```
ls ~/.pi/agent/npm/node_modules/@tintinweb/pi-subagents/package.json 2>/dev/null && echo "present" || echo "missing"
```

If missing, the extension cannot register agents even when built. Recovery: ensure pi has loaded `@tintinweb/pi-subagents` (it is a separate extension). Continue to Step 4.

### Step 4 — Check the registered subagent inventory

Run `subagent list` and grep for `qrspi-`. Expected: ~55 `qrspi-*` agents when the extension is healthy.

- **0 qrspi-* agents listed + dist not built (Step 2)** → root cause is "extension not built". Use the Step 2 recovery.
- **0 qrspi-* agents listed + dist built** → root cause is "extension built but pi did not load it". Possible causes: pi's extension list omits `pi-deepwork`; the extension threw an error during `activate()` (check pi's extension log / stderr); the peer dependency is missing (Step 3).
- **Some qrspi-* agents listed but fewer than 10 stage agents** → partial mirror. Recovery: in a healthy workspace, the extension's `/deepwork` command handler re-mirrors on every invocation. Re-run `/deepwork <task>` to trigger a fresh mirror.
- **All ~55 qrspi-* agents listed** → the extension *is* loaded; the registered `/deepwork-doctor` command should have served this invocation. If you reached this skill anyway, the user may have invoked the skill name directly (`/deepwork-doctor` resolves to the slash command first); ask the user to re-invoke and report which one ran.

### Step 5 — Check the workspace agent mirror (diagnostic only)

Run:

```
ls <workspace>/.pi/agents/ 2>/dev/null | wc -l
```

This tells you whether the extension's `/deepwork` command has run in this workspace before. It is **not** the source of truth — `subagent list` (Step 4) is — but a healthy run mirrors agents here. If `.pi/agents/` is empty or missing, the extension has not bootstrapped this workspace yet. **Do not create or populate this directory manually.**

## Final report

Print a single fenced block with:

```
=== Deepwork Doctor Report (skill fallback) ===
extension_package_root: <path or "not found">
extension_built:        <yes|no>
peer_pi_subagents:      <present|missing>
qrspi_subagents_in_list: <count>
workspace_agents_mirror: <count or "missing">
root_cause:             <one of: extension_not_built | peer_missing | extension_not_loaded_by_pi | partial_mirror | healthy_but_skill_resolved>
recovery:               <single sentence: the exact command or action the user should run>
```

Follow the report with one short paragraph naming the most likely fix.

## Do NOT

- Do **not** run `npm install` or `npm run build` yourself. Propose the command; let the user run it.
- Do **not** copy, symlink, or `mkdir`/`cp` anything under `<workspace>/.pi/agents/`.
- Do **not** write to `<workspace>/.pi/deepwork-doctor-report.md` — that path belongs to the extension's registered command, not this skill.
- Do **not** call `subagent list` and then attempt to "register" agents manually. Registration is owned by `@tintinweb/pi-subagents` via the extension's `ensureRegisteredSubagents`.
- Do **not** start a deepwork pipeline run from this skill. If the diagnosis ends with `healthy`, tell the user to invoke `/deepwork <task>` themselves.
