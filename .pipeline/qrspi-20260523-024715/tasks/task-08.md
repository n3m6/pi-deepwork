# Task 08: Foundation and Stage 1 tests

## Metadata
- **Task:** 08
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- **Task 05** — The extension entry point `src/index.ts` exports `activate(pi: ExtensionAPI)`, which registers `/deepwork` and `/deepwork-resume` commands, `qrspi_dispatch` and `qrspi_question` tools, and subscribes to the `resources_discover` event to inject the orchestrator skill. The command and tool registration paths, parameter schemas, and the `resources_discover` handler return shape (`{ skillPaths: string[] }`) must be present for the activation tests. Also depends on the `ExtensionAPI`, `ExtensionContext`, `CommandDefinition`, and `ToolDefinition` interfaces from `src/types/pi-extensions.ts` (created in Task 02), and the pipeline helper functions exported by `src/pipeline.ts` (Task 03) and tool factory functions from `src/shared-tools.ts` (Task 04).
- **Task 06** — The orchestrator skill file `skills/deepwork/SKILL.md` must exist on disk at the expected path relative to the project root, so the `resources_discover` handler's returned `skillPaths` can be verified to point to a real file.
- **Task 07** — The three Stage 1 agent type files (`agents/qrspi-goals.md`, `agents/qrspi-goals-synthesizer.md`, `agents/qrspi-goals-reviewer.md`) must exist with valid YAML frontmatter and non-empty system prompt bodies for the frontmatter validation tests.

## Traceability
- **Acceptance Criteria:** AC 5 (error handling test coverage), AC 6 (Stage 1 test evidence)
- **NFRs:** NFR: Reliability (test coverage for pipeline helpers, shared tools, and agent frontmatter)
- **Replan Gate Criteria:** Phase 1 replan gate — all tests in this task pass

## Source Traceability
- **Goals:** AC 5, AC 6
- **Plan:** Task 08, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice (Shared Infrastructure), Slice 1 (Stage 1 — Goals)
- **Structure:** Foundation Slice — `test/index.test.ts` (CREATE), `test/shared-tools.test.ts` (CREATE); Slice 1 — `test/pipeline-helpers.test.ts` (CREATE), `test/agents/qrspi-goals.test.ts` (CREATE); `test/index.test.js` (DELETE)

## Description

Create TypeScript test files that verify the Foundation layer and Stage 1 components of the deepwork-pi extension. Delete the obsolete `test/index.test.js` (which only tests the starter `getReadyMessage()` function) and replace it with `test/index.test.ts` covering extension activation, command registration, tool registration, and skill injection. The test suite uses Node.js's built-in test runner (`node:test` and `node:assert/strict`).

All test files are written as TypeScript (`.test.ts`) and must be compilable to JavaScript for execution via `node --test`. The existing `tsconfig.json` has `rootDir: "src"`; if the compilation path does not include the `test/` directory, the implementer must adjust the `tsconfig.json` or provide an alternative compilation step so that tests compile and run. The `npm test` script is `"npm run build && node --test ./test/**/*.test.js"`.

The `test/agents/` subdirectory does not currently exist and must be created. The `test/` directory currently contains only `test/index.test.js`.

### File-by-file breakdown

**`test/index.test.ts` (CREATE):** Extension activation and registration tests. Import the compiled extension module and the type interfaces. Create a mock `ExtensionAPI` object with the methods `registerCommand`, `registerTool`, and `on` instrumented to record calls and arguments. Invoke `activate(mockPi)` and assert:

- The `/deepwork` command is registered exactly once with a non-empty description and a handler function.
- The `/deepwork-resume` command is registered exactly once with a non-empty description and a handler function.
- The `qrspi_dispatch` tool is registered exactly once with a `name`, `description`, and `parameters` schema that includes `subagent_type`, `prompt`, `description`, and `run_in_background` fields, plus an `execute` function.
- The `qrspi_question` tool is registered exactly once with a `name`, `description`, and `parameters` schema that includes `header`, `message`, `options`, and `type` fields, plus an `execute` function.
- A `resources_discover` event listener is subscribed (via `on`). When the handler is invoked, it returns an object with a `skillPaths` array containing at least one path that, when resolved, points to `skills/deepwork/SKILL.md` and the file exists on disk.

**`test/shared-tools.test.ts` (CREATE):** Unit tests for the `qrspi_dispatch` and `qrspi_question` tool implementations exported from `src/shared-tools.ts`. The test file imports `createDispatchTool` and `createQuestionTool` (which return `ToolDefinition` objects) and exercises their `execute` methods directly.

For `qrspi_dispatch`:

- **Foreground mode:** Set `Symbol.for("pi-subagents:manager")` on `globalThis` to a mock `AgentManagerFacade` whose `spawnAndWait()` resolves with a result. Call `execute` with params including `run_in_background: false`. Assert the returned `content` contains the text from the mock subagent's result. Assert the `details` object (if present) includes `status: "completed"` and a `result` string.
- **Background mode:** Use the same mock facade whose `spawn()` returns an agent ID string. Call `execute` with `run_in_background: true`. Assert the returned `content` includes the agent ID, and `spawnAndWait` was not invoked.
- **Graceful fallback:** Delete or set to `undefined` the `Symbol.for("pi-subagents:manager")` on `globalThis` (restoring it after the test). Call `execute` with any valid params. Assert the returned `content` includes a descriptive error message indicating that `@tintinweb/pi-subagents` must be installed. Assert no uncaught exception is thrown.
- **Error propagation:** Mock `spawnAndWait()` to reject with an error. Call `execute` in foreground mode. Assert the tool returns a failure result (content contains the error message) instead of throwing.

For `qrspi_question`:

- **Confirm type:** Mock `ctx.ui.confirm` to resolve to `true` on one call and `false` on another. Call `execute` with `type: "confirm"` and verify the returned `content` is `"User confirmed: Yes"` (when the mock resolves to `true`) and `"User confirmed: No"` (when the mock resolves to `false`). Verify the mock's `confirm` was called exactly once per execution.
- **Select type:** Mock `ctx.ui.select` to resolve to one of the provided options. Call `execute` with `type: "select"` and a non-empty `options` array. Assert the returned `content` equals `"User selected: <option>"` where `<option>` is the option string the mock resolved to.
- **Select cancellation:** Mock `ctx.ui.select` to resolve to `undefined` (user cancelled). Call `execute` with `type: "select"`. Assert the tool returns a result indicating cancellation (e.g., an empty string or a clear cancellation message).
- **Invalid type:** Call `execute` with `type` set to an unrecognized string (neither `"confirm"` nor `"select"`). Assert the tool returns an error message.

**`test/pipeline-helpers.test.ts` (CREATE):** Unit tests for the pure helper functions exported from `src/pipeline.ts`. Import `generateRunId`, `getPipelineDir`, `getGitBranch`, `getStatePath`, `getTelemetryDir`, `getEventsPath`, `getRunLogPath`, `getMetricsPath`, `makeInitialState`, `makeTelemetryEvent`, `STAGE_NAMES`, `stageNumber`, `nextStage`, and the `PipelineState` and `TelemetryEvent` interfaces.

- **`generateRunId()` format:** Call the function multiple times. Assert each returned string matches `/^qrspi-\d{8}-\d{6}$/`. Parse the date and time components and assert they represent a valid UTC date and a valid 24-hour time between `000000` and `235959`. Assert that calls within the same second return identical IDs, and calls across a second boundary return different IDs.
- **`getPipelineDir(runId)`:** Assert that `getPipelineDir("qrspi-20260515-143022")` returns `".pipeline/qrspi-20260515-143022"`.
- **`getGitBranch(runId)`:** Assert that `getGitBranch("qrspi-20260515-143022")` returns `"qrspi/qrspi-20260515-143022"`.
- **`getStatePath(runId)`:** Assert returns `".pipeline/qrspi-20260515-143022/state.md"`.
- **`getTelemetryDir(runId)`:** Assert returns `".pipeline/qrspi-20260515-143022/telemetry"`.
- **`getEventsPath(runId)`:** Assert returns `".pipeline/qrspi-20260515-143022/telemetry/events.jsonl"`.
- **`getRunLogPath(runId)`:** Assert returns `".pipeline/qrspi-20260515-143022/telemetry/run-log.md"`.
- **`getMetricsPath(runId)`:** Assert returns `".pipeline/qrspi-20260515-143022/telemetry/metrics-summary.md"`.
- **`makeInitialState(runId)`:** Call with a sample run ID. Assert the returned `PipelineState` object has all ten fields populated: `run_id` matches the input, `route` is `""`, `current_phase` is `1`, `total_phases` is `0`, `last_completed_stage` is `"0"`, `next_stage` is `"1"`, `stages_completed` is an empty array, `phase_history` is an empty array, `backward_loops` is `0`, `resume_source` is `"fresh"`. Assert the returned object is serializable to YAML (implementer may serialize and verify the YAML is parseable).
- **`makeTelemetryEvent(runId, eventType, overrides)`:** Call with a run ID, an event type string (e.g., `"run.started"`), and partial overrides. Assert the returned `TelemetryEvent` object contains all required envelope fields: `schema_version` (non-empty string), `event_id` (non-empty string), `sequence` (integer, defaults to `0`), `ts` (valid ISO 8601 UTC string), `run_id` (matches input), `writer_agent`, `writer_scope`, `event_type` (matches input), `status`, `route`, `summary`. Assert that overrides provided in the `overrides` parameter are merged into the returned object. Assert that providing `sequence` in overrides replaces the default value.
- **`STAGE_NAMES`:** Assert the array contains at least 10 entries matching the pipeline stage names in execution order. Verify that the stage name for index 0 (Stage 1) is `"goals"` and the last entry is `"report"`.
- **`stageNumber(name)`:** Assert `stageNumber("goals")` returns `1`, `stageNumber("questions")` returns `2`, `stageNumber("report")` returns `11`. Assert that an unrecognized stage name returns `0`.
- **`nextStage(current, route)` full route:** Assert `nextStage("goals", "full")` returns `"questions"`. Assert `nextStage("report", "full")` returns `null` (end of pipeline). Walk through all 10 stage transitions for the full route and verify each returns the correct next stage name.
- **`nextStage(current, route)` quick-fix route:** Assert the quick-fix route skips the Design, Structure, and Replan stages. Specifically, `nextStage("research", "quick-fix")` must not return `"design"` — it returns the stage that follows Structure in the full sequence. Assert `nextStage("report", "quick-fix")` returns `null`.

**`test/agents/qrspi-goals.test.ts` (CREATE):** Frontmatter validation tests for the three Stage 1 agent type files. Read each file (`agents/qrspi-goals.md`, `agents/qrspi-goals-synthesizer.md`, `agents/qrspi-goals-reviewer.md`) from disk, parse the YAML frontmatter between `---` delimiters, and validate the structure.

For each of the three files:
- **Valid YAML frontmatter:** The content between the first `---` line and the second `---` line parses as valid YAML without throwing.
- **Required fields present:** The frontmatter object contains the keys `description`, `tools`, `model`, and `max_turns`, each with a non-empty value.
- **`model` field:** The `model` value is a non-empty string. It may contain a provider prefix and model ID (e.g., `"anthropic/claude-haiku-4-5"`) or a tier name (e.g., `"haiku"`). The test does not validate model availability, only that the field is set.
- **`tools` field:** The `tools` value is a non-empty string. If the value is `"all"`, accept it as valid. If it is a comma-separated list, accept it as valid.
- **`max_turns` field:** The value is a positive integer.
- **System prompt body:** The content after the closing `---` delimiter is a non-empty string (whitespace-only content counts as empty and fails).
- **Expected frontmatter fields per agent role:** The orchestrator (`qrspi-goals.md`) must have `tools: all` or an equivalent full-tool-access value. The leaf agents (`qrspi-goals-synthesizer.md`, `qrspi-goals-reviewer.md`) may have restricted tool sets — their `tools` values need not be `"all"`.

**`test/index.test.js` (DELETE):** Delete the existing file. It tests the starter `getReadyMessage()` function from the old `src/index.ts`, which is replaced by the new extension factory `activate()`. This file is superseded by `test/index.test.ts`.

## Files
- `test/index.test.ts` (CREATE) — Extension activation tests: verifies `/deepwork` and `/deepwork-resume` command registration, `qrspi_dispatch` and `qrspi_question` tool registration, and `resources_discover` skill injection, using a mock `ExtensionAPI`.
- `test/shared-tools.test.ts` (CREATE) — `qrspi_dispatch` unit tests covering foreground and background dispatch modes, graceful fallback when pi-subagents is absent, and error propagation; `qrspi_question` unit tests covering confirm, select, cancellation, and invalid type paths, using mock `AgentManagerFacade` and mock `ctx.ui`.
- `test/pipeline-helpers.test.ts` (CREATE) — Pure function tests: `generateRunId` format/validity/uniqueness, all path-construction helpers (`getPipelineDir`, `getGitBranch`, `getStatePath`, `getTelemetryDir`, `getEventsPath`, `getRunLogPath`, `getMetricsPath`), `makeInitialState` shape and field defaults, `makeTelemetryEvent` envelope validation and sequence increment, `STAGE_NAMES` ordering, `stageNumber` lookup, and `nextStage` transitions for both `full` and `quick-fix` routes.
- `test/agents/qrspi-goals.test.ts` (CREATE) — Frontmatter validation for the three Stage 1 agent `.md` files: parses YAML frontmatter, asserts required fields (`description`, `tools`, `model`, `max_turns`) are present and non-empty, validates `model` is set and `max_turns` is a positive integer, asserts the system prompt body after frontmatter is non-empty.
- `test/index.test.js` (DELETE) — Replaced by `test/index.test.ts`.

## Test Expectations
- When `activate()` is called with a mock `ExtensionAPI`, expect the `/deepwork` and `/deepwork-resume` commands are registered (each has a description and a handler function) and the `qrspi_dispatch` and `qrspi_question` tools are registered (each has a name, description, parameters schema, and execute function).
- When the `resources_discover` handler registered by `activate()` is invoked, expect the returned value includes a `skillPaths` array containing a path that resolves to an existing `skills/deepwork/SKILL.md` file on disk.
- When `qrspi_dispatch` executes in foreground mode (`run_in_background: false`) with pi-subagents available, expect the tool returns the dispatched subagent's output text in its result content.
- When `qrspi_dispatch` executes in background mode (`run_in_background: true`) with pi-subagents available, expect the tool returns an agent ID string without blocking for completion.
- When `qrspi_dispatch` executes but `@tintinweb/pi-subagents` is not installed (the global symbol is undefined), expect the tool returns a descriptive error message explaining the missing prerequisite, without throwing an uncaught exception.
- When `qrspi_dispatch` executes in foreground mode and the subagent dispatch fails, expect the tool returns a failure result containing the error message instead of throwing.
- When `qrspi_question` executes with `type: "confirm"`, expect the tool returns `"User confirmed: Yes"` or `"User confirmed: No"` matching the confirm prompt response.
- When `qrspi_question` executes with `type: "select"` and valid options, expect the tool returns `"User selected: <option>"` with the selected option string.
- When `qrspi_question` executes with `type: "select"` and the user cancels, expect the tool returns a result indicating the cancellation.
- When `qrspi_question` executes with an unrecognized `type` value, expect the tool returns an error message.
- When `generateRunId()` is called, expect the returned string matches the pattern `qrspi-YYYYMMDD-HHMMSS` with valid date and time components, and calls within the same second produce identical IDs while calls across a second boundary produce different IDs.
- When `getPipelineDir("qrspi-20260515-143022")` is called, expect it returns `".pipeline/qrspi-20260515-143022"`.
- When `getGitBranch("qrspi-20260515-143022")` is called, expect it returns `"qrspi/qrspi-20260515-143022"`.
- When `getStatePath("qrspi-20260515-143022")` is called, expect it returns `".pipeline/qrspi-20260515-143022/state.md"`.
- When `getTelemetryDir("qrspi-20260515-143022")` is called, expect it returns `".pipeline/qrspi-20260515-143022/telemetry"`.
- When `getEventsPath("qrspi-20260515-143022")` is called, expect it returns `".pipeline/qrspi-20260515-143022/telemetry/events.jsonl"`.
- When `getRunLogPath("qrspi-20260515-143022")` is called, expect it returns `".pipeline/qrspi-20260515-143022/telemetry/run-log.md"`.
- When `getMetricsPath("qrspi-20260515-143022")` is called, expect it returns `".pipeline/qrspi-20260515-143022/telemetry/metrics-summary.md"`.
- When `makeInitialState("qrspi-20260515-143022")` is called, expect the returned object contains all ten `PipelineState` fields with correct defaults (route empty, phase 1, stage 0, stages_completed empty, phase_history empty, backward_loops 0, resume_source "fresh").
- When `makeTelemetryEvent(runId, eventType, overrides)` is called, expect the returned object contains all required envelope fields (schema_version, event_id, sequence, ts, run_id, writer_agent, writer_scope, event_type, status, route, summary) with non-empty values; the default `sequence` is `0` and can be overridden via the third parameter.
- When `nextStage("goals", "full")` is called, expect it returns `"questions"`; when `nextStage("report", "full")` is called, expect it returns `null`.
- When `nextStage` is called with the `"quick-fix"` route, expect it skips `"design"` and `"structure"` stages, returning the next non-skipped stage name or `null` at pipeline end.
- When parsing `agents/qrspi-goals.md` frontmatter, expect the YAML between `---` delimiters parses without error and contains non-empty `description`, `tools`, `model`, and `max_turns` fields.
- When parsing `agents/qrspi-goals-synthesizer.md` and `agents/qrspi-goals-reviewer.md` frontmatter, expect the same required fields are present and non-empty, and the `model` field contains a model identifier string.
- When parsing any of the three Stage 1 agent files, expect the content after the closing `---` frontmatter delimiter is a non-empty string.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
