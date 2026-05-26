# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`pi-deepwork` is a **markdown prompt pack** for the [pi](https://github.com/mariozechner/pi-coding-agent) AI coding-agent runtime. It implements the QRSPI deepwork pipeline:

Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report

It used to be a TypeScript extension. It is now plain markdown plus a single zero-dependency Node script. There is no compiled code, no `dist/`, no `package.json` runtime layer, no extension `activate()`. pi auto-discovers the skill from a git clone under `~/.pi/agent/git/`. The nicobailon `pi-subagents` runtime auto-discovers the agent definitions from `~/.pi/agent/agents/` (global) or `<workspace>/.pi/agents/` (project-local) — a bundled `postinstall` hook ([scripts/postinstall.mjs](scripts/postinstall.mjs)) symlinks the package's `agents/qrspi-*.md` into whichever of those dirs matches the install scope.

## Repository layout

- [agents/](agents/) — 55 `qrspi-*.md` files. Each is YAML frontmatter + a body prompt consumed by `pi-subagents`.
- [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) — the orchestrator skill loaded by pi when `/deepwork` is invoked.
- [scripts/postinstall.mjs](scripts/postinstall.mjs) — the **single** approved install-time script. Pure Node, zero deps, fail-open, heavily gated. Detects whether the package lives under a `.pi/agent/git/` (global) or `.pi/git/` (project) ancestor and symlinks `agents/qrspi-*.md` into the matching pi-subagents scan dir. Outside a pi clone it is a no-op. See `## Operational safety` for the policy that bounds it.
- [test/](test/) — structural `node --test` checks against the `.md` files plus subprocess coverage of the postinstall hook. Six suites: agent stage1 frontmatter, agent stage2 frontmatter, agent stage6 frontmatter, SKILL.md contract, postinstall hook, and spawn-protocol invariants.
- [install.sh](install.sh), [uninstall.sh](uninstall.sh) — manual fallback install scripts for users without pi.
- [package.json](package.json) — zero-deps manifest. Exposes `npm test` and wires the `postinstall` hook.
- [.gitignore](.gitignore) — excludes `.pipeline/` (per-run artifacts, never commit).

## Build, test, and run

There is no build step. There is no lint, format, or typecheck step.

```bash
npm test    # node --test on the structural test files
```

That is the entire local quality gate.

## Coding conventions

- **Agents are markdown with YAML frontmatter.** Frontmatter keys follow the current `pi-subagents` schema used in this repo: `name`, `description`, `tools`, `model`, `thinking`, `max_turns`, `systemPromptMode`, and `extensions`. Keep the field set consistent across agents.
- **The skill is markdown with YAML frontmatter.** Frontmatter keys: `name`, `description`. The body follows the pi-coding-agent skill schema.
- **No runtime code.** Do not reintroduce a `src/` directory, a `package.json` with `main`, a TypeScript compiler, or any kind of extension `activate()` entry. The prior cycle of "pi extension with `dist/` + `prepare` hook + skill-compat symlink" failed to load reliably; we deliberately stripped it. The `scripts/postinstall.mjs` hook is **not** runtime code — it runs once at install time, has zero dependencies, and exits cleanly when not inside a pi clone.
- **No runtime dependencies in `package.json`.** `npm test` must succeed with zero `node_modules/`. Tests use only the `node:` built-ins; the postinstall hook does the same.
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

- The expected agent count is **55**. Tests in [test/agents-stage1.test.js](test/agents-stage1.test.js), [test/agents-stage2.test.js](test/agents-stage2.test.js), and [test/agents-stage6.test.js](test/agents-stage6.test.js) assert structural invariants on individual stages. Update those tests if you add, rename, or remove an agent.
- All 55 agents currently use a single model profile: `model: deepseek-v4-pro` and `thinking: high`. Apply changes uniformly if you alter the profile.
- The orchestrator's invariants are covered by [test/skill.test.js](test/skill.test.js): YAML frontmatter present, no references to deprecated tools (`task`, legacy `question`, `todowrite`, permission rules, opencode protocol paths), correct usage of the `subagent` tool with `agent` / `tasks` dispatch, and the install verification recipe present in Pre-Flight Step 0.
- **Child agents must not call `ask_user`.** The `qrspi-goals`, `qrspi-design`, `qrspi-structure`, and `qrspi-fast-impl-code` agents run in headless child pi sessions where `ask_user` is invisible to the human. They escalate human-input through `contact_supervisor` (auto-registered by the pi-subagents intercom bridge when `pi-intercom` is installed). Use `reason: "interview_request"` for structured questions with options, or `reason: "need_decision"` for freeform decisions. Because pi-subagents accepts `~/...` extension allowlists and expands them at runtime, this repo should keep `extensions` portable with `~/.pi/...` paths rather than committing user-specific `/home/<name>/...` literals. The deepwork orchestrator in [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) receives inbound child asks, forwards each question to the human via `ask_user`, and replies with `intercom({ action: "reply", message: <json> })` in the `{"responses":[{"id":"...","value":...}]}` shape.
- **Child agents fan out with the child-safe `subagent` tool.** Any dispatcher agent whose frontmatter includes `tools: subagent` may call `subagent({ agent: "...", task: ... })` for single-child work or `subagent({ tasks: [...] })` for independent parallel batches. `contact_supervisor` is reserved for `interview_request`, `need_decision`, and `progress_update`; it is not a spawn bridge. The structural test [test/spawn-protocol.test.js](test/spawn-protocol.test.js) asserts the nested dispatcher agents use direct `subagent` calls and no longer mention `spawn_request`, `spawn_poll`, or `get_subagent_result`.

## Install model (for your reference)

Install the runtime companions first:

```bash
pi install npm:pi-subagents
pi install npm:pi-intercom
```

Then install the prompt pack:

```bash
pi install git:github.com/n3m6/pi-deepwork@main
```

pi clones to `~/.pi/agent/git/github.com/n3m6/pi-deepwork/` (or `<workspace>/.pi/git/...` with `-l`), runs `npm install`, and the `postinstall` hook symlinks `agents/qrspi-*.md` into the matching pi-subagents scan dir. pi discovers the skill from the git path automatically. There is no `dist/`, no compile step, no extension to register.

The manual fallback (used by [install.sh](install.sh) and documented in [README.md](README.md)) is three shell lines:

```bash
git clone https://github.com/n3m6/pi-deepwork ~/.pi/agent/git/github.com/n3m6/pi-deepwork
mkdir -p ~/.pi/agent/agents
ln -sf ~/.pi/agent/git/github.com/n3m6/pi-deepwork/agents/qrspi-*.md ~/.pi/agent/agents/
```

This repo keeps the linked agent files directly under the scan directories to keep discovery predictable.

## Operational safety

- **Never commit `.pipeline/`.** It contains per-run scratch state that is meaningless outside the originating session.
- **Postinstall scripts are tightly bounded.** The single allowed instance is [scripts/postinstall.mjs](scripts/postinstall.mjs), which exists because pi auto-discovers `skills/` of installed packages but not `agents/`. Any other install-time script — `prepare`, additional `postinstall` steps, anything that requires a build toolchain or dev dependencies — is forbidden. The prior regression (`sh: 1: tsc: not found` under `npm install --omit=dev`) came from a toolchain-dependent `prepare`; the rule that prevents it is: install-time scripts must be pure Node, zero-deps, fail-open (never exit nonzero), and a no-op when not running inside a pi clone (detected by walking ancestors for `.pi/agent/git/` or `.pi/git/`).
- **Do not add devDependencies.** They invite the toolchain back in. If a future change genuinely needs a dev tool, prefer a one-shot `npx` invocation over a persistent dep. The postinstall hook and its tests both stay on `node:` built-ins only.
