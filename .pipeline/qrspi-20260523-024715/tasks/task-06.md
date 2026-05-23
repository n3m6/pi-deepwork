# Task 06: Orchestrator skill (`skills/deepwork/SKILL.md`)

## Metadata
- **Task:** 06
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- **Task 01** — Project scaffolding and package manifest. The `skills/deepwork/` directory must exist under the project root (created by or after Task 01). No runtime imports from other source files are required — this is a standalone `.md` prompt consumed by pi's skill loader via `resources_discover`.

## Traceability
- **Acceptance Criteria:** AC 1 (orchestrator drives full pipeline), AC 2 (resume protocol), AC 3 (quick-fix route), AC 4 (backward loop), AC 5 (error handling), AC 6 (stage orchestration)
- **NFRs:** NFR: Usability (orchestrator prompt), NFR: Observability (telemetry instructions), NFR: Performance (sequential orchestration)
- **Replan Gate Criteria:** Phase 1 replan gate (orchestrator skill complete)

## Source Traceability
- **Goals:** AC 1, AC 2, AC 3, AC 4, AC 5, AC 6
- **Plan:** Task 06, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice — Shared Infrastructure (orchestrator skill is the runtime prompt that dispatches all pipeline stages)
- **Structure:** Foundation Slice — `skills/deepwork/SKILL.md` (CREATE)

## Description

Port the 927-line opencode orchestrator prompt from `/home/n3m6/.config/opencode/agents/deepwork.md` to a pi skill prompt at `skills/deepwork/SKILL.md`. This skill is injected into the main pi agent at pipeline start via the `resources_discover` event, turning the main agent into the pipeline orchestrator. The prompt must cover all 10 pipeline stages, pre-flight setup, quick-fix route detection, backward loop protocol, resume mode, git checkpointing, telemetry, return contract parsing, and error/abort handling.

### Role of This Skill

The skill replaces the opencode `deepwork.md` primary agent prompt. In the pi architecture, the orchestrator is the **main pi agent** — not a dispatched subagent. The main agent uses the `Agent` tool (from `@tintinweb/pi-subagents`) to dispatch stage orchestrator subagents in foreground (blocking) mode. The orchestrator itself never writes code; it sequences stages, parses return contracts, writes `state.md`, emits telemetry, commits git checkpoints, and manages route/logic decisions.

### Required Adaptations from opencode `deepwork.md`

Every section from the source prompt must be ported. Apply the following adaptations systematically throughout the entire prompt:

1. **YAML Frontmatter Removal.** The source starts with YAML frontmatter (lines 1–37). Remove all of it. Pi skills are plain markdown files without frontmatter — skill metadata is managed by the extension's `resources_discover` handler in `src/index.ts`.

2. **Replace `task` tool → `Agent` tool.** Every subagent dispatch instruction must use the pi-subagents `Agent` tool, not opencode's `task` tool. The `Agent` tool signature is:
   ```
   Use the Agent tool with:
   - subagent_type: "qrspi-goals" (or other stage agent name)
   - description: "3-5 word summary of what this subagent does"
   - prompt: the dispatch message
   ```
   All 11 stage orchestrator subagent names remain exactly the same (`qrspi-goals`, `qrspi-questions`, `qrspi-research`, `qrspi-design`, `qrspi-structure`, `qrspi-plan`, `qrspi-implement`, `qrspi-accept`, `qrspi-replan`, `qrspi-verify`, `qrspi-report`).

3. **Replace `question` → `qrspi_question`.** Every user-interactive gate must use the `qrspi_question` tool. Signature:
   ```
   Use the qrspi_question tool with:
   - header: short label (max 30 chars)
   - message: full question text
   - options: array of choices
   - type: "confirm" or "select"
   ```
   Human gates at Stages 1, 4, 5 use `type: "select"` with route/approval options. Error-handling gates use `type: "select"` with retry/abort options. Unclean-cap escalation gates at Stages 6 and 8.5 use `type: "select"` with A/B/C/D options.

4. **Remove permission system references.** Strip all opencode permission constructs:
   - Remove the rule-11 allowed-list cross-check entirely (`git diff --stat <hash>..HEAD` verification of allowed paths after Stages 8, 8.5, 9). Pi has no granular permission model; the orchestrator trusts stage subagents to honor their contracts.
   - Remove the "NO UNREVIEWED SOURCE CHANGES AFTER STAGE 7" rule (lines 55–66) and the allowed-file-writes table (lines 57–61). Replace with a simpler note: "Stage subagents are trusted to honor their allowed file surfaces — test files only for Stage 8, pipeline artifacts only for Stages 8.5/9/10."
   - Remove any references to `permission.edit`, `permission.bash`, `permission.task` from instruction text.

5. **Remove `todowrite` references.** Pi has its own built-in task tracking. Remove all `todowrite` checklist operations (visible progress checklist maintenance). Replace with a note: "Progress tracking is handled by pi's native task display. The orchestrator may use pi's plan mode syntax for user-visible status." The pre-flight checklist creation step (lines 510–523) is replaced by a pi-compatible status display instruction.

6. **Remove protocol file reads.** The source reads `protocol/deepwork-resume-protocol.md` and `protocol/deepwork-backward-loop-protocol.md` via `cat`. Inline the resume and backward-loop logic instead:
   - **Resume:** Read `.pipeline/<run-id>/state.md`. If it exists and is valid, continue from `next_stage`. If missing, infer progress from artifacts on disk. If `resume_source` is `artifacts`, reconstruct state from pipeline files. Initialize `telemetry_seq` from existing `events.jsonl` line count.
   - **Backward loop:** Six-step process: (1) emit `stage.failed` + `backward_loop.requested` telemetry, (2) regenerate `run-log.md`, (3) determine loop target from request details (the backward loop detector's classification maps to target stages: LOOP_PLAN → Stage 6, LOOP_STRUCTURE → Stage 5, LOOP_DESIGN → Stage 4, LOOP_GOALS → Stage 1, DEFER_REPLAN → Stage 8.5, NO_LOOP → continue), (4) present user decision gate via `qrspi_question`, (5) on loop-back: archive future phase directories, delete stale artifacts for the target stage and downstream, update `state.md`, rebuild visible status, (6) re-enter at the target stage or continue/defer/reset based on user choice.

7. **Simplify telemetry system.** Replace the complex event emission procedure with simplified instructions:
   - **events.jsonl:** Append one JSON line per event using `bash: date -u +%Y-%m-%dT%H:%M:%SZ` and `bash: cat` to read/write. Maintain a `telemetry_seq` counter (start at 1, on resume count existing lines + 1). Maintain `stage_instance` per (stage, phase). The event envelope fields are preserved: `schema_version`, `event_id` (`<run-id>-<seq>`), `sequence`, `ts` (UTC ISO), `run_id`, `writer_agent` (`"deepwork"`), `writer_scope` (`"orchestrator"`), `event_type`, `status`, `route`, `summary`, plus conditional scope fields (`stage`, `stage_instance`, `phase`, `task_id`, `review_round`, `attempt`, `child_agent`, `correlation_id`) and payload (`context`, `artifacts`, `timing`, `decision`, `error`, `git`).
   - **Event types preserved:** `run.started`, `run.resumed`, `run.completed`, `run.aborted`, `stage.started`, `stage.completed`, `stage.failed`, `stage.skipped`, `stage.retried`, `gate.presented`, `gate.approved`, `gate.rejected`, `backward_loop.requested`, `backward_loop.decided`, `backward_loop.deferred`, `backward_loop.reset`, `checkpoint.created`, `metrics.generated`. Gate synthesis rules from the source (lines 166) are preserved.
   - **run-log.md:** Regenerate at every stage boundary with 6 sections: Run Overview, Current Status, Timeline, Active Phase Snapshot, Failure and Loop Index, Artifact Index. Format matches the source (lines 170–226).
   - **metrics-summary.md:** Generate at Stage 10 completion and on abort with 8 sections: Run, Stage Durations, Child Agent Calls, Review Rounds, Retry and Loop Counts, Human Gate Outcomes, Test Evidence Quality, Code Health. Format matches the source (lines 228–306).

8. **Adapt return contract parsing.** The orchestrator receives subagent results from the `Agent` tool's output text (not from a separate `task` tool response). Parse the following sections from the result text:
   - `### Status — PASS | FAIL` — determines whether to advance or error-handle
   - `### Files Written` — lists pipeline artifacts produced
   - `### Route — full | quick-fix` — Stage 1 only; locks pipeline path
   - `### Phase` — from Stages 7, 8, 8.5 when applicable
   - `### Backward Loop Request` — from Stages 7, 8, 8.5 when applicable
   - `### Summary` — one-line description for state/telemetry
   - `### Telemetry` — single-line JSON for telemetry context
   - `### Report Content` — from Stage 10; present verbatim to user

### Sections the Skill Must Contain

Port and adapt every section from the source prompt. Below is the full section inventory; every section must appear in the adapted prompt:

1. **CRITICAL RULES** — The orchestrator's core constraints, adapted: (a) never write code, delegate all work to stage subagents, (b) invoke subagents directly via `Agent` tool, (c) stop and wait after each `Agent` tool dispatch, (d) follow the pipeline in order respecting route, (e) parse stage returns, (f) write `state.md` after every transition, (g) commit after every stage boundary, (h) resume from disk not memory, (i) emit telemetry at every stage boundary. Replace the forbidden-from-writing-code rule's edit-permission clause with: "YOU MAY ONLY WRITE PIPELINE STATE FILES inside `.pipeline/qrspi-<run-id>/`. You are STILL forbidden from editing any project source code."

2. **Pipeline** — ASCII diagram of full and quick-fix routes, and state storage note.

3. **Stage Subagent Architecture** — Table of all 11 stages with agent names, human gate presence, and leaf subagents called. Kept verbatim except for cross-reference terminology.

4. **Return Contract** — The structured sections the orchestrator parses from subagent output, adapted for `Agent` tool result parsing.

5. **Telemetry** — How to emit events (append to `events.jsonl`), regenerate `run-log.md`, and generate `metrics-summary.md`. Simplified per adaptation #7. Includes the full layout templates for `run-log.md` (6 sections) and `metrics-summary.md` (8 sections). Emit instructions use `bash` commands (`date -u`, `cat` + overwrite, no trailing blank lines).

6. **Resume Mode** — Inlined logic per adaptation #6: read `state.md`, recover route/phase/next stage, initialize telemetry_seq, emit `run.resumed`, treat next dispatch as re-entry (increment `stage_instance`).

7. **`state.md` Contract** — YAML frontmatter schema with all 10 fields (`run_id`, `route`, `current_phase`, `total_phases`, `last_completed_stage`, `next_stage`, `stages_completed`, `phase_history`, `backward_loops`, `resume_source`), rules for each field, and example. Preserved from source (lines 317–382).

8. **Pipeline Files Convention** — Full `.pipeline/qrspi-<run-id>/` directory tree and rules. Preserved from source (lines 384–468).

9. **Route Handling** — Full vs quick-fix determination, route locking at Stage 6, phase handling rules for multi-phase full runs. Preserved from source (lines 470–483).

10. **Pre-Flight** — The 11-step startup sequence: (1) check for resume, (2) validate task description, (3) clarify if vague using `qrspi_question`, (4) generate run ID via `bash: date +%Y%m%d-%H%M%S` with `qrspi-` prefix, (5) `mkdir -p .pipeline/qrspi-<run-id>/phases`, (6) `mkdir -p .pipeline/qrspi-<run-id>/telemetry`, initialize telemetry_seq=1, create empty events.jsonl, (7) `git checkout -b qrspi/<run-id> main`, (8) write initial state.md, (9) emit `run.started` event, (10) display visual progress status, (11) proceed to Stage 1. Adapted per adaptations #3 (question), #5 (todowrite), #7 (telemetry).

11. **Stage 1 — Goals** — Dispatch headers (`=== RUN ID ===`, `=== USER TASK ===`), return processing (parse Status, Route, update state, emit telemetry including synthesized gate events, git checkpoint, regenerate run-log). Adapted per adaptations #1 (Agent tool), #7 (telemetry).

12. **Stage 2 — Questions** — Dispatch headers (`=== RUN ID ===` only), return processing, route-aware next-stage selection (research for full, plan for quick-fix). Adapted.

13. **Stage 3 — Research** — Dispatch headers, return processing, route-aware next-stage selection (design for full, plan for quick-fix). Adapted.

14. **Stage 4 — Design (SKIP on Quick-Fix)** — Quick-fix skip path (emit `stage.skipped`, update state, git checkpoint), full-route dispatch headers (`=== RUN ID ===`), return processing with synthesized gate events for human gate. Adapted.

15. **Stage 5 — Structure (SKIP on Quick-Fix)** — Same skip/execute pattern as Stage 4. Adapted.

16. **Stage 6 — Plan** — Extended dispatch headers (`=== RUN ID ===`, `=== ROUTE ===`, `=== NEXT REMAINING PHASE ===`, `=== PRIOR PHASE MANIFEST ===`, `=== COMPLETED PHASES CONTEXT ===`, `=== FAILURE CONTEXT ===`), unclean-cap escalation gate (options A/B/C/D via `qrspi_question`), phase directory creation and symlink setup, route locking, `phase-manifest.md` reading for total_phases, state update, telemetry, git checkpoint. Adapted per adaptations #3 (question), #4 (no allowed-list check), #7 (telemetry).

17. **Stage 7 — Implement** — Dispatch headers (`=== RUN ID ===`, `=== ROUTE ===`, `=== CURRENT PHASE ===`, `=== PHASE DIR ===`), backward loop check, error handling, state update with phase_history, telemetry with phase field, git checkpoint. Quick-fix hardcodes `=== CURRENT PHASE === 1` and `=== PHASE DIR === phases/phase-01`. Adapted.

18. **Stage 8 — Acceptance Test** — Dispatch headers, backward loop check, state update, telemetry, git checkpoint. Quick-fix phase hardcoding. Adapted per adaptation #4 (simplified allowed-list checking — trust subagents).

19. **Stage 8.5 — Replan (FULL route, multi-phase only)** — Skip conditions (quick-fix, single-phase, final phase), dispatch headers (`=== RUN ID ===`, `=== ROUTE === full`, `=== COMPLETED PHASE ===`, `=== COMPLETED PHASE DIR ===`, `=== NEXT PHASE DIR ===`), return processing, unclean-cap escalation gate, phase-manifest re-read and total_phases recomputation, archive stale phase directories, rebuild status, state update with incremented phase, telemetry, git checkpoint. Adapted per adaptations #3 (question), #4 (no allowed-list check), #6 (inlined backward loop logic).

20. **Stage 9 — Verify** — Dispatch headers, auto-fix route (on FAIL: emit `stage.failed`, regenerate run-log, re-dispatch `qrspi-implement` in verify-fix mode with `=== MODE === verify-fix` and `=== VERIFY FAILURES ===` payload, process verify-fix return, re-dispatch verify exactly once more, second FAIL invokes backward loop), state update, telemetry, git checkpoint. Adapted per adaptations #1 (Agent tool for re-dispatch), #4 (simplified allowed-list checking), #7 (telemetry).

21. **Stage 10 — Report** — Dispatch headers, `### Report Content` presentation, state update to `next_stage: done`, telemetry (emit `run.completed` with final status from Verify, generate `metrics-summary.md`, emit `metrics.generated`), git checkpoint, final run-log regeneration.

22. **Backward Loop Protocol** — Inlined 6-step process per adaptation #6: (1) telemetry, (2) run-log regeneration, (3) determine loop target from request details, (4) user decision gate via `qrspi_question` with options appropriate to the loop classification, (5) on loop-back: archive future phase directories, delete stale downstream artifacts, update state.md, rebuild status display, increment target stage's `stage_instance` before its next `stage.started`, (6) re-enter at target stage or defer/continue/reset per user choice. Preserve the telemetry gate emittance pattern from the source (lines 896).

23. **Error Handling** — Adapted from source (lines 898–914): on FAIL without backward loop, emit `stage.failed`, present retry/abort gate via `qrspi_question`, on retry increment `stage_instance` and re-dispatch, on abort generate `metrics-summary.md`, emit `run.aborted`, keep pipeline directory intact. Adapted per adaptations #3 (question), #7 (telemetry).

24. **Post-Pipeline Cleanup** — Log final status based on verifier outcome from `stage9-summary.md`. Preserved from source (lines 916–924).

### File Writing Authority

The orchestrator may create or overwrite only these files and directories:
- `.pipeline/qrspi-<run-id>/state.md`
- `.pipeline/qrspi-<run-id>/telemetry/events.jsonl`
- `.pipeline/qrspi-<run-id>/telemetry/run-log.md`
- `.pipeline/qrspi-<run-id>/telemetry/metrics-summary.md`
- `.pipeline/qrspi-<run-id>/phases/` (directory creation and symlink management)
- `.pipeline/qrspi-<run-id>/phases/archive/` (archival moves)
- `.pipeline/qrspi-<run-id>/feedback/` (deferred replan and reset context files)

All other file writes — including project source, test files, and pipeline artifacts — are owned by stage subagents. The orchestrator never edits project source code, test files, or the `.pipeline/` artifacts produced by stages.

### Git Operations

The orchestrator performs git operations via `bash`:
- Branch creation: `git checkout -b qrspi/<run-id> main`
- Stage-boundary commits: `git add -A && git commit -m "qrspi: stage <N> <name> <complete|skipped>"` after dirty check (`git status --short`)
- Clean worktrees: skip commit without error

If `git` is not available, skip all git operations with a warning and continue the pipeline using only `.pipeline/` file state.

### Model and Tier Note

The orchestrator (main pi agent) typically runs with a sonnet-tier model. The skill instructions should not assume or require a specific model, but should be written with the understanding that the orchestrator has full access to all tools (`read`, `bash`, `grep`, `find`, `ls`, `write`, `edit`, `Agent`, `qrspi_question`, `qrspi_dispatch`) and sufficient reasoning capability to manage complex pipeline state decisions.

## Files
- `skills/deepwork/SKILL.md` (CREATE) — Full orchestrator prompt ported from `/home/n3m6/.config/opencode/agents/deepwork.md`. Contains all adaptations described above: `task` → `Agent` tool dispatch, `question` → `qrspi_question` tool, simplified telemetry (JSONL append + run-log regeneration + metrics summary), no permission system, inlined resume/backward-loop logic, no protocol file reads, no `todowrite` checklist. Covers pre-flight setup, all 10 stage dispatch tables with return contract parsing, quick-fix route detection with skip logic, backward loop protocol with decision gates, resume mode from `state.md`, git checkpointing after every stage boundary, and error/abort handling with retry gates.

## Test Expectations
- **Skill file discoverable:** `skills/deepwork/SKILL.md` exists and is a valid markdown file. The file path follows the pi directory-skill convention (`skills/<skill-name>/SKILL.md`), discoverable from `<cwd>/.pi/skills/`, `<cwd>/.agents/skills/`, `~/.pi/agent/skills/`, or `~/.agents/skills/`.
- **No opencode frontmatter:** The file does not contain YAML frontmatter (no `---` delimited metadata at the top). Pi skills are plain markdown.
- **No `task` tool references:** The prompt body never instructs the orchestrator to use a `task` tool or "invoke as a subagent" in the opencode sense. All subagent dispatches reference the `Agent` tool with `subagent_type`, `prompt`, and `description` parameters.
- **No `question` tool references:** The prompt body never instructs the orchestrator to use opencode's `question` tool. All user interactions reference `qrspi_question` with `header`, `message`, `options`, and `type`.
- **No permission rule enforcement:** The prompt does not reference opencode's permission system, allowed-list cross-checks (`git diff --stat` verification), or rule-11 contract enforcement. The allowed-file-writes table and post-stage diff checks are absent.
- **No `todowrite` operations:** The prompt does not instruct the orchestrator to create or update a `todowrite` progress checklist. Progress display uses pi-native mechanisms or is described generically.
- **No protocol file reads:** The prompt does not instruct the orchestrator to `cat` or `Read` files from `protocol/` or `~/.config/opencode/protocol/`. Resume and backward-loop logic is self-contained in the skill.
- **All 10 stages present:** The prompt contains a dispatch section for every pipeline stage (1 through 10) with the correct subagent name, dispatch headers, return parsing steps, state update rules, telemetry instructions, and next-stage transition logic.
- **Pre-flight present:** The prompt contains the 11-step pre-flight sequence: task validation, run ID generation (`qrspi-YYYYMMDD-HHMMSS`), directory creation, telemetry directory initialization, git branch creation, initial state.md write, `run.started` event emission, and transition to Stage 1.
- **Quick-fix route present:** The prompt contains route-determination logic at Stage 1 (`### Route — full | quick-fix`), skip logic for Stages 4 and 5 (emit `stage.skipped`, update `state.md` with `*-skipped`, still git commit), and skip logic for Stage 8.5 (quick-fix is always single-phase). Stage 6 hardcodes `total_phases: 1` for quick-fix. Route locking after Stage 6 is described.
- **Backward loop protocol present:** The prompt contains a self-contained backward loop protocol triggered by `### Backward Loop Request` from Stages 7, 8, or 8.5. The protocol includes telemetry emittance (`stage.failed` + `backward_loop.requested`), run-log regeneration, loop target determination, user decision gate via `qrspi_question`, artifact cleanup (archive future phase dirs, delete stale downstream artifacts), state.md update, and re-entry at the target stage.
- **Resume mode present:** The prompt contains a resume section that reads `state.md`, recovers `route`, `current_phase`, `last_completed_stage`, `next_stage`, and `stages_completed`. It initializes `telemetry_seq` from existing `events.jsonl` line count, emits `run.resumed`, treats the next dispatch as a re-entry (incrementing `stage_instance`), and regenerates `run-log.md` before proceeding.
- **Git checkpointing present:** After every successful stage completion and skip, the prompt instructs: `git status --short`, if dirty → `git add -A && git commit -m "qrspi: stage <N> <name> complete|skipped"`, if clean → skip commit. Commit messages use the exact format from the source.
- **Telemetry templates present:** The prompt includes the full `run-log.md` 6-section layout (Run Overview, Current Status, Timeline, Active Phase Snapshot, Failure and Loop Index, Artifact Index) and the full `metrics-summary.md` 8-section layout (Run, Stage Durations, Child Agent Calls, Review Rounds, Retry and Loop Counts, Human Gate Outcomes, Test Evidence Quality, Code Health).
- **`state.md` schema present:** The prompt documents all 10 `state.md` fields with their rules, update timing (after pre-flight, after every stage transition, after backward-loop routing, after resume recovery), and example YAML for both single-phase and multi-phase runs.
- **Pipeline file convention present:** The prompt contains the full `.pipeline/qrspi-<run-id>/` directory tree showing all artifact files per stage, with rules about symlinks, phase directories, archives, and telemetry isolation from recovery logic.
- **Human gates at correct stages:** The prompt describes human gates at Stage 1 (route selection), Stage 4 (design gate), Stage 5 (structure gate), and conditional unclean-cap gates at Stages 6 and 8.5 — all implemented via `qrspi_question`.
- **Error handling present:** The prompt describes the complete error handling flow: emit `stage.failed`, present retry/abort gate via `qrspi_question`, on retry increment `stage_instance` and re-dispatch, on abort generate metrics, emit `run.aborted`, keep pipeline directory intact.
- **Post-pipeline cleanup present:** The prompt describes the final status log after Stage 10 based on `stage9-summary.md` verifier outcome (PASS → "Pipeline PASS", PARTIAL/FAIL → "Pipeline <status>").

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
