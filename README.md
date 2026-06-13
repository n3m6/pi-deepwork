# pi-deepwork

`pi-deepwork` is a deterministic TypeScript extension for [pi](https://github.com/mariozechner/pi-coding-agent). It runs the QRSPI deepwork pipeline in code while still reusing the bundled markdown leaf prompts for specialized synthesis, review, and reporting work.

The runtime is intentionally zero-build: pi loads `src/index.ts` directly from the package manifest, so there is no `dist/` directory, no compile step at install time, and no symlink-based agent registration hack.

## What changed

- The top-level `/deepwork` orchestration is implemented in TypeScript using a hexagonal (ports and adapters) architecture under `src/domain/`, `src/application/`, and `src/infra/`.
- Only the 36 markdown leaf agents remain in `agents/`; the deleted orchestrator prompts were replaced by code in `src/application/stage/`.
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
- `review:thorough` or `review:fast`
- `models:<profile>` — selects a named model profile from `.deepwork/models.json`

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

### `review:` — Review Loop Depth

Controls the maximum number of rounds each multi-stage review loop may run before hitting its cap.

| Value | Behavior |
|-------|----------|
| `review:thorough` | Each stage uses its full review-round budget (up to 5 rounds for goals/plan, 3 for others). |
| `review:fast` | Every review loop is capped to **2 rounds** — one initial review, one rewrite-on-fail, one re-review, then stop. Non-review retry loops (implementation retries, fix attempts) are unaffected. |

**Default**: `thorough`.

> **Recommended pairing**: `review:fast failure:best-effort`. If a review still fails after the 2-round cap, it produces an `unclean-cap` FAIL. Under `failure:best-effort` this is automatically softened to `PARTIAL` and the run proceeds rather than stopping. Without `failure:best-effort` in interactive mode, the cap hit instead triggers a human gate where you can approve, retry, or abort.

### `models:` — Model Profile

Selects a named model profile defined in `.deepwork/models.json` (see [Model Routing](#model-routing) below).

| Value | Behavior |
|-------|----------|
| `models:<name>` | Activates the named profile, overriding the file's `profile` default. |

**Default**: The `profile` field in `.deepwork/models.json`, or the user's current pi model for all tiers if the file is absent.

```text
/deepwork my task models:cheap
/deepwork my task models:max review:thorough
```

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

The codebase follows a hexagonal (ports and adapters) architecture:

- `src/index.ts` registers the `/deepwork` command and wires the composition root.
- `src/domain/` holds pure value types, the `Run` state aggregate, stage transition policies, and domain events (no infrastructure imports).
- `src/application/port/index.ts` declares all shared port types and interfaces.
- `src/application/pipeline/` contains the pipeline loop, stage runner, and outcome interpreter.
- `src/application/stage/` contains the deterministic stage implementations and sub-stages.
- `src/application/workflow/` contains multi-step workflow helpers (e.g. the agent review loop).
- `src/infra/` contains the adapters implementing the application ports: `fs/` (artifacts, state, resume), `git/` (version control, worktrees), `pi/` (session dispatcher, human gate, telemetry UI), `npm/` (build tool), `codec/` (markdown parsing), `telemetry/` (JSONL sink), and `system/` (clock, IDs).
- `agents/` contains the 36 markdown leaf prompts dispatched by the runtime.
- `docs/agent-inventory.md` records which legacy markdown agents were deleted versus retained.
- `docs/mental-model.md` is a deeper architectural walkthrough.
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

This runs, in order:

```text
tsc --noEmit
eslint --max-warnings=0 src/domain src/application src/infra test
prettier --check src/ test/
node --import tsx --test --test-concurrency=1 "test/*.test.ts" "test/**/*.test.ts"
```

## Model Routing

The pipeline routes each agent dispatch to one of four tiers, and each tier can be mapped to a different model and thinking level via a project config file.

### Tiers

| Tier | Agents | Purpose |
|------|--------|---------|
| `architect` | `goals-synthesizer`, `goals-interviewer`, `research-synthesizer`, `design-synthesizer`, `structure-mapper`, `plan-writer`, `task-spec-writer`, `replan-writer` | Frontier synthesis work; errors here cascade downstream. |
| `coding` | `generic-coding` (the programmatic implementation worker) | Agentic code writing, test writing, and verification. High tool-use volume. |
| `review` | `goals-reviewer`, `research-reviewer`, `design-reviewer`, `structure-reviewer`, `plan-reviewer`, `task-spec-reviewer`, `replan-reviewer`, all `review-*` and `review-accept-*` agents, `integration-checker`, `backward-loop-detector`, `verifier` | Read-only adversarial critique. High fan-out per task (up to 10 reviewers). |
| `utility` | `question-generator`, `question-leakage-reviewer`, `question-quality-reviewer`, `codebase-researcher`, `web-researcher`, `coverage-planner`, `baseline-checker`, `reporter` | Cheap mechanical work: extraction, search, formatting. |

### `.deepwork/models.json`

Create `.deepwork/models.json` in your workspace root (this directory is committable project config, unlike `.pipeline/` which is scratch state):

```json
{
  "profile": "balanced",
  "profiles": {
    "balanced": {
      "architect": { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
      "coding":    { "model": "deepseek/deepseek-v4-pro", "thinking": "high" },
      "review":    { "model": "deepseek/deepseek-v4-flash", "thinking": "medium" },
      "utility":   { "model": "deepseek/deepseek-v4-flash", "thinking": "medium" }
    }
  }
}
```

See `.deepwork/models.example.json` for a full example with `balanced`, `cheap`, and `max` profiles.

### Precedence

1. `models:<flag>` overrides the file's `profile` field.
2. Within the active profile, tier binding → pi default model (if tier is absent).
3. `thinking` in the tier binding overrides the agent frontmatter's `thinking:`; if both are absent, `high` is used.
4. If `.deepwork/models.json` is missing entirely, all agents use the pi session model.

Any tier can be omitted from a profile; omitted tiers fall back to the pi default model.

## Notes

- `.pipeline/` is runtime scratch state and must never be committed.
- The extension expects pi-hosted peers such as `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox`.
- The generic implementation worker is no longer a markdown agent; it is a plain nested coding session launched through the dispatcher.

## License

MIT. See [LICENSE](LICENSE).
