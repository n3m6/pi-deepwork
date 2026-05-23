| ID    | Type                       | Goal Item |
| ----- | -------------------------- | --------- |
| FR-1  | Functional Requirement     | `/deepwork "task description"` command: starts a new pipeline run through all 10 stages end-to-end |
| FR-2  | Functional Requirement     | `/deepwork-resume <run-id>` command: resumes a paused or interrupted run from the next stage recorded in `state.md` |
| FR-3  | Functional Requirement     | 10 pipeline stages preserved: Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report |
| FR-4  | Functional Requirement     | File-based pipeline state protocol at `.pipeline/qrspi-<run-id>/` directory tree |
| FR-5  | Functional Requirement     | Orchestrator (main pi agent) uses `Agent` tool to dispatch stage orchestrator subagents in foreground (blocking) mode |
| FR-6  | Functional Requirement     | Custom `qrspi_dispatch` tool for stage orchestrators to spawn leaf subagents, bypassing the Agent tool block via `Symbol.for("pi-subagents:manager")` |
| FR-7  | Functional Requirement     | Custom `qrspi_question` tool for interactive user prompts via `ctx.ui` |
| FR-8  | Functional Requirement     | ~55 agent type `.md` files with YAML frontmatter (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`) |
| FR-9  | Functional Requirement     | Quick-fix route skips stages for simple scoped tasks |
| FR-10 | Functional Requirement     | Backward loop protocol triggers replan when acceptance testing identifies issues |
| FR-11 | Functional Requirement     | Git branch per run: `qrspi/<runId>` |
| FR-12 | Functional Requirement     | Telemetry: orchestrator appends events to `.pipeline/<run-id>/telemetry/events.jsonl`, regenerates `run-log.md` at stage boundaries, generates `metrics-summary.md` at Stage 10 |
| NFR-1 | Non-Functional Requirement | **Reliability**: Clean state recovery on error or user-initiated abort — the `/deepwork-resume` command reads `state.md` and resumes from the recorded next stage |
| NFR-2 | Non-Functional Requirement | **Compatibility**: Works with multiple model tiers (haiku-tier for reviewer and leaf agents, sonnet-tier for orchestrator agents); gracefully handles absence of `@tintinweb/pi-subagents` with a fallback message |
| NFR-3 | Non-Functional Requirement | **Installability**: Installable via npm symlink into `~/.pi/agent/extensions/` or via `pi install git:github.com/n3m6/deepwork-pi@main` |
| NFR-4 | Non-Functional Requirement | **Usability**: Single `/deepwork "task"` prompt initiates the full pipeline without further configuration |
| NFR-5 | Non-Functional Requirement | **Observability**: Pipeline progress and telemetry are written to `.pipeline/<run-id>/telemetry/events.jsonl`, `run-log.md`, and `metrics-summary.md` |
| NFR-6 | Non-Functional Requirement | **Performance**: Stage orchestrators run sequentially in foreground; leaf subagents dispatched by orchestrators complete before the orchestrator proceeds |
| C-1   | Constraint                 | `@tintinweb/pi-subagents` must be installed as a prerequisite |
| C-2   | Constraint                 | Pipeline state files must reside at `.pipeline/qrspi-<run-id>/` |
| C-3   | Constraint                 | All agent types are `.md` files with YAML frontmatter containing `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions` fields |
| C-4   | Constraint                 | Tool permissions are approximated via `tools` and `disallowed_tools` frontmatter fields (pi does not have opencode's granular permission system) |
| C-5   | Constraint                 | `qrspi_dispatch` depends on `Symbol.for("pi-subagents:manager")` being registered by `@tintinweb/pi-subagents` |
| C-6   | Constraint                 | All 10 pipeline stages must be preserved with quick-fix route skips and backward loop protocol |
| C-7   | Constraint                 | Stage orchestrators run in foreground (blocking) to maintain sequential pipeline flow |
| C-8   | Constraint                 | Git branch naming convention: `qrspi/<runId>` |
| C-9   | Constraint                 | Agent conversion must follow the provided opencode → pi mapping tables for frontmatter and system prompt body |
| C-10  | Constraint                 | **Git availability**: `git` must be in `$PATH` for branch creation and checkpointing. If `git` is unavailable, the extension must skip git branching with a warning message and continue the pipeline without git checkpoints; pipeline state remains tracked in `.pipeline/` files. |
| AC-1  | Acceptance Criterion       | `/deepwork "task description"` command starts a full pipeline run through all 10 stages end-to-end, producing correct artifacts in the `.pipeline/qrspi-<run-id>/` directory tree |
| AC-2  | Acceptance Criterion       | `/deepwork-resume <run-id>` command resumes a paused or interrupted run from the correct next stage as recorded in `state.md` |
| AC-3  | Acceptance Criterion       | Quick-fix route correctly skips stages for simple scoped tasks (observable: pipeline completes in fewer stages than the full 10-stage path) |
| AC-4  | Acceptance Criterion       | Backward loop protocol triggers replan when acceptance testing identifies issues (observable: a replan artifact appears in `.pipeline/<run-id>/` and the pipeline revisits the Plan stage) |
| AC-5  | Acceptance Criterion       | Error handling and user-initiated abortion result in clean state recovery (observable: `state.md` records the last completed stage, and `/deepwork-resume` successfully continues from that stage) |
| AC-6  | Acceptance Criterion       | All 10 stages produce their prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree following the file-based protocol convention |
| AC-7  | Acceptance Criterion       | Extension works with multiple model tiers: haiku-tier models for reviewer and leaf agents and sonnet-tier models for orchestrator agents |
| AC-8  | Acceptance Criterion       | Extension is installable via both methods: npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main` |
