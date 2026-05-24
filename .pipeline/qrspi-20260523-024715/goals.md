# Goals

## Intent
Build a pi extension that automates the QRSPI deepwork pipeline (Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report) via subagents, initiated with a single `/deepwork` prompt. This enables long-running, multi-stage agent pipelines for large implementation tasks. The extension brings the deepwork pipeline (previously opencode-only) to pi, with adaptations for pi's subagent architecture, tool system, and extension model.

## Functional Requirements
- `/deepwork "task description"` command: starts a new pipeline run through all 10 stages end-to-end
- `/deepwork-resume <run-id>` command: resumes a paused or interrupted run from the next stage recorded in `state.md`
- 10 pipeline stages preserved: Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report
- File-based pipeline state protocol at `.pipeline/qrspi-<run-id>/` directory tree
- Orchestrator (main pi agent) uses `Agent` tool to dispatch stage orchestrator subagents in foreground (blocking) mode
- Custom `qrspi_dispatch` tool for stage orchestrators to spawn leaf subagents, bypassing the Agent tool block via `Symbol.for("pi-subagents:manager")`
- Custom `qrspi_question` tool for interactive user prompts via `ctx.ui`
- ~55 agent type `.md` files with YAML frontmatter (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`)
- Quick-fix route skips stages for simple scoped tasks
- Backward loop protocol triggers replan when acceptance testing identifies issues
- Git branch per run: `qrspi/<runId>`
- Telemetry: orchestrator appends events to `.pipeline/<run-id>/telemetry/events.jsonl`, regenerates `run-log.md` at stage boundaries, generates `metrics-summary.md` at Stage 10

## Non-Functional Requirements
- **Reliability**: Clean state recovery on error or user-initiated abort — the `/deepwork-resume` command reads `state.md` and resumes from the recorded next stage
- **Compatibility**: Works with multiple model tiers (haiku-tier for reviewer and leaf agents, sonnet-tier for orchestrator agents); gracefully handles absence of `@tintinweb/pi-subagents` with a fallback message
- **Installability**: Installable via npm symlink into `~/.pi/agent/extensions/` or via `pi install git:github.com/n3m6/deepwork-pi@main`
- **Usability**: Single `/deepwork "task"` prompt initiates the full pipeline without further configuration
- **Observability**: Pipeline progress and telemetry are written to `.pipeline/<run-id>/telemetry/events.jsonl`, `run-log.md`, and `metrics-summary.md`
- **Performance**: Stage orchestrators run sequentially in foreground; leaf subagents dispatched by orchestrators complete before the orchestrator proceeds

## Technical Specification
- **Language**: TypeScript (CommonJS) targeting Node.js
- **Dependencies**: `@tintinweb/pi-subagents` (prerequisite, must be installed separately)
- **Extension entry**: `src/index.ts` registers `/deepwork` and `/deepwork-resume` commands, `qrspi_dispatch` and `qrspi_question` tools, and injects the `deepwork` skill via pi's extension `activate()` lifecycle
- **Extension API contract**: The implementation assumes pi provides an `activate(ctx: ExtensionContext)` hook where `ctx` exposes command registration, tool registration, and skill injection via a `resources_discover` event that provides `skillPaths`. The exact `ExtensionContext` interface is defined by pi's extension system; this implementation targets the pi extension contract as documented by the pi project.
- **`ctx.ui` API**: The `qrspi_question` tool assumes `ctx.ui` exposes `confirm(params: {header: string, message: string}): Promise<boolean>` and `select(params: {header: string, message: string, options: string[]}): Promise<string>` methods. These are provided by pi's extension runtime context.
- **Skill discovery pathway**: The `deepwork` skill is loaded from `skills/deepwork/SKILL.md` via pi's `resources_discover` event, which provides `skillPaths`. The skill file path follows the convention `skills/<skill-name>/SKILL.md` and is identified by pi's skill loader through directory structure.
- **Agent type discovery**: The ~55 agent type `.md` files are placed in `agents/` and must be discoverable by pi-subagents; they are symlinked or copied into `~/.pi/agent/agents/qrspi/` (global) or placed in `.pi/agents/` (project-local)
- **Agent prompt derivation**: The 55 agent type prompts are ported from existing opencode agent equivalents using the provided conversion tables (opencode → pi frontmatter mappings and system prompt body adaptations). The orchestrator skill is adapted from `/home/n3m6/.config/opencode/agents/deepwork.md` (~927 lines). Adaptations beyond the conversion tables are limited to: replacing `task` → `Agent` tool dispatch, replacing `question` → `qrspi_question` tool, simplifying telemetry, and removing permission system references.
- **Pipeline helpers**: `src/pipeline.ts` provides pure functions for run ID generation (`qrspi-YYYYMMDD-HHMMSS`), directory path construction, git branch naming, state file templates, and event templates
- **Tool implementation**: `src/shared-tools.ts` implements `qrspi_dispatch` (accesses `Symbol.for("pi-subagents:manager")` for sub-subagent spawning — supports foreground via `AgentManager.spawnAndWait()` and background via `AgentManager.spawn()`) and `qrspi_question` (wraps `ctx.ui` for confirm and select prompts)

## Constraints
- `@tintinweb/pi-subagents` must be installed as a prerequisite
- Pipeline state files must reside at `.pipeline/qrspi-<run-id>/`
- All agent types are `.md` files with YAML frontmatter containing `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions` fields
- Tool permissions are approximated via `tools` and `disallowed_tools` frontmatter fields (pi does not have opencode's granular permission system)
- `qrspi_dispatch` depends on `Symbol.for("pi-subagents:manager")` being registered by `@tintinweb/pi-subagents`
- All 10 pipeline stages must be preserved with quick-fix route skips and backward loop protocol
- Stage orchestrators run in foreground (blocking) to maintain sequential pipeline flow
- Git branch naming convention: `qrspi/<runId>`
- Agent conversion must follow the provided opencode → pi mapping tables for frontmatter and system prompt body
- **Git availability**: `git` must be in `$PATH` for branch creation and checkpointing. If `git` is unavailable, the extension must skip git branching with a warning message and continue the pipeline without git checkpoints; pipeline state remains tracked in `.pipeline/` files.

## Non-Goals
- `todowrite` progress checklist — pi has its own task tracking; the orchestrator may optionally use pi's plan mode syntax instead
- Permission contract enforcement (rule 11 allowed-list cross-check) — simplified: the orchestrator trusts stage subagents to honor their contracts
- Protocol file reads (`protocol/deepwork-resume-protocol.md`, etc.) — resume logic is inlined in the orchestrator skill

## Acceptance Criteria
1. `/deepwork "task description"` command starts a full pipeline run through all 10 stages end-to-end, producing correct artifacts in the `.pipeline/qrspi-<run-id>/` directory tree
2. `/deepwork-resume <run-id>` command resumes a paused or interrupted run from the correct next stage as recorded in `state.md`
3. Quick-fix route correctly skips stages for simple scoped tasks (observable: pipeline completes in fewer stages than the full 10-stage path)
4. Backward loop protocol triggers replan when acceptance testing identifies issues (observable: a replan artifact appears in `.pipeline/<run-id>/` and the pipeline revisits the Plan stage)
5. Error handling and user-initiated abortion result in clean state recovery (observable: `state.md` records the last completed stage, and `/deepwork-resume` successfully continues from that stage)
6. All 10 stages produce their prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree following the file-based protocol convention
7. Extension works with multiple model tiers: haiku-tier models for reviewer and leaf agents and sonnet-tier models for orchestrator agents
8. Extension is installable via both methods: npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main`
