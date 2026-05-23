# Task 22: Integration tests (E2E pipeline, resume, quick-fix, backward loop, error handling)

## Metadata
- **Task:** 22
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 4b — Integration

## Dependencies
- **Task 08** (Foundation and Stage 1 tests): Validates that the foundation layer — `src/pipeline.ts` helpers (`generateRunId`, `getPipelineDir`, `getStatePath`, `getTelemetryDir`, `makeInitialState`, `makeTelemetryEvent`, `nextStage`, `STAGE_NAMES`, `PipelineState`, `TelemetryEvent`), `src/shared-tools.ts` tool factories (`createDispatchTool`, `createQuestionTool`, `DispatchResult`), and `src/index.ts` extension entry with `/deepwork` and `/deepwork-resume` command handlers — is functioning correctly. Integration tests import the source files (created by Tasks 03–05) to construct pipeline state fixtures, validate stage transitions, and verify artifact path generation.
- **Task 13** (Stage 6 agent types): Provides `qrspi-plan.md`, `qrspi-plan-writer.md`, `qrspi-task-spec-writer.md`, `qrspi-task-spec-reviewer.md`, `qrspi-plan-reviewer.md`, and `qrspi-baseline-checker.md` agent types. These define the plan-stage artifact shapes (`plan.md`, `phase-manifest.md`, task specs, baseline snapshots) that integration tests reference when constructing fixture directories for full-pipeline flow and when validating artifact-tree completeness after 10 stages.
- **Task 20** (Backward loop and replan agents): Provides `qrspi-backward-loop-detector.md` (6 classification tiers: LOOP_GOALS, LOOP_DESIGN, LOOP_STRUCTURE, DEFER_REPLAN, NO_LOOP, LOOP_PLAN), `qrspi-replan.md`, `qrspi-replan-writer.md`, and `qrspi-replan-reviewer.md` agent types. Integration tests use these agent-type names and classification labels to construct accurate mocked Agent responses and to assert that the orchestrator dispatches the correct replan subagent when a backward loop is detected.
- **Task 21** (Stage 9–10 agent types): Provides `qrspi-verify.md`, `qrspi-verifier.md`, `qrspi-report.md`, and `qrspi-reporter.md` agent types. Integration tests need these for full 10-stage E2E completion scenarios: asserting the orchestrator dispatches `qrspi-verify` at Stage 9 (with auto-fix fallback logic), dispatches `qrspi-report` at Stage 10, and validates that `metrics-summary.md` is generated with all 8 prescribed sections.

## Traceability
- **Acceptance Criteria:** AC 1 (full pipeline E2E — 10 stages producing correct artifacts), AC 2 (resume from state — `/deepwork-resume` reads `state.md` and continues from correct next stage), AC 3 (quick-fix route — pipeline completes in fewer stages than full 10-stage path), AC 4 (backward loop — replan artifact appears and pipeline revisits Plan stage), AC 5 (error handling and abort — clean state recovery via `state.md`), AC 6 (all 10 stage artifacts — prescribed files appear in `.pipeline/qrspi-<run-id>/`)
- **NFRs:** NFR: Reliability (state recovery tests validate clean recovery on error/abort), NFR: Performance (sequential orchestration test validates foreground blocking dispatch order)
- **Replan Gate Criteria:** Phase 4 replan gate — Integration tests pass: full 10-stage pipeline produces all prescribed artifacts; `/deepwork-resume` recovers from each stage boundary; quick-fix route completes in fewer stages; backward loop triggers replan and pipeline revisits Plan stage; error and abort scenarios leave clean state.

## Source Traceability
- **Goals:** AC 1, AC 2, AC 3, AC 4, AC 5, AC 6
- **Plan:** Task 22, Phase 4 — Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix)
- **Design:** Slice 4b — Resume, Quick-Fix Route, and Edge Cases
- **Structure:** Slice 4b — Resume, Quick-Fix Route, and Edge Cases; `test/integration.test.ts` (CREATE)

## Description
Create a comprehensive integration test file at `test/integration.test.ts` that validates the orchestrator's pipeline decision logic end-to-end using mocked Agent tool responses and temporary filesystem fixtures. No live model calls are made — the tests exercise the command handler and pipeline helper code paths that drive stage advancement, route selection, state recovery, backward-loop detection, and error handling.

### Test Framework and Conventions
- Use `node:test` for test structure (`describe`/`it` or `test` blocks) and `node:assert/strict` for assertions.
- The file is TypeScript source (`.test.ts`) that compiles to `dist/test/integration.test.js` and executes via `node --test ./test/**/*.test.js`.
- Import pipeline helpers from `../src/pipeline.ts` (compiled to `../dist/pipeline.js` at runtime) and command-handler functions from `../src/index.ts`.
- Use `node:fs/promises` for filesystem operations and `node:path` for path construction.
- Use `node:os.tmpdir()` to create isolated temporary directories for each test case; clean up in `afterEach`/`after` hooks.
- Mock the `Agent` tool by stubbing the pi-subagents integration point; stage orchestrator responses are provided as plain-text fixtures matching the return contract format (`### Status`, `### Files Written`, `### Route`, `### Backward Loop Request`, `### Summary`).

### Test Suite Structure

#### 1. Full 10-Stage Pipeline E2E
Exercise the orchestrator's stage-advancement loop for a `route: full` run. Create a temporary `.pipeline/qrspi-<run-id>/` directory tree with an initial `state.md` fixture (`last_completed_stage: 0`, `next_stage: 1`, `route: full`). Mock the Agent tool to return a PASS response for each of the 10 stage orchestrators in sequence, with `### Files Written` listing the expected artifacts for that stage. Invoke the stage-advancement function (or simulate the orchestrator loop by calling `nextStage` iteratively) and assert:
- After all 10 stages complete, the final `state.md` records `last_completed_stage: 10`, `stages_completed` contains entries for stages 1 through 10, and `next_stage` is null or empty.
- The `stages_completed` array follows the correct sequence: `goals`, `questions`, `research`, `design`, `structure`, `plan`, `implement`, `accept`, `replan`, `verify`, `report` (note: `replan` is included only when a backward loop is triggered; on a clean run without backward loop, stages 7 through 10 are `implement`, `accept`, `verify`, `report`).
- The artifact trees produced across all stages match the file-based protocol convention: `goals.md`, `questions.md`, `research/summary.md`, `design.md`, `structure.md`, `plan.md`, `phase-manifest.md`, `tasks/task-NN.md` files, `phases/phase-NN/` directories, `telemetry/events.jsonl`, `telemetry/run-log.md`, and `telemetry/metrics-summary.md` all appear under `.pipeline/<run-id>/`.
- Telemetry events are appended to `events.jsonl` after each stage boundary, and each event line is valid JSON containing the required envelope fields (`schema_version`, `event_id`, `sequence`, `ts`, `run_id`, `writer_agent`, `writer_scope`, `event_type`, `status`, `route`, `summary`).
- `run-log.md` is regenerated after each stage boundary with 6 prescribed sections: Run Overview, Current Status, Timeline, Active Phase Snapshot, Failure and Loop Index, Artifact Index.
- `metrics-summary.md` is generated at Stage 10 completion with all 8 prescribed sections: Run, Stage Durations, Child Agent Calls, Review Rounds, Retry and Loop Counts, Human Gate Outcomes, Test Evidence Quality, Code Health.

#### 2. Resume Recovery from Each Stage Boundary
Test the `/deepwork-resume` flow by constructing `state.md` fixtures at each of the following stage boundaries:
- After Stage 1: `last_completed_stage: 1`, `next_stage: 2`, `route: full`
- After Stage 3: `last_completed_stage: 3`, `next_stage: 4`, `route: full`
- After Stage 5: `last_completed_stage: 5`, `next_stage: 6`, `route: full`
- After Stage 7: `last_completed_stage: 7`, `next_stage: 8`, `route: full`
- After Stage 9: `last_completed_stage: 9`, `next_stage: 10`, `route: full`

For each fixture, invoke the resume handler (or the state-reading and stage-dispatch functions it uses). Assert:
- The handler reads the `state.md` fixture and correctly identifies `next_stage`.
- The handler dispatches the correct stage orchestrator subagent for that `next_stage` (e.g., `qrspi-design` for Stage 4, `qrspi-implement` for Stage 7).
- After the dispatched stage completes, `state.md` is updated with the correct `last_completed_stage` and `next_stage` advanced by one.
- Resume from any boundary can proceed through all remaining stages to completion.
- When the run ID does not exist (no `.pipeline/<run-id>/` directory), the handler returns an error and does not create a partial directory.
- When `state.md` is corrupted (malformed YAML or missing required fields), the handler returns an error indicating the state file is unreadable.

#### 3. Quick-Fix Route
Test that the quick-fix route correctly skips stages. Construct a fixture where Stage 1 returns `### Route — quick-fix` and `state.md` has `route: quick-fix`. Mock the Agent tool to return PASS for each dispatched stage. Assert:
- The `nextStage` helper, when called with `route: "quick-fix"`, skips Stage 4 (Design) and Stage 5 (Structure). For example, `nextStage("research", "quick-fix")` returns `"plan"` (Stage 6), not `"design"` (Stage 4).
- After the pipeline completes via the quick-fix route, `state.md` records fewer than 10 `stages_completed` entries (no Design, Structure, or Replan stages).
- The route field in `state.md` remains `quick-fix` throughout and is never changed to `full` after completion.
- Artifacts from skipped stages (e.g., `design.md`, `structure.md`) do not appear in the `.pipeline/<run-id>/` tree.
- Quick-fix route locks after Stage 6: once `stages_completed` includes `plan`, the route cannot change.

#### 4. Backward Loop Detection and Replan
Test the backward-loop protocol. Construct a fixture where the pipeline has completed through Stage 7 and is at Stage 8 (Accept). Mock the Stage 8 orchestrator (`qrspi-accept`) to return `### Status — FAIL` with `### Backward Loop Request`. Assert:
- The orchestrator detects the backward loop request and dispatches `qrspi-backward-loop-detector` with the acceptance failure context.
- Based on the detector's mocked classification (e.g., `LOOP_PLAN`), the orchestrator transitions to Stage 8.5 (Replan) and dispatches `qrspi-replan` with the correct headers (`=== COMPLETED PHASE ===`, `=== NEXT PHASE DIR ===`).
- A replan artifact (e.g., `replan.md` or an updated `plan.md`) appears in `.pipeline/<run-id>/`.
- After replan completes successfully, the orchestrator loops back to the correct prior stage: `LOOP_PLAN` loops to Stage 6 (Plan), `LOOP_STRUCTURE` loops to Stage 5 (Structure), `LOOP_DESIGN` loops to Stage 4 (Design), `LOOP_GOALS` loops to Stage 1 (Goals).
- `state.md` records the backward loop: `backward_loops` increments, and `last_completed_stage` reflects the loop target (not the failed stage).
- `DEFER_REPLAN` classification does not trigger an immediate loop; the orchestrator records the deferral and continues to the next stage.
- `NO_LOOP` classification on a FAIL without a backward-loop request triggers the retry/abort human gate instead of transitioning to replan.

#### 5. Error Handling Scenarios

**a. Subagent Failure (Stage Returns FAIL without Backward Loop)**
Mock any stage orchestrator to return `### Status — FAIL` without `### Backward Loop Request`. Assert the orchestrator does not advance `last_completed_stage` in `state.md`. Assert it invokes the retry/abort decision path (presenting a human gate via `qrspi_question` with confirm-type options for retry vs. abort). Verify that selecting "abort" records the abort in `state.md` and does not advance to the next stage.

**b. Missing Pipeline State**
Invoke `/deepwork-resume` with a run ID for which no `.pipeline/<run-id>/state.md` exists. Assert the handler returns an error (not a crash) and no new directories or files are created under `.pipeline/`.

**c. Git Unavailable**
Simulate the condition where `git` is not in `$PATH` (stub the `isGitAvailable` check to return `false`). Invoke the `/deepwork` command pre-flight logic. Assert that the pipeline directory and `state.md` are created successfully, but no git branch creation is attempted. Assert that a warning message is emitted (via `console.warn` or equivalent) indicating git operations are skipped. Assert the pipeline proceeds through all stages using only the `.pipeline/` file state for tracking.

**d. Abort Mid-Pipeline and Recovery**
Simulate an abort signal after Stage 5 completes (before Stage 6 begins). Assert that `state.md` records `last_completed_stage: 5` and `next_stage: 6`. Simulate an abort signal mid-stage (during Stage 7 execution). Assert that `state.md` still reflects `last_completed_stage: 6` (the last fully completed stage) and `next_stage: 7` — the mid-stage interruption restarts that stage from its beginning on resume.

#### 6. Sequential Orchestration (Foreground Dispatch Order)
Validate that stage orchestrators are dispatched in foreground (blocking) sequence. Mock the Agent tool to track dispatch order and timing. Assert:
- Stage N+1 is never dispatched before Stage N's mock response is processed.
- The `stages_completed` array in `state.md` never contains out-of-order entries.
- The dispatch sequence follows the correct stage order for the given route (full: 1→2→3→4→5→6→7→8→(8.5 if loop)→9→10; quick-fix: 1→2→3→6→7→8→9→10).

## Files
- `test/integration.test.ts` (CREATE) — Comprehensive integration test suite covering: full 10-stage E2E pipeline with mocked Agent responses and artifact-tree validation; resume recovery from fixtures at stages 1, 3, 5, 7, and 9 boundaries; quick-fix route detection and stage-skip validation; backward-loop detection, replan dispatch, and loop-back-to-correct-stage validation; error-handling scenarios (subagent FAIL without loop, missing state, unavailable git, abort mid-pipeline); and sequential foreground dispatch order verification. All tests use temporary filesystem fixtures and mocked Agent tool responses; no live model calls are required.

## Test Expectations
- **Full pipeline E2E**: When the orchestrator completes all 10 stages for a `route: full` run with each stage returning `### Status — PASS`, `state.md` records `last_completed_stage: 10` and every prescribed artifact file (`goals.md`, `questions.md`, `research/summary.md`, `design.md`, `structure.md`, `plan.md`, `phase-manifest.md`, task specs, `telemetry/events.jsonl`, `telemetry/run-log.md`, `telemetry/metrics-summary.md`) exists under `.pipeline/<run-id>/`.
- **Resume after Stage 3**: When `/deepwork-resume` is invoked with a `state.md` fixture recording `last_completed_stage: 3` and `next_stage: 4`, the handler dispatches `qrspi-design` (the Stage 4 orchestrator) and the pipeline continues from Stage 4 through Stage 10 to completion.
- **Resume with missing run ID**: When `/deepwork-resume` is invoked with a run ID that has no `.pipeline/<run-id>/` directory, the handler returns an error without creating any new directories or state files.
- **Resume with corrupted state**: When `/deepwork-resume` is invoked and the run's `state.md` contains malformed YAML or is missing required fields (`run_id`, `next_stage`), the handler returns an error indicating the state file is unreadable.
- **Quick-fix route skips stages**: When Stage 1 returns `### Route — quick-fix` and the pipeline runs to completion, `design.md` and `structure.md` do not appear in the artifact tree, and `state.md` `stages_completed` contains fewer than 10 entries with no `design`, `structure`, or `replan` stages.
- **Quick-fix `nextStage` jump**: When `nextStage("research", "quick-fix")` is called, it returns `"plan"` (Stage 6), skipping `"design"` (4) and `"structure"` (5).
- **Backward loop triggers replan**: When Stage 8 (`qrspi-accept`) returns `### Status — FAIL` with `### Backward Loop Request` and the detector classifies it as `LOOP_PLAN`, the orchestrator dispatches `qrspi-replan` at Stage 8.5, a replan artifact appears in `.pipeline/<run-id>/`, and `state.md` `backward_loops` increments from 0 to 1.
- **Backward loop routes to correct prior stage**: When the backward-loop detector classifies `LOOP_STRUCTURE`, the orchestrator loops to Stage 5 (`qrspi-structure`); when classified `LOOP_DESIGN`, it loops to Stage 4 (`qrspi-design`); when classified `LOOP_GOALS`, it loops to Stage 1 (`qrspi-goals`).
- **DEFER_REPLAN does not loop**: When the detector classifies `DEFER_REPLAN`, the orchestrator records the deferral but continues to the next stage (Stage 9) without dispatching `qrspi-replan` or modifying `last_completed_stage` retroactively.
- **Subagent FAIL without backward loop**: When any stage orchestrator returns `### Status — FAIL` without `### Backward Loop Request`, `state.md` `last_completed_stage` is not advanced, and the orchestrator presents a retry/abort decision gate rather than transitioning to the next stage or entering the backward-loop protocol.
- **Git unavailable**: When `git` is not available in `$PATH`, the `/deepwork` pre-flight creates `.pipeline/<run-id>/` and `state.md` successfully, emits a warning message about skipped git operations, and the pipeline runs to completion using only file-based state tracking without any git branch or commit operations.
- **Abort after Stage 5**: When an abort signal is received after Stage 5 completes, `state.md` records `last_completed_stage: 5` and `next_stage: 6`; subsequent `/deepwork-resume` dispatches Stage 6 (`qrspi-plan`) as the next stage.
- **Abort mid-Stage 7**: When an abort signal is received during Stage 7 execution (before it returns PASS), `state.md` still reflects `last_completed_stage: 6` (the last fully completed stage), and subsequent `/deepwork-resume` redispatches Stage 7 from its beginning, not from a mid-task checkpoint.
- **Foreground dispatch order**: When the orchestrator dispatches stages 1 through 10 with all stages returning PASS, the dispatch of Stage N+1 never begins before Stage N's mock response has been fully processed and `state.md` has been updated with Stage N's completion.
- **Telemetry events after each stage**: After each stage completes successfully, `events.jsonl` contains one additional valid JSON line with `event_type: "stage.completed"`, the correct `stage` number, and all required envelope fields.
- **`metrics-summary.md` at Stage 10**: When Stage 10 completes successfully, `metrics-summary.md` is generated under `.pipeline/<run-id>/telemetry/` and contains all 8 prescribed sections (Run, Stage Durations, Child Agent Calls, Review Rounds, Retry and Loop Counts, Human Gate Outcomes, Test Evidence Quality, Code Health).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
