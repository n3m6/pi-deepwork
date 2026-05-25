# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`pi-deepwork` is a TypeScript extension for the **pi** AI coding-agent runtime. It implements the QRSPI deepwork pipeline:

Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report

The extension is loaded by pi, registers the `/deepwork` and `/deepwork-resume` commands, and orchestrates subagents through `@tintinweb/pi-subagents`. It currently supports two entry modes from `/deepwork`:

- **Live mode** — scaffolds `.pipeline/<run-id>/` for a real run, then hands the active session back to pi with `pi.sendUserMessage()` so Deepwork continues from the recorded state.
- **Dry-run mode** — simulates a route locally, writing placeholder artifacts without dispatching subagents or editing project source files.

## Repository layout

- [src/](src/) — TypeScript source compiled to `dist/`.
  - [src/index.ts](src/index.ts) — extension entry and composition root for command/tool/event registration.
  - [src/domain/pipeline/](src/domain/pipeline/) — pipeline state model, route/stage helpers, logical paths, artifact inventory, and telemetry helpers.
  - [src/application/](src/application/) — command argument parsing, state frontmatter codec, handoff prompt builders, and use cases such as dry-run simulation.
  - [src/adapters/](src/adapters/) — Node/pi adapters for filesystem, git, workspace path resolution, run scanning, and runtime handoff.
  - [src/ports/](src/ports/) — repo-local ports used to keep application logic decoupled from runtime and OS side effects.
  - [src/pipeline.ts](src/pipeline.ts) — compatibility barrel that re-exports the pipeline domain API for existing tests and consumers.
  - [src/shared-tools.ts](src/shared-tools.ts) — legacy child subagent helper tool factories.
  - [src/types/pi-extensions.ts](src/types/pi-extensions.ts) — pi `ExtensionAPI` / `ExtensionContext` typings.
- [agents/](agents/) — 55 QRSPI agent definition `.md` files consumed by `pi-subagents`.
- [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) — the deepwork skill prompt injected via `resources_discover`.
- [test/](test/) — Node test-runner suites; `.test.ts` files compile to `dist/test/`, `.test.js` files run directly.
- [tsconfig.json](tsconfig.json) — runtime build (`rootDir: src`, `outDir: dist`, strict mode).
- [tsconfig.test.json](tsconfig.test.json) — test build (`rootDir: .` so both `src/` and `test/` compile under `dist/`).
- [package.json](package.json) — `main: dist/index.js`; `files: ["dist/", "agents/", "skills/"]`.
- `.pipeline/` — per-run ephemeral artifacts; **gitignored, never commit**.
- `dist/` — build output; **never edit by hand, never commit**.

## Build, test, and run

```bash
npm install
npm run lint         # eslint across source, tests, and config
npm run typecheck    # no-emit checks for tsconfig.json and tsconfig.test.json
npm run format:check # verify prettier formatting without writing changes
npm run build        # tsc -p tsconfig.json -> dist/
npm test             # build + tsc -p tsconfig.test.json + node --test
```

`npm run format` applies Prettier formatting in place when you need to normalize files before re-running `npm run format:check`.

`npm test` runs:

```
node --test ./test/*.test.js ./dist/test/*.test.js ./dist/test/agents/*.test.js
```

The explicit globs are required — shell `**` expansion did not reliably match the nested agent tests. Preserve these globs when adding new test directories; either co-locate new tests under those paths or extend the `test` script.

For code changes, run `npm run lint`, `npm run typecheck`, `npm run format:check`, and `npm test` before declaring work complete. If you only touched agent prompts or the skill prompt, still run `npm run build` so packaging assumptions stay valid.

## Coding conventions

- **TypeScript strict mode** is enabled, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Account for `undefined` from index access and do not pass `undefined` where an optional property is omitted.
- **CommonJS** (`"type": "commonjs"`, `module: commonjs`). Use `import` syntax in `.ts`; do not switch to ESM.
- **Node built-ins** are imported with the `node:` prefix (e.g. `import * as fs from "node:fs"`).
- **No runtime dependencies** in `dependencies`. `@tintinweb/pi-subagents` is a `peerDependency` — do not add it as a regular dep. Avoid introducing new runtime deps without a strong reason.
- **Target Node 18+**, ES2020 language level.
- Keep diffs minimal and focused. Do not reformat or refactor unrelated code.

## Pipeline state and artifacts

- Source of truth for a run is `.pipeline/<run-id>/state.md` (YAML frontmatter parsed by `parseStateYaml` in [src/application/pipeline-state-codec.ts](src/application/pipeline-state-codec.ts)).
- Run IDs follow `qrspi-YYYYMMDD-HHMMSS` (`generateRunId` re-exported from [src/pipeline.ts](src/pipeline.ts)).
- Telemetry lives under `.pipeline/<run-id>/telemetry/` (`events.jsonl`, `run-log.md`, `metrics-summary.md`).
- Dry-run output must mark `mode: "dry-run"` and advance `next_stage` to `done`; it must not dispatch subagents or modify project source files.
- Per the documented pi extension contract, `ctx.sessionManager` is read-only in command/event contexts. Live and resume handoff should use `pi.sendUserMessage()` rather than mutating session state directly.

When changing state schema or stage ordering, update `pipeline.ts`, the YAML serializer/parser in `index.ts`, and the relevant tests in [test/pipeline.test.js](test/pipeline.test.js), [test/pipeline-helpers.test.ts](test/pipeline-helpers.test.ts), and [test/deepwork-scaffolding.test.ts](test/deepwork-scaffolding.test.ts) together.

## Agents and skill

- Agent definitions in [agents/](agents/) are plain markdown with frontmatter consumed by `pi-subagents`. The current expected count is **55**; tests under [test/agents/](test/agents/) and [test/agents-stage1.test.js](test/agents-stage1.test.js) / [test/agents-stage6.test.js](test/agents-stage6.test.js) assert structural invariants. Update those tests if you add, rename, or remove an agent.
- Agent definitions in [agents/](agents/) currently use a single model profile: `model: deepseek-v4-pro` and `thinking: high`. Keep [test/model-tier-verification.test.ts](test/model-tier-verification.test.ts) aligned if that policy changes.
- The deepwork skill prompt is [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md); changes are covered by [test/skill.test.js](test/skill.test.js).

## Operational safety

- Do not commit `dist/` or `.pipeline/`.
- Do not run destructive git operations (`push --force`, `reset --hard`, branch deletion) without explicit user confirmation.
- The extension creates `qrspi/<run-id>` git branches and checkpoint commits when `git` is available; design changes here must preserve the graceful fallback when `git` is missing.
- Dry-run mode is a hard contract: it must never invoke native `Agent` stage dispatch, interactive `ask_user` gates, or write outside `.pipeline/<run-id>/`.

## When you change things

- Agent prompts or skill prompt → rebuild (`npm run build`) and run `npm test`.
- Source, test, or config files → run `npm run lint`, `npm run typecheck`, `npm run format:check`, and `npm test`.
- Pipeline stages, routes, or state schema → update `src/domain/pipeline/`, [src/pipeline.ts](src/pipeline.ts), any affected application codec/use-case modules, and the corresponding tests in one change.
- Public command surface (`/deepwork`, `/deepwork-resume` arguments) → update [README.md](README.md) and the integration tests ([test/integration.test.ts](test/integration.test.ts), [test/index.test.ts](test/index.test.ts)).
- New runtime dependency → reconsider; if truly needed, justify in the PR and update `peerDependencies` vs `dependencies` deliberately.
