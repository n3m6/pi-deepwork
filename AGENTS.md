# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`pi-deepwork` is a **markdown prompt pack** for the [pi](https://github.com/mariozechner/pi-coding-agent) AI coding-agent runtime. It implements the QRSPI deepwork pipeline:

Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report

It used to be a TypeScript extension. It is now plain markdown only. There is no compiled code, no `dist/`, no `package.json` runtime layer, no extension `activate()`. pi auto-discovers the skill from a git clone under `~/.pi/agent/git/`, and `@tintinweb/pi-subagents` auto-discovers the agent definitions from `~/.pi/agent/agents/` (global) or `<workspace>/.pi/agents/` (project-local).

## Repository layout

- [agents/](agents/) — 55 `qrspi-*.md` files. Each is YAML frontmatter + a body prompt consumed by `pi-subagents`.
- [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) — the orchestrator skill loaded by pi when `/deepwork` is invoked.
- [test/](test/) — structural `node --test` checks against the `.md` files. Three suites: agent stage1 frontmatter, agent stage6 frontmatter, and SKILL.md contract.
- [install.sh](install.sh), [uninstall.sh](uninstall.sh) — one-shot install scripts.
- [package.json](package.json) — zero-deps manifest, only used to expose `npm test`.
- [.gitignore](.gitignore) — excludes `.pipeline/` (per-run artifacts, never commit).

## Build, test, and run

There is no build step. There is no lint, format, or typecheck step.

```bash
npm test    # node --test on the structural test files
```

That is the entire local quality gate.

## Coding conventions

- **Agents are markdown with YAML frontmatter.** Frontmatter keys follow the `pi-subagents` schema: `name`, `description`, `model`, `thinking`, `tools`, `systemPromptMode`, `extensions`, plus the legacy `prompt_mode`, `enabled`, `max_turns` fields the suite asserts on. Keep the field set consistent across agents.
- **The skill is markdown with YAML frontmatter.** Frontmatter keys: `name`, `description`. The body follows the pi-coding-agent skill schema.
- **No runtime code.** Do not reintroduce a `src/` directory, a `package.json` with `main`, a TypeScript compiler, or any kind of extension `activate()` entry. The prior cycle of "pi extension with `dist/` + `prepare` hook + skill-compat symlink" failed to load reliably; we deliberately stripped it.
- **No runtime dependencies in `package.json`.** `npm test` must succeed with zero `node_modules/`. Tests use only the `node:` built-ins.
- **Keep diffs minimal.** Edit only the agent or skill you intend to change. Do not reformat or refactor the others.

## Pipeline state and artifacts

The skill is the source of truth for pipeline state.

- The orchestrator generates run IDs as `qrspi-YYYYMMDD-HHMMSS` via `date +%Y%m%d-%H%M%S`.
- Recovery state lives in `.pipeline/qrspi-<run-id>/state.md` (YAML frontmatter + freeform body).
- Telemetry events are appended to `.pipeline/qrspi-<run-id>/telemetry/events.jsonl`.
- `.pipeline/` is gitignored and never committed.
- All state-mutation steps are written into [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) as tool-call instructions to the model. There is no out-of-band code that scaffolds, mirrors, or persists state.

When changing state schema or stage ordering, update [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md), then run `npm test` so structural assertions stay valid.

## Agents and skill

- The expected agent count is **55**. Tests in [test/agents-stage1.test.js](test/agents-stage1.test.js) and [test/agents-stage6.test.js](test/agents-stage6.test.js) assert structural invariants on individual stages. Update those tests if you add, rename, or remove an agent.
- All 55 agents currently use a single model profile: `model: deepseek-v4-pro` and `thinking: high`. Apply changes uniformly if you alter the profile.
- The orchestrator's invariants are covered by [test/skill.test.js](test/skill.test.js): YAML frontmatter present, no references to deprecated tools (`task`, legacy `question`, `todowrite`, permission rules, opencode protocol paths), correct usage of the native Agent tool with `subagent_type`, and the install verification recipe present in Pre-Flight Step 0.

## Install model (for your reference)

The install is three shell lines (see [README.md](README.md) and [install.sh](install.sh)):

```bash
git clone https://github.com/n3m6/pi-deepwork ~/.pi/agent/git/github.com/n3m6/pi-deepwork
mkdir -p ~/.pi/agent/agents
ln -sf ~/.pi/agent/git/github.com/n3m6/pi-deepwork/agents/qrspi-*.md ~/.pi/agent/agents/
```

pi discovers the skill from the git path. `pi-subagents` discovers the agents from `~/.pi/agent/agents/`. Both directories are flat — nested subdirectories are not scanned. There is no `dist/`, no compile step, no extension to register.

## Operational safety

- **Never commit `.pipeline/`.** It contains per-run scratch state that is meaningless outside the originating session.
- **Do not add a `prepare` or `postinstall` script to `package.json`.** The prior install regression (`sh: 1: tsc: not found` under `npm install --omit=dev`) came from one. There is no need for either — the install is `git clone` + `ln -s`, not `npm install`.
- **Do not add devDependencies.** They invite the toolchain back in. If a future change genuinely needs a dev tool, prefer a one-shot `npx` invocation over a persistent dep.
