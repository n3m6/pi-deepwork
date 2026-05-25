# pi-deepwork (NOT READY FOR PRODUCTION USE)

pi-deepwork is a pi extension for the QRSPI deepwork pipeline (Goals -> Research + Questions -> Design -> Structure -> Plan -> Implement -> Accept-Test -> Replan -> Verify -> Report). Today it supports two entry modes from a single `/deepwork` prompt: live mode, which scaffolds pipeline state and hands the active session back to pi with a Deepwork kickoff prompt, and `dry-run`, which simulates the route locally and writes placeholder pipeline artifacts without invoking subagents or editing project source files.

## Prerequisites

- **pi** — the AI coding-agent runtime that loads the extension, exposes the ExtensionAPI and ExtensionContext interfaces, provides `ctx.ui` for interactive prompts, and emits `resources_discover` for skill injection.
- **`@tintinweb/pi-subagents` 0.7.3+** — install separately with `pi install npm:@tintinweb/pi-subagents`. This provides the shared agent manager that `qrspi_dispatch` uses to spawn subagents.
- **Node.js 18+** — required to build and run the TypeScript extension.
- **git** (optional) — used for per-run branches (`qrspi/<run-id>`) and stage checkpoints. If `git` is unavailable, the extension continues and tracks state only in `.pipeline/`.
- **Model availability** — at least one sonnet-tier and one haiku-tier model. Orchestrators use sonnet-tier models; reviewers and many leaf agents use haiku-tier models.

## Installation

Install `@tintinweb/pi-subagents` first regardless of the workflow you choose.

### Method A: Git clone + npm symlink

```bash
# 1. Install the prerequisite
pi install npm:@tintinweb/pi-subagents

# 2. Clone and build
git clone https://github.com/n3m6/pi-deepwork.git
cd pi-deepwork
npm install
npm run build

# 3. Symlink the extension into pi's global extensions directory
ln -s "$(pwd)" ~/.pi/agent/extensions/pi-deepwork

# 4. Symlink the agent markdown files into pi-subagents' flat global agent directory
mkdir -p ~/.pi/agent/agents
for file in "$(pwd)"/agents/*.md; do ln -sf "$file" ~/.pi/agent/agents/; done
```

What each step does:

- Step 1 installs `pi-subagents`, which provides the shared agent manager used by `qrspi_dispatch`.
- Step 2 clones the repository and compiles the TypeScript source to CommonJS output in `dist/`.
- Step 3 makes pi discover this extension from `~/.pi/agent/extensions/pi-deepwork`.
- Step 4 makes pi-subagents discover the 55 agent definitions from the flat `~/.pi/agent/agents/*.md` directory.

### Method B: `pi install git:`

```bash
# 1. Install the prerequisite
pi install npm:@tintinweb/pi-subagents

# 2. Install the extension with pi's package manager
pi install git:github.com/n3m6/pi-deepwork@main
```

`pi install git:` performs the repository clone, runs `npm install --omit=dev` when a `package.json` is present, and places the extension in pi's managed extension directory. On the first live `/deepwork` or `/deepwork-resume` run in a repository, pi-deepwork mirrors its bundled QRSPI agent definitions into that repository's `.pi/agents/` directory so pi-subagents can discover them without a separate setup step. Manual global symlinks are still useful when you want the QRSPI agent catalog available before the first Deepwork run or across all repositories.

### Repository name and package name

The GitHub repository and `package.json` now both use `pi-deepwork`.

- Manual cloning uses the repository URL: `https://github.com/n3m6/pi-deepwork.git`
- `pi install git:` should use the repository locator: `git:github.com/n3m6/pi-deepwork@main`

pi currently clones that install into a git-managed directory such as `~/.pi/agent/git/github.com/n3m6/pi-deepwork/`.
Some pi builds still try to open the skill source from an npm-style path first, for example `~/.pi/agent/npm/node_modules/@n3m6/pi-deepwork/skills/deepwork/SKILL.md`, before the extension's `resources_discover` result is applied. To cover that probe order, pi-deepwork now creates an npm-compatible compatibility install for its `skills/` payload when it is running from the git-managed pi install root. That lets the first Deepwork skill expansion succeed even when pi probes the npm-style scoped path before consulting `resources_discover`.
If that compatibility install cannot be created because of filesystem permissions or a broken pi install, fall back to the clone-plus-symlink workflow from Method A until the environment is repaired.

## Agent Type Discovery

pi-subagents can discover the agent files in either of these ways:

### Global discovery

pi-subagents loads custom agents from flat markdown files under `~/.pi/agent/agents/`.
Symlink or copy this repository's individual agent files into that directory:

```bash
mkdir -p ~/.pi/agent/agents
for file in "$(pwd)"/agents/*.md; do ln -sf "$file" ~/.pi/agent/agents/; done
```

This makes the QRSPI agent types available system-wide.

### Project-local discovery

pi-subagents also loads project-scoped custom agents from the flat `.pi/agents/*.md` directory in the active repository. For repository-local use, create `.pi/agents/` in the working project and copy or symlink these agent files there. This keeps the agent catalog scoped to that repository instead of the entire pi installation.

Nested directories such as `.pi/agents/qrspi/` or `~/.pi/agent/agents/qrspi/` are not scanned.

## Usage

### Start a new run

Use `/deepwork` with a task description:

```text
/deepwork task:"Add resumable pipeline orchestration to the extension"
```

Optional run policy arguments:

- `interaction-mode:"interactive"` (default) allows human gates.
- `interaction-mode:"automated"` suppresses human prompts where the Deepwork policy has a deterministic choice.
- `failure-policy:"fail-closed"` (default) stops on ambiguous automated decisions.
- `failure-policy:"best-effort"` continues when a safe automated fallback is defined.

```text
/deepwork task:"Add resumable pipeline orchestration to the extension" interaction-mode:"automated" failure-policy:"best-effort"
```

Current live-mode behavior:

- create a new run ID in `qrspi-YYYYMMDD-HHMMSS` format
- mirror the bundled QRSPI agent definitions into the active workspace's `.pi/agents/` directory without overwriting existing project-local overrides
- scaffold `.pipeline/<run-id>/` under the active workspace root from `ctx.cwd`
- write initial `state.md` and telemetry files
- inject the `deepwork` skill through `resources_discover`
- validate that the required QRSPI stage-agent files were mirrored and registered before the live or resume handoff
- refresh pi-subagents' custom-agent registry before the live or resume handoff so the first Deepwork turn can already see the mirrored `qrspi-*` agent types
- send a Deepwork kickoff prompt into the active session via `pi.sendUserMessage()` so the orchestrator continues from the scaffolded `state.md`
- include a runtime discovery snapshot and exact next `qrspi_dispatch` target in the handoff prompt, so the first Deepwork turn dispatches directly instead of searching for skill or agent files
- refresh and validate pi-subagents' custom-agent registry again when `qrspi_dispatch` launches a `qrspi-*` agent, so missing registration fails closed instead of falling back to `general-purpose`
- instruct the resumed assistant to fail closed: it must remain in Deepwork orchestration mode, must not implement directly, must not use generic `Agent` / `subagent` discovery for QRSPI stages, and must stop with a configuration error if the Deepwork skill or `qrspi_dispatch` / `qrspi_question` tools are unavailable
- if `pi.sendUserMessage()` fails, keep the scaffolded run on disk and report that no Deepwork orchestrator is active yet; recovery is to fix the runtime configuration and rerun `/deepwork-resume run-id:"<run-id>"`

The extension does not mutate `ctx.sessionManager` directly. pi documents that surface as read-only; runtime handoff happens through the documented message APIs.

### Run a dry-run simulation

Use the same command with `dry-run:"true"`, an optional `route`, and the same optional policy arguments:

```text
/deepwork task:"Add resumable pipeline orchestration to the extension" dry-run:"true" route:"full"
```

```text
/deepwork task:"Fix a small regression in the resume flow" dry-run:"true" route:"quick-fix"
```

```text
/deepwork task:"Audit the route model" dry-run:"true" route:"full" interaction-mode:"automated" failure-policy:"fail-closed"
```

Dry-run mode will:

- create a new run ID in `qrspi-YYYYMMDD-HHMMSS` format
- write a simulated `.pipeline/<run-id>/` artifact tree for the chosen route
- mark `state.md` with `mode: "dry-run"`, the selected interaction/failure policy, and advance it to `next_stage: "done"`
- generate synthetic telemetry files such as `telemetry/events.jsonl`, `telemetry/run-log.md`, and `telemetry/metrics-summary.md`
- skip git branch creation and checkpoint commits
- skip all `qrspi_dispatch` and `qrspi_question` activity
- avoid modifying project source files

### Resume an existing run

```text
/deepwork-resume run-id:"qrspi-20260524-120000"
```

The extension reads `.pipeline/<run-id>/state.md` and resumes from the recorded `next_stage`. If the run is already complete, including a completed dry-run, the UI reports that clearly instead of presenting it as resumable work.

For resumable live runs, the extension also injects a Deepwork resume prompt into the active session via `pi.sendUserMessage()` so the orchestrator re-enters at the recorded `next_stage`. That resume prompt uses the same fail-closed contract as live startup: no direct coding, no silent fallback, and an explicit configuration error if the required Deepwork skill or QRSPI tools are unavailable.

### Background subagent orchestration

Child QRSPI agents can now use a fire-and-join pattern when they need to launch a background subagent and continue only after polling or waiting for the result.

- Use `qrspi_dispatch` with `run_in_background: true` to start the child task and capture the returned `agentId`.
- Use `qrspi_get_subagent_result` with that `agentId` to poll status, or pass `wait: true` to block until completion.
- Current scope is launch plus result retrieval. There is still no dedicated steering wrapper for child-agent background work, so background flows should be designed as fire-and-join rather than fire-and-steer.

Example wrapper flow inside an orchestrator prompt:

```text
1. Call qrspi_dispatch with run_in_background:true.
2. Record the returned agentId.
3. Re-check with qrspi_get_subagent_result agent_id:"<id>".
4. If you need the final output in the same turn, call qrspi_get_subagent_result with wait:true.
```

## What the Pipeline Produces

Each run writes state and stage artifacts under `.pipeline/<run-id>/`, including:

- `state.md` — current route, phase, completed stages, next stage, and resume metadata
- `telemetry/events.jsonl` — pipeline event stream
- `telemetry/run-log.md` — readable run timeline
- `telemetry/metrics-summary.md` — summarized metrics and counts
- stage artifacts such as `goals.md`, merged research/question artifacts (`questions.md`, `research/question-ledger.md`, `research/open-questions.md`, `research/summary.md`), `design.md`, `structure.md`, `plan.md`, phase task specs, acceptance results, verification summaries, and the final report

`.pipeline/` is intentionally ignored by git because it contains per-run ephemeral artifacts.

## Troubleshooting

### `qrspi_dispatch` says `pi-subagents` is missing

Install the prerequisite:

```bash
pi install npm:@tintinweb/pi-subagents
```

The extension degrades gracefully and returns a clear prerequisite message when the agent manager is unavailable.

### The extension loads, but agents are not found

Check agent discovery first:

- if you started Deepwork at least once in the repository, confirm the runtime mirrored the bundled agent `.md` files into `.pi/agents/`
- confirm the agent `.md` files are present directly under `~/.pi/agent/agents/`
- or confirm the current project has the agent `.md` files directly under `.pi/agents/`
- verify that the directory contains the expected `.md` agent definitions

If `qrspi-goals` or another QRSPI stage agent is not registered, current pi-deepwork builds should fail closed with a configuration error before launching the stage. Older logs where an unknown agent type falls back to `general-purpose` mean the stage-agent markdown files were not discovered or the subagent registry did not refresh after they were mirrored into `.pi/agents/`. pi-subagents only scans the flat `~/.pi/agent/agents/*.md` and `.pi/agents/*.md` paths; nested directories are ignored.

On a healthy live or resume handoff, the first Deepwork turn receives a `=== RUNTIME DISCOVERY ===` snapshot and a `=== NEXT DISPATCH ===` block. It should call `qrspi_dispatch` directly for the recorded stage, not run `find` for `SKILL.md`, call `add_directory`, manually create symlinks, or use `subagent list` as a prerequisite. If `subagent list` still shows only builtin agents immediately after `/deepwork` or `/deepwork-resume`, confirm the current repository now has `.pi/agents/*.md` and rerun after refreshing the installed extension copy.

### The first `deepwork` skill expansion shows `ENOENT`

If you installed with `pi install git:github.com/n3m6/pi-deepwork@main`, pi may still try an npm-style source path on the first skill-file read. pi-deepwork now creates a compatibility path under `~/.pi/agent/npm/node_modules/@n3m6/pi-deepwork/` when it is activated from the git-managed install root, so the first `SKILL.md` read should succeed without extra operator setup.

If you still see `ENOENT`, verify both the real git install and the compatibility path exist:

```bash
ls -la ~/.pi/agent/git/github.com/n3m6/pi-deepwork/skills/deepwork/SKILL.md
ls -la ~/.pi/agent/npm/node_modules/@n3m6/pi-deepwork/skills/deepwork/SKILL.md
```

If the git-managed skill exists but the npm-compatible path does not, the extension likely could not create the compatibility install because of a filesystem or install-layout problem. Fix that environment issue or use the clone-plus-symlink flow from Method A.

If you see that initial `ENOENT` and the session then behaves like a generic coding assistant instead of Deepwork orchestration, treat that as a failed handoff rather than a completed pipeline start. The run scaffold may still exist under `.pipeline/<run-id>/`; after fixing the install or tool-discovery issue, resume it with `/deepwork-resume run-id:"<run-id>"`.

### `git` is not installed

The extension still runs. Branch creation and checkpoint commits are skipped, but `.pipeline/<run-id>/state.md` remains the source of truth for recovery and resume.

### Model resolution fails

Make sure your pi installation has access to both model tiers used here:

- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-haiku-4-5`

### Build and test locally

```bash
npm install
npm run lint
npm run typecheck
npm run format:check
npm run build
npm test
```

`npm run lint` checks the repository with ESLint. `npm run typecheck` performs no-emit TypeScript checks for both the runtime and test configs. `npm run format:check` verifies Prettier formatting, and `npm run format` rewrites supported files when you want to apply formatting changes.

`npm run build` compiles runtime source to `dist/`. `npm test` also compiles the test suite and runs the Node test runner against the compiled output.

## Manual pi Smoke-Test Checklist

Use this checklist in a real pi environment after installation. It is the operator flow to verify end-to-end behavior that the repo tests cannot exercise on their own.

1. Install `@tintinweb/pi-subagents >=0.7.3`, build this extension, and either place the agent files directly under `~/.pi/agent/agents/` or let the first live/resume Deepwork run mirror them into `.pi/agents/` automatically.
2. Start pi in a disposable repository with git initialized, Node 18+, and access to the sonnet and haiku model tiers used by the agents.
3. Confirm `/deepwork` and `/deepwork-resume` are present, and verify the `deepwork` skill is available in the session.
4. Run `/deepwork task:"Smoke test dry run" dry-run:"true" route:"quick-fix"` and verify `.pipeline/<run-id>/state.md` records `mode: "dry-run"` and `next_stage: "done"`.
5. Run `/deepwork task:"Smoke test live run"` and verify the extension scaffolds `.pipeline/<run-id>/` under the active workspace, writes telemetry, validates mirrored QRSPI registration, then hands off to Deepwork through `pi.sendUserMessage()`.
6. Confirm the first live Deepwork turn contains `=== RUNTIME DISCOVERY ===` and `=== NEXT DISPATCH ===`, does not search for `SKILL.md`, does not call `subagent list`, does not create symlinks, and directly dispatches `qrspi-goals` through `qrspi_dispatch`.
7. If you want to verify child-agent background orchestration, dispatch a background child task through `qrspi_dispatch`, capture the returned `agentId`, then retrieve it through `qrspi_get_subagent_result` with and without `wait: true`.
8. If live handoff fails, verify the UI explicitly reports that no Deepwork orchestrator is active and points you at `/deepwork-resume run-id:"<live-run-id>"`.
9. Run `/deepwork-resume run-id:"<live-run-id>"` and confirm the resume prompt re-enters at the `next_stage` recorded in `state.md`.
10. Confirm the expected artifacts exist under `.pipeline/<run-id>/`, including `state.md`, `telemetry/events.jsonl`, `telemetry/run-log.md`, and `telemetry/metrics-summary.md`.

Expected operator flow:

1. Install and discover the extension plus flat agent files.
2. Start a dry-run to confirm artifact generation and route simulation.
3. Start a live run to confirm scaffold plus `pi.sendUserMessage()` handoff.
4. If handoff fails, confirm the run is reported as scaffolded but inactive, then recover it through `/deepwork-resume` after fixing the runtime issue.
5. Resume a live run to confirm `state.md`-driven re-entry.
6. Optionally verify background child-agent launch plus join using `qrspi_dispatch` and `qrspi_get_subagent_result`.

## Development Notes

- Runtime entry point: `dist/index.js`
- Runtime-published files: `dist/`, `agents/`, and `skills/`
- Deepwork skill: `skills/deepwork/SKILL.md`
- Agent definitions: `agents/*.md`
- Source code: `src/`

If you change agent prompts or the skill prompt, rebuild before testing installability workflows.
