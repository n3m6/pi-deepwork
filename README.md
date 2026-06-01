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

## Pipeline

Full route:

```text
Goals -> Research -> Design -> Structure -> Plan -> (Implement -> Accept -> Replan)* -> Verify -> Report
```

Quick-fix route:

```text
Goals -> Research -> Plan -> Implement -> Accept -> Verify -> Report
```

The controller decides the route at Stage 1, checkpoints stage boundaries in git, and resumes from persisted state or inferred artifacts when needed.

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
