# Task 23: README and installation documentation

## Metadata
- **Task:** 23
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 4b — Integration

## Dependencies
- **Task 01** (Project scaffolding and package manifest): `package.json` must exist with the `name` (`deepwork-pi`), `description`, `repository.url` (`git+https://github.com/n3m6/pi-deepwork.git`), and `peerDependencies` (`@tintinweb/pi-subagents`) fields populated. The README references the package name, repository URL, and prerequisite dependency for installation instructions.

## Traceability
- **Acceptance Criteria:** AC 8 (Installation documentation — both methods: npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main`)
- **NFRs:** NFR: Installability (documentation), NFR: Usability (usage docs)
- **Replan Gate Criteria:** Phase 4 replan gate (README complete)

## Source Traceability
- **Goals:** AC 8 (Extension is installable via both methods: npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main`)
- **Plan:** Task 23, Phase 4 — Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix)
- **Design:** Slice 4b — Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix)
- **Structure:** Slice 4b — Resume, Quick-Fix Route, and Edge Cases; Convention note 3 (README must document both agent type discovery paths); Convention note 8 (`@tintinweb/pi-subagents` as optional peer dependency, graceful degradation); Convention note 9 (git-availability skip behavior)

## Description

Replace the existing README.md stub with comprehensive project documentation covering every aspect of installing and using the deepwork-pi extension. The README is the first-facing document for users and must be self-contained — a user with no prior knowledge of the deepwork pipeline should be able to install the prerequisites, install the extension in either of two ways, configure agent type discovery, run their first `/deepwork` command, and troubleshoot common failures.

### Document Structure

The README must contain the following sections in order:

#### 1. Title and One-Liner
The `# pi-deepwork` title followed by a one-line description that captures the extension's purpose: a pi extension that automates the QRSPI deepwork pipeline (Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report) via 55 specialized subagents, initiated with a single `/deepwork` prompt.

#### 2. Prerequisites
List every prerequisite with version requirements where applicable:
- **pi** — the AI coding agent runtime. The extension uses pi's extension API (`ExtensionAPI`, `ExtensionContext`), `ctx.ui` for interactive prompts, and `resources_discover` for skill injection.
- **`@tintinweb/pi-subagents`** (v0.7.3+) — installed separately via `pi install npm:@tintinweb/pi-subagents`. This provides the `Agent` tool for subagent dispatch and `AgentManager` for sub-subagent spawning via `Symbol.for("pi-subagents:manager")`.
- **Node.js** (v18+) — TypeScript compilation target and runtime.
- **git** (optional) — for per-run branch creation (`qrspi/<run-id>`) and stage-boundary commits. The extension skips git operations with a warning if `git` is not in `$PATH`; pipeline state remains tracked in `.pipeline/` files.
- **Model availability** — at least one model tier accessible. Leaf agents and reviewers default to haiku-tier models; orchestrator agents require sonnet-tier models.

#### 3. Installation
Document two complete installation methods, each in its own subsection with exact commands. Make it clear the user must first install the prerequisite:

**Method A: Git clone + npm symlink (development/npm workflow)**
```bash
# 1. Install the prerequisite
pi install npm:@tintinweb/pi-subagents

# 2. Clone and build
git clone https://github.com/n3m6/pi-deepwork.git
cd pi-deepwork
npm install
npm run build

# 3. Symlink extension into pi's global extensions directory
ln -s "$(pwd)" ~/.pi/agent/extensions/deepwork-pi

# 4. Symlink agent types into pi's global agents directory
ln -s "$(pwd)/agents" ~/.pi/agent/agents/qrspi
```

Explain what each step does:
- Step 1: Installs `pi-subagents` which registers the `Agent` tool and `AgentManager` for subagent dispatch.
- Step 2: Clones the repository and compiles TypeScript to CommonJS in `dist/`.
- Step 3: Creates a symlink so pi's extension discovery scans pick up `index.ts` from `~/.pi/agent/extensions/deepwork-pi/`.
- Step 4: Creates a symlink so pi-subagents discovers the 55 agent type `.md` files from `~/.pi/agent/agents/qrspi/*.md`.

**Method B: `pi install git:` (package manager workflow)**
```bash
# 1. Install the prerequisite
pi install npm:@tintinweb/pi-subagents

# 2. Install the extension via pi's package manager
pi install git:github.com/n3m6/deepwork-pi@main
```

Explain that `pi install git:` performs a full clone, runs `npm install --omit=dev` if `package.json` exists, and places the extension in pi's managed extensions directory. Note that agent type discovery still requires the user to either symlink `agents/` to `~/.pi/agent/agents/qrspi/` or create a project-local `.pi/agents/` directory (see Agent Type Discovery section).

Include a clarification note about the repository naming: The GitHub repository name is `pi-deepwork` but the `pi install` package name is `deepwork-pi`. The `pi install git:` URL uses the package name (`deepwork-pi`), while manual cloning uses the repository URL (`https://github.com/n3m6/pi-deepwork.git`). This follows pi's extension naming convention — the two names refer to the same codebase.

#### 4. Agent Type Discovery
Document the two ways pi-subagents discovers the 55 agent type files:

- **Global installation** (recommended for cross-project use): Symlink or copy the `agents/` directory into `~/.pi/agent/agents/qrspi/`. Pi-subagents scans `$PI_CODING_AGENT_DIR/agents/*.md` (default: `~/.pi/agent/agents/*.md`). Files are discovered by filename (minus `.md`), so `agents/qrspi-goals.md` becomes agent type `qrspi-goals`.
- **Project-local installation**: Place agent files in `<cwd>/.pi/agents/`. Pi-subagents scans `<cwd>/.pi/agents/*.md` first (highest priority). Same-named project files override global and built-in defaults.

Include an explicit note that both paths work — global for users who run pipelines across multiple projects, project-local for users who want per-project agent type isolation.

#### 5. Usage
Document the two slash commands:

**`/deepwork "task description"`**
```
pi /deepwork "Build a real-time chat application with WebSocket support"
```
- Starts a new pipeline run through all 10 stages end-to-end.
- Generates a run ID (`qrspi-YYYYMMDD-HHMMSS`), creates `.pipeline/<run-id>/` directory tree, checks out a git branch `qrspi/<run-id>`, writes initial `state.md`, and injects the deepwork orchestrator skill into the main agent.
- Stage 1 presents a human gate asking the user to select the route: `full` (all 10 stages, multi-phase) or `quick-fix` (fewer stages, skips Design and Structure).

**`/deepwork-resume <run-id>`**
```
pi /deepwork-resume qrspi-20260515-143022
```
- Resumes a paused or interrupted pipeline run from the next stage recorded in `.pipeline/<run-id>/state.md`.
- Validates the run ID exists, reads `state.md`, injects the deepwork skill, and dispatches the next stage orchestrator.
- Accepts an optional `--reset` flag to restart the pipeline from Stage 1 while preserving the existing `.pipeline/` directory.

#### 6. Model Tier Setup
Explain the model assignment convention:
- **Orchestrator agents** (qrspi-goals through qrspi-report, qrspi-code-review) default to the parent model (typically sonnet-tier). These agents coordinate multi-step workflows, dispatch leaf subagents, parse return contracts, and write state files — they need stronger reasoning.
- **Leaf and reviewer agents** default to haiku-tier models. These agents do read-only analysis, code generation within strict budgets, or single-concern review — a cheaper model is sufficient.
- All agent type `.md` files specify a `model` field in their YAML frontmatter. Pi-subagents resolves model names via fuzzy matching against available models. If a specified model is unavailable, pi-subagents falls back to the parent agent's model.
- Users can override model assignments by editing the `model` field in individual agent type files.

#### 7. Pipeline Artifacts
Briefly describe the `.pipeline/qrspi-<run-id>/` directory tree the pipeline produces:
- `state.md` — stage-boundary checkpoint with run metadata (10 fields: `run_id`, `route`, `current_phase`, `total_phases`, `last_completed_stage`, `next_stage`, `stages_completed`, `phase_history`, `backward_loops`, `resume_source`).
- `goals.md`, `questions.md`, `research/summary.md`, `design.md`, `structure.md`, `plan.md` — planning artifacts produced by Stages 1–6.
- `telemetry/events.jsonl` — append-only event log with 25 event types covering run, stage, phase, gate, child-agent, review, backward-loop, checkpoint, artifact, and metrics events.
- `telemetry/run-log.md` — regenerated at stage boundaries with 6 sections: Run Overview, Current Status, Timeline, Active Phase Snapshot, Failure and Loop Index, Artifact Index.
- `telemetry/metrics-summary.md` — generated at completion with 8 sections: Run, Stage Durations, Child Agent Calls, Review Rounds, Retry and Loop Counts, Human Gate Outcomes, Test Evidence Quality, Code Health.

#### 8. Troubleshooting
Document solutions for common failure modes:

- **`pi-subagents not installed`**: The extension loads but `/deepwork` emits a clear prerequisite-missing message. Solution: run `pi install npm:@tintinweb/pi-subagents`.
- **Agent types not discovered**: The orchestrator dispatches a stage agent but pi-subagents cannot find the agent type. Solution: verify the `agents/` symlink points to a valid directory, or check that `.pi/agents/` contains the agent `.md` files.
- **git not found**: The extension prints a warning and continues without git branching. Pipeline state remains in `.pipeline/` files. Solution: install git or ignore the warning — the pipeline works without git.
- **Model not found**: Pi-subagents logs a model-resolution failure. Solution: verify the model string in the agent type frontmatter matches an available model, or remove the `model` field to inherit the parent agent's model.
- **Naming confusion — `pi-deepwork` vs `deepwork-pi`**: The GitHub repository name is `pi-deepwork` (cloned from `https://github.com/n3m6/pi-deepwork.git`) while the pi package name is `deepwork-pi` (used in `pi install git:github.com/n3m6/deepwork-pi@main`). Both names refer to the same codebase — the distinction follows pi's extension naming convention. If a "repo not found" or "package not found" error occurs during `pi install git:`, verify you used `deepwork-pi` in the install URL, not `pi-deepwork`. For manual cloning, use the repository URL with `pi-deepwork`.

- **Deepwork skill not injected**: The orchestrator prompt does not activate. Solution: verify `skills/deepwork/SKILL.md` exists at the expected path and that the `resources_discover` handler returns `skillPaths` pointing to the `skills/` directory.
- **Pipeline hangs after stage completion**: The orchestrator failed to parse the subagent's return contract. Solution: check the subagent's output in the pi session log for missing `### Status` or malformed `### Files Written` blocks; the pipeline can be resumed with `/deepwork-resume <run-id>`.

## Files
- `README.md` (MODIFY) — Replace the existing 11-line stub with a full README containing: project title and one-liner, prerequisites section, two complete installation methods with exact shell commands, agent type discovery documentation (global and project-local paths), usage examples for `/deepwork` and `/deepwork-resume`, model tier setup guidance, pipeline artifacts overview, and a troubleshooting section covering common failure modes. Every command shown must be copy-pasteable and syntactically correct. Every path referenced must match the actual project layout (`agents/`, `skills/deepwork/SKILL.md`, `src/index.ts`, `.pipeline/qrspi-<run-id>/`).

## Test Expectations
- **Prerequisites are listed**: A reader new to the project can identify every prerequisite (pi, `@tintinweb/pi-subagents`, Node.js, git) from the Prerequisites section without reading any other section.
- **Install Method A is complete and executable**: The git-clone + npm-symlink instructions include all four steps (clone, build, extension symlink, agent symlink) with exact paths; a user following them verbatim on a system with pi and `@tintinweb/pi-subagents` installed would end up with a working extension.
- **Install Method B is complete**: The `pi install git:` instructions include the exact install URL with `@main` ref (`pi install git:github.com/n3m6/deepwork-pi@main`) and a note about the remaining agent-discovery step; the URL matches the install path specified in the goals (AC 8).
- **Both agent type discovery paths are documented**: The README describes global installation via `~/.pi/agent/agents/qrspi/` and project-local installation via `.pi/agents/`, with an explanation of discovery priority (project-local overrides global).
- **Usage examples are correct**: The `/deepwork "task"` example shows a quoted task string; the `/deepwork-resume <run-id>` example shows a valid run ID format (`qrspi-YYYYMMDD-HHMMSS`); both commands are shown with the `pi ` prefix.
- **Model tier documentation is accurate**: The README distinguishes orchestrator agents (sonnet-tier) from leaf/reviewer agents (haiku-tier) and explains that model inheritance works by omission in the frontmatter.
- **Troubleshooting covers known failure modes**: The section addresses at least five distinct failure scenarios (pi-subagents missing, agent types not discovered, git not found, model not found, skill not injected) and provides actionable solutions for each.
- **Pipeline artifacts are described**: The README lists the key files produced in `.pipeline/qrspi-<run-id>/` with brief descriptions of `state.md`, planning artifacts, and telemetry files.
- **No stale content from the original stub**: The README does not reference `npm start`, the `getReadyMessage()` function, or the TypeScript setup commands from the replaced stub.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
