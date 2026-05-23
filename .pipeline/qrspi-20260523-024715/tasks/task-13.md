# Task 13: Stage 6 agent types (Plan)

## Metadata
- **Task:** 13
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 2e — Plan

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 6 agent types), AC 7 (model tier frontmatter)
- **NFRs:** NFR: Compatibility (model tier)
- **Replan Gate Criteria:** Phase 2 replan gate (Plan agents complete)

## Source Traceability
- **Goals:** AC 6 (all 10 stages produce artifacts), AC 7 (works with multiple model tiers)
- **Plan:** Task 13, Phase 2 — Planning Pipeline
- **Design:** Slice 2: Planning Pipeline — Stages 2–6, specifically the Stage 6 plan orchestrator and its five leaf agents (plan writer, task spec writer, task spec reviewer, plan reviewer, baseline checker)
- **Structure:** Slice 2e — Plan Stage (Stage 6); files `agents/qrspi-plan.md`, `agents/qrspi-plan-writer.md`, `agents/qrspi-task-spec-writer.md`, `agents/qrspi-task-spec-reviewer.md`, `agents/qrspi-plan-reviewer.md`, `agents/qrspi-baseline-checker.md`

## Description

Create six agent type `.md` files for the Stage 6 (Plan) pipeline stage. Each file follows the pi-subagents YAML frontmatter convention and contains a system prompt body ported from the corresponding opencode agent source at `/home/n3m6/.config/opencode/agents/`. Apply the opencode-to-pi conversion rules documented in `requirements.md`.

If the `agents/` directory does not exist at the project root, create it. Write exactly six files.

### Conversion Rules (applied to all six agents)

**Frontmatter mappings:**
- opencode `description` → pi `description` (verbatim or lightly edited for pi context)
- opencode `steps: N` → pi `max_turns: N` (use the outline values below, which may differ from opencode's steps)
- opencode `hidden: true` → pi `enabled: false` (hidden from default listing, spawnable by orchestrator)
- opencode `permission.edit: allow` → pi `tools: all`
- opencode `permission.edit: deny` → pi `tools: read, bash, grep, find, ls`
- opencode `permission.webfetch: deny` → pi `extensions: false`
- opencode `permission.task` / `permission.question` / `permission.todowrite` → dropped (not applicable in pi)
- opencode `mode: subagent` / `temperature: 0.1` / `permission.bash` → dropped (not applicable in pi)
- Always include: `prompt_mode: replace`

**System prompt body adaptations:**
- Replace `Invoke <agent-name> as a subagent:` with `Use the qrspi_dispatch tool with subagent_type: "<agent-name>"`
- Replace `cat .pipeline/...` instructions with `Read .pipeline/...` (use the Read tool)
- Replace `mkdir -p .pipeline/...` instructions with `bash: mkdir -p .pipeline/...`
- Replace `date -u +...` with `bash: date -u +...`
- Replace references to the opencode `question` tool with `qrspi_question`
- Replace references to `task` (the opencode subagent dispatch tool) with `qrspi_dispatch` when dispatching child agents
- Replace `@build` subagent dispatch (in baseline checker) with direct `bash` command execution to run build/lint/typecheck/E2E/test commands
- Remove all opencode permission system references, the `todowrite` tool, and the `question` tool where it doesn't map to `qrspi_question`
- Preserve all pipeline directory paths (`.pipeline/<run-id>/...`), run ID references (`qrspi-<timestamp>`), stage names, route names (`full`, `quick-fix`), return contract formats (`### Status — PASS/FAIL`, `### Files Written`, `### Summary`), and structured output tables verbatim
- The `qrspi_dispatch` tool and `qrspi_question` tool are available to agents whose tools include `all` (stage orchestrators and writers). Agents with read-only tools (`read, bash, grep, find, ls`) do not have access to `qrspi_dispatch`.

### Agent File Details

#### 1. `agents/qrspi-plan.md` (Stage 6 Orchestrator)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-plan.md` (~400 lines)

**Frontmatter:**
```yaml
description: "Stage 6 orchestrator — reads route-appropriate inputs, dispatches the plan writer for outlines, runs the outline-level plan review loop, generates task specs after plan acceptance, runs per-task spec review, appends review status, and dispatches the baseline checker. Writes plan.md, phase-manifest.md, task outlines, canonical tasks/task-NN.md, review artifacts, and baseline-results.md."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 80
prompt_mode: replace
extensions: false
enabled: false
```

**System prompt adaptations (key changes from opencode source):**
- The orchestrator uses `qrspi_dispatch` to dispatch all five leaf agents: `qrspi-plan-writer`, `qrspi-task-spec-writer`, `qrspi-task-spec-reviewer`, `qrspi-plan-reviewer`, `qrspi-baseline-checker`
- Replace all `Invoke <agent> as a subagent:` blocks with dispatch instructions using `qrspi_dispatch` (foreground mode, since the orchestrator waits for each leaf agent to complete before proceeding)
- The `cat` commands in Step A (Read Inputs) become `Read` tool calls
- The `mkdir -p` commands in Step B become `bash: mkdir -p` calls
- The edit/write instructions for plan files use the `Write` or `edit` tool
- Preserve all six steps (A–F), the shared context variable bindings, the LOOPBACK block template, the plan review loop (Step C.2 with rounds, stable-cap/unclean-cap states), the task spec generation and review guard (Step D), the review status append (Step E), and the baseline checker dispatch (Step F)
- Preserve the quality gate section listing hard-fail conditions (missing AC coverage, forward dependencies, plan/outline disagreement, phase-manifest disagreement, placeholders, multi-task quick-fix)
- Preserve the return contract format (`### Status — PASS/FAIL`, `### Files Written`, `### Summary`, `### Telemetry`) verbatim
- The `qrspi_question` tool is not used by this agent (no human gates in Stage 6 per the opencode source — the orchestrator returns review state and deepwork escalates)

#### 2. `agents/qrspi-plan-writer.md` (Plan Writer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-plan-writer.md` (~173 lines)

**Frontmatter:**
```yaml
description: "Writes a plan overview, phase manifest, and structured per-task outlines. The Stage 6 orchestrator uses the returned outlines to dispatch per-task spec writers. Supports full and quick-fix routes and preserves traceability to requirements, NFRs, replan gates, and repository instructions from AGENTS.md."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 60
prompt_mode: replace
extensions: false
enabled: false
```

**System prompt adaptations:**
- The plan writer reads upstream artifacts using the `Read` tool (not `cat`)
- In retry revision mode (when Current Plan, Current Phase Manifest, and Current Task Outlines are all present), it reads from disk using `Read` if the Run ID is provided
- All output contract sections (`### plan.md`, `### phase-manifest.md`, `### task-NN.outline`) and structured schemas are preserved verbatim
- The Hard Requirements section (no placeholders, complete coverage notes, per-task AC traceability, stable task IDs, forward-pointing dependencies, internal consistency, quick-fix cardinality, completed-phase immutability, cross-phase coupling justification, AGENTS Guidance application, retry draft mutation) is preserved verbatim
- This agent does not dispatch subagents (it is a writer, not an orchestrator), so no `qrspi_dispatch` references are needed

#### 3. `agents/qrspi-task-spec-writer.md` (Task Spec Writer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-task-spec-writer.md` (~139 lines)

**Frontmatter:**
```yaml
description: "Writes a single detailed task-NN.md spec from the persisted task outline and upstream pipeline artifacts in the pipeline run directory. Produces a self-contained task spec with concrete files, test expectations, dependencies, source traceability, and metadata."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 40
prompt_mode: replace
extensions: false
enabled: false
```

**System prompt adaptations:**
- The Required Reads section: replace `cat` with `Read` tool calls for all pipeline artifact paths
- The Workflow and Task Spec Schema are preserved verbatim — this agent is already written in a tool-agnostic style that works for both opencode and pi
- The Hard Invariants (8 rules) are preserved verbatim
- The Quality Checklist is preserved verbatim
- The Return format (`### Status — PASS/FAIL`) is preserved verbatim
- This agent does not dispatch subagents, so no `qrspi_dispatch` references are needed

#### 4. `agents/qrspi-task-spec-reviewer.md` (Task Spec Reviewer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-task-spec-reviewer.md` (~106 lines)

**Frontmatter:**
```yaml
description: "Per-task reviewing agent for Stage 6. Reads goals.md, the current task outline, the current task spec, and the active sibling task specs from the canonical top-level tasks directory to check outline-to-spec fidelity, structure-slice fidelity, source-traceability completeness, and cross-task consistency. Returns review findings and fix guidance."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 25
prompt_mode: replace
extensions: false
enabled: false
```

**System prompt adaptations:**
- The opencode source allows this reviewer to edit the current task spec in place (`permission.edit: allow`). In the pi conversion, this agent uses read-only tools per the outline specification. Adapt the system prompt so that instead of editing the task file in place, the reviewer records needed changes under `### Mutations Applied` as fix guidance (describing what should change and why, without executing the edit). The orchestrator is responsible for applying mutations based on the reviewer's guidance.
- Change the Operating Contract: remove `Edit only .pipeline/<run-id>/tasks/task-NN.md`, replace with guidance to record mutations in the output without editing files
- In the Process section: instead of "edit `.pipeline/<run-id>/tasks/task-NN.md`", write "record each needed change in `### Mutations Applied`"
- All review checks (Outline and scope, Upstream traceability, Local spec quality, Dependencies, Active sibling consistency, AGENTS compliance) are preserved verbatim
- The output format (`### Status — PASS/FAIL`, `### Review Findings` table, `### Mutations Applied`, `### Unresolved Cross-Task Conflicts`, `### Summary`) is preserved verbatim
- This agent does not dispatch subagents, so no `qrspi_dispatch` references are needed

#### 5. `agents/qrspi-plan-reviewer.md` (Plan Reviewer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-plan-reviewer.md` (~216 lines)

**Frontmatter:**
```yaml
description: "Reviews the current Stage 6 planning artifacts from the pipeline run directory for AGENTS guidance compliance, requirements coverage, dependency correctness, phase quality, outline completeness, and traceability. Reads plan.md, phase-manifest.md, and active task outlines. Flags placeholders, forward dependencies, vague file maps, missing NFR coverage, completed-phase preservation defects, and conflicts with AGENTS.md. Read-only."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 30
prompt_mode: replace
extensions: false
enabled: false
```

**System prompt adaptations:**
- This agent is already read-only in the opencode source (`permission.edit: deny`), so the conversion is straightforward
- Replace `cat` commands for reading artifacts with `Read` tool calls
- The Input section: the agent reads `plan.md`, `phase-manifest.md`, and `tasks/outlines/task-NN.outline` files from disk using the `Read` tool
- All 16 review areas (Goals coverage through Placeholder-free quality) are preserved verbatim
- The output format (`### Status — PASS/FAIL`, `### Review Findings` table, `### Fix Guidance`, `### Weakest Areas`, `### Summary`) is preserved verbatim
- The Rules section and Red Flags section are preserved verbatim
- The Worked Examples (good review and bad review) are preserved verbatim
- This agent does not dispatch subagents, so no `qrspi_dispatch` references are needed

#### 6. `agents/qrspi-baseline-checker.md` (Baseline Checker)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-baseline-checker.md` (~96 lines)

**Frontmatter:**
```yaml
description: "Records the pre-implementation build, lint, typecheck, E2E, and test baseline for a QRSPI run. Captures known failures without fixing them. Runs standard project checks via bash."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
enabled: false
```

**System prompt adaptations:**
- The opencode source delegates check execution to a `@build` subagent. In pi, the baseline checker runs commands directly using the `bash` tool
- Replace the `Invoke @build as a subagent with the received artifacts and these instructions:` block with direct execution: the agent reads the pipeline config and plan using the `Read` tool, then discovers and runs the project's standard checks (Build, Lint, Typecheck, E2E, Tests) using `bash`
- Discovery logic: check `package.json` for relevant scripts (`build`, `lint`, `typecheck`, `test`, `test:e2e`); check for config files (`.eslintrc.*`, `tsconfig.json`, `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `cypress.config.*`); use the discovered commands or report `NOT CONFIGURED` if none exist
- Preserve the four status categories: `PASS`, `FAIL`, `NOT CONFIGURED`, `SKIPPED`
- Preserve the `coverage_threshold` handling from pipeline config — run the coverage tool if the threshold is set
- The output format (`### Baseline Status — CLEAN/DIRTY`, `### Check Results` table, `### Failure Inventory` table, `### Stage Summary`) is preserved verbatim
- This agent does not dispatch subagents, so no `qrspi_dispatch` references are needed

## Files
- `agents/qrspi-plan.md` (CREATE) — Stage 6 orchestrator agent type. YAML frontmatter with `tools: all`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 80`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from the opencode source with adaptations: `Invoke <agent> as a subagent` → `qrspi_dispatch` tool, `cat` → `Read` tool, `mkdir -p` → `bash: mkdir -p`, opencode permission system removed.
- `agents/qrspi-plan-writer.md` (CREATE) — Plan writer agent type. YAML frontmatter with `tools: all`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 60`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from the opencode source with adaptations: `cat` → `Read` tool, all output contract schemas preserved verbatim, hard requirements preserved.
- `agents/qrspi-task-spec-writer.md` (CREATE) — Task spec writer agent type. YAML frontmatter with `tools: all`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 40`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from the opencode source with adaptations: `cat` → `Read` tool, task spec schema and quality checklist preserved verbatim.
- `agents/qrspi-task-spec-reviewer.md` (CREATE) — Task spec reviewer agent type. YAML frontmatter with `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 25`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from the opencode source with adaptations: edit-in-place capability replaced with fix-guidance-only output (agent records mutations under `### Mutations Applied` without editing files, since tools are read-only).
- `agents/qrspi-plan-reviewer.md` (CREATE) — Plan reviewer agent type. YAML frontmatter with `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 30`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from the opencode source with adaptations: `cat` → `Read` tool. All 16 review areas, rules, red flags, and worked examples preserved verbatim.
- `agents/qrspi-baseline-checker.md` (CREATE) — Baseline checker agent type. YAML frontmatter with `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from the opencode source with adaptations: `@build` subagent dispatch replaced with direct `bash` command execution to discover and run standard project checks. Output contract tables preserved verbatim.

## Test Expectations
- **Frontmatter validity:** When each agent file is read by pi-subagents' agent type loader, expect the YAML frontmatter to parse without errors, with all required fields present (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`, `enabled`).
- **Model tier correctness:** When the orchestrator/synthesizer/writer agents (`qrspi-plan`, `qrspi-plan-writer`, `qrspi-task-spec-writer`) are spawned, expect their resolved model to be `anthropic/claude-sonnet-4-5` (sonnet-tier). When the reviewer/checker agents (`qrspi-task-spec-reviewer`, `qrspi-plan-reviewer`, `qrspi-baseline-checker`) are spawned, expect their resolved model to be `anthropic/claude-haiku-4-5` (haiku-tier).
- **Tool assignment correctness:** When the orchestrator and writer agents (`qrspi-plan`, `qrspi-plan-writer`, `qrspi-task-spec-writer`) are spawned, expect them to have access to all 7 built-in tools (`read`, `bash`, `grep`, `find`, `ls`, `write`, `edit`). When the reviewer and checker agents (`qrspi-task-spec-reviewer`, `qrspi-plan-reviewer`, `qrspi-baseline-checker`) are spawned, expect them to have access to only 5 read-only tools (`read`, `bash`, `grep`, `find`, `ls`).
- **System prompt completeness:** When each agent file is loaded, expect the system prompt body (content after frontmatter) to contain all major sections from its opencode source equivalent — including input specifications, process steps, invariant rules, output format contracts, and structured table schemas. No section from the opencode source should be silently dropped except as explicitly documented in the conversion rules (permission system, `todowrite`, `question` where not mapped to `qrspi_question`).
- **Dispatch instruction presence:** When the `qrspi-plan` orchestrator's system prompt body is loaded, expect every leaf agent dispatch instruction to reference `qrspi_dispatch` with the correct `subagent_type` name (e.g., `subagent_type: "qrspi-plan-writer"`, `subagent_type: "qrspi-task-spec-writer"`, etc.), formatted consistently with the qrspi_dispatch tool's parameter schema.
- **Baseline checker command execution:** When the `qrspi-baseline-checker` system prompt body is loaded, expect it to contain instructions for discovering and running build/lint/typecheck/E2E/test commands directly via `bash` (not via subagent dispatch), with the four status categories (`PASS`, `FAIL`, `NOT CONFIGURED`, `SKIPPED`) preserved.
- **Task spec reviewer read-only behavior:** When the `qrspi-task-spec-reviewer` system prompt body is loaded, expect it to instruct the agent to record mutations as fix guidance in the output rather than editing task files in place, consistent with its read-only tool set.
- **Return contract preservation:** When each orchestrator/writer agent's system prompt body is loaded, expect it to define a return contract using the `### Status — PASS` or `### Status — FAIL` format with documented fields (`### Files Written`, `### Summary`, and where applicable `### Telemetry` and `### Report Content`).
- **Quick-fix route handling:** When the `qrspi-plan` orchestrator's system prompt body is loaded, expect it to handle the quick-fix route (exactly one task, no design/structure artifacts read, omitting `=== DESIGN ===` and `=== STRUCTURE ===` from the plan writer dispatch prompt) as documented in the opencode source.
- **Review loop invariants:** When the `qrspi-plan` orchestrator's system prompt body is loaded, expect the plan review loop (Step C.2) to enforce the 6-round cap, stable-cap detection on identical `### Fix Guidance` output on consecutive FAIL rounds, and the task-spec review guard (skip Step D.2 when terminal state is `stable-cap` or `unclean-cap`).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
