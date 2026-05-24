# pi-deepwork

pi-deepwork is a pi extension that automates the full QRSPI deepwork pipeline (Goals -> Questions -> Research -> Design -> Structure -> Plan -> Implement -> Accept-Test -> Replan -> Verify -> Report) through 55 specialized subagents, starting from a single `/deepwork` prompt.

## Prerequisites

- **pi** — the AI coding-agent runtime that loads the extension, exposes the ExtensionAPI and ExtensionContext interfaces, provides `ctx.ui` for interactive prompts, and emits `resources_discover` for skill injection.
- **`@tintinweb/pi-subagents` 0.7.3+** — install separately with `pi install npm:@tintinweb/pi-subagents`. This provides the `Agent` tool for subagent dispatch and the `AgentManager` used by `qrspi_dispatch`.
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
ln -s "$(pwd)" ~/.pi/agent/extensions/deepwork-pi

# 4. Symlink the agent types into pi-subagents' global agent directory
ln -s "$(pwd)/agents" ~/.pi/agent/agents/qrspi
```

What each step does:

- Step 1 installs `pi-subagents`, which provides the `Agent` tool and the shared agent manager used by `qrspi_dispatch`.
- Step 2 clones the repository and compiles the TypeScript source to CommonJS output in `dist/`.
- Step 3 makes pi discover this extension from `~/.pi/agent/extensions/deepwork-pi`.
- Step 4 makes pi-subagents discover the 55 agent definitions from `~/.pi/agent/agents/qrspi/*.md`.

### Method B: `pi install git:`

```bash
# 1. Install the prerequisite
pi install npm:@tintinweb/pi-subagents

# 2. Install the extension with pi's package manager
pi install git:github.com/n3m6/deepwork-pi@main
```

`pi install git:` performs the repository clone, runs `npm install --omit=dev` when a `package.json` is present, and places the extension in pi's managed extension directory. Agent type discovery still needs to be configured separately through either the global symlink path or a project-local `.pi/agents/` directory.

### Repository name vs package name

The GitHub repository is `pi-deepwork`, while the installable package name is `deepwork-pi`.

- Manual cloning uses the repository URL: `https://github.com/n3m6/pi-deepwork.git`
- `pi install git:` uses the package-oriented name: `git:github.com/n3m6/deepwork-pi@main`

They refer to the same codebase.

## Agent Type Discovery

pi-subagents can discover the agent files in either of these ways:

### Global discovery

Symlink this repository's `agents/` directory into pi's global agent directory:

```bash
ln -s "$(pwd)/agents" ~/.pi/agent/agents/qrspi
```

This makes the QRSPI agent types available system-wide.

### Project-local discovery

For repository-local use, create a `.pi/agents/qrspi/` directory in the working project and copy or symlink these agent files there. This keeps the agent catalog scoped to that repository instead of the entire pi installation.

## Usage

### Start a new run

Use `/deepwork` with a task description:

```text
/deepwork task:"Add resumable pipeline orchestration to the extension"
```

The extension will:

- create a new run ID in `qrspi-YYYYMMDD-HHMMSS` format
- scaffold `.pipeline/<run-id>/`
- write initial `state.md` and telemetry files
- inject the `deepwork` skill through `resources_discover`
- hand off orchestration to the main agent plus the QRSPI subagent set

### Resume an existing run

```text
/deepwork-resume run-id:"qrspi-20260524-120000"
```

The extension reads `.pipeline/<run-id>/state.md` and resumes from the recorded `next_stage`.

## What the Pipeline Produces

Each run writes state and stage artifacts under `.pipeline/<run-id>/`, including:

- `state.md` — current route, phase, completed stages, next stage, and resume metadata
- `telemetry/events.jsonl` — pipeline event stream
- `telemetry/run-log.md` — readable run timeline
- `telemetry/metrics-summary.md` — summarized metrics and counts
- stage artifacts such as `goals.md`, `questions.md`, `research/summary.md`, `design.md`, `structure.md`, `plan.md`, phase task specs, acceptance results, verification summaries, and the final report

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

- confirm `agents/` is symlinked into `~/.pi/agent/agents/qrspi`
- or confirm the current project has `.pi/agents/qrspi/` with the agent files present
- verify that the directory contains the expected `.md` agent definitions

### `git` is not installed

The extension still runs. Branch creation and checkpoint commits are skipped, but `.pipeline/<run-id>/state.md` remains the source of truth for recovery and resume.

### Model resolution fails

Make sure your pi installation has access to both model tiers used here:

- `anthropic/claude-sonnet-4-5`
- `anthropic/claude-haiku-4-5`

### Build and test locally

```bash
npm install
npm run build
npm test
```

`npm run build` compiles runtime source to `dist/`. `npm test` also compiles the test suite and runs the Node test runner against the compiled output.

## Development Notes

- Runtime entry point: `dist/index.js`
- Runtime-published files: `dist/`, `agents/`, and `skills/`
- Deepwork skill: `skills/deepwork/SKILL.md`
- Agent definitions: `agents/*.md`
- Source code: `src/`

If you change agent prompts or the skill prompt, rebuild before testing installability workflows.
