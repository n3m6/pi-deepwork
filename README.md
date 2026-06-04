# pi-deepwork

`pi-deepwork` is a deterministic TypeScript extension for [pi](https://github.com/mariozechner/pi-coding-agent). It runs the QRSPI deepwork pipeline in code while still reusing the bundled markdown leaf prompts for specialized synthesis, review, and reporting work.

The runtime is intentionally zero-build: pi loads `src/index.ts` directly from the package manifest, so there is no `dist/` directory, no compile step at install time, and no symlink-based agent registration hack.

## What changed

- The top-level `/deepwork` orchestration now lives in `src/controller.ts` and `src/stages/*.ts`.
- Only the 35 markdown leaf agents remain in `agents/`.
- Pipeline recovery state is persisted in `.pipeline/qrspi-<run-id>/state.json`.
- Telemetry is written to `.pipeline/qrspi-<run-id>/telemetry/events.jsonl`, with derived `run-log.md` and `metrics-summary.md`.

## Install

Install with pi:

```bash
pi install git:github.com/n3m6/pi-deepwork@main
```

That is enough for pi to discover the extension through the package's `pi.extensions` manifest.

If you prefer a wrapper script:

```bash
./install.sh
```

## Use

Run deepwork from the workspace you want to modify:

```text
/deepwork build a health-check endpoint for the API
```

Resume a prior run:

```text
/deepwork resume run-id:qrspi-20260601-120000
```

Optional flags:

- `mode:interactive` or `mode:automated`
- `failure:fail-closed` or `failure:best-effort`

## Command Reference

All flags are space-separated key:value pairs appended to the task description:

```text
/deepwork my task description mode:automated failure:best-effort
/deepwork resume run-id:qrspi-20260603-120000 mode:interactive
```

### `mode:` — Interaction Mode

Controls whether the pipeline presents human approval gates during execution.

| Value | Behavior |
|-------|----------|
| `mode:interactive` | Stages pause at review gates and ask for feedback. Interview questions prompt the user for missing context. |
| `mode:automated` | All gates are auto-approved. Required interview answers use conservative fallbacks when unavailable. |

**Default**: If pi has a UI (TUI mode), the pipeline defaults to `interactive`. In headless or non-interactive environments, it defaults to `automated`.

### `failure:` — Failure Policy

Controls what happens when a stage cannot converge within its review loop cap, or when a required interview answer is unavailable.

| Value | Behavior |
|-------|----------|
| `failure:fail-closed` | The run stops on unresolved review caps or missing required answers. |
| `failure:best-effort` | Unresolved review caps are auto-approved as `PARTIAL`. Missing answers proceed with conservative defaults. |

**Default**: `fail-closed` in interactive mode, `best-effort` in automated mode.

### `run-id:` — Resume a Prior Run

Resume a run that was interrupted or stopped. The pipeline reconstructs state from `.pipeline/<run-id>/state.json`. If the state file is missing, it attempts to infer the last completed stage from persisted artifacts.

```text
/deepwork resume run-id:qrspi-20260603-120000
```

You can combine `run-id:` with `mode:` and `failure:` to override the original run's settings on resume.

## Route Selection

The pipeline chooses between two routes at the **Goals** stage (Stage 1). The route is determined automatically, not via a flag.

### Quick-Fix Route

Triggered when the task is a "simple exact-file task" — creating a single file with exact, known content (e.g. "create a SMOKE.md file containing exactly one sentence"). The pipeline skips the Design and Structure stages:

```text
Goals -> Research -> Plan -> Implement -> Accept -> Verify -> Report
```

Implementation is fully deterministic: no agent dispatch, no worktrees, no review loops. The file is written with byte-preserving precision.

### Full Route

Used for all other tasks — feature work, refactors, multi-file changes, etc. The complete QRSPI pipeline is executed:

```text
Goals -> Research -> Design -> Structure -> Plan -> (Implement -> Accept -> Replan)* -> Verify -> Report
```

Multi-phase work repeats the `Implement → Accept → Replan` loop until all phases are complete, then proceeds to `Verify → Report`.

## Repository Layout

- `src/index.ts` registers the `/deepwork` command.
- `src/controller.ts` owns run lifecycle, stage transitions, telemetry, and resume.
- `src/stages/` contains deterministic stage implementations and stage-local helpers.
- `src/dispatch.ts` launches nested pi sessions and reads typed `stage_return` payloads.
- `src/state.ts`, `src/resume.ts`, `src/telemetry.ts`, `src/checkpoint.ts`, and `src/worktrees.ts` implement the runtime mechanisms.
- `agents/` contains the remaining markdown leaf prompts dispatched by the controller.
- `docs/agent-inventory.md` records which legacy markdown agents were deleted versus retained.
- `test/` contains TypeScript unit and scenario tests. `npm run verify` is the local gate.

## Local Development

Install dependencies once:

```bash
npm install
```

Run the verification gate:

```bash
npm run verify
```

This runs:

```text
tsc --noEmit
node --import tsx --test test/*.test.ts
```

## Notes

- `.pipeline/` is runtime scratch state and must never be committed.
- The extension expects pi-hosted peers such as `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox`.
- The generic implementation worker is no longer a markdown agent; it is a plain nested coding session launched through the dispatcher.

## License

MIT. See [LICENSE](LICENSE).
