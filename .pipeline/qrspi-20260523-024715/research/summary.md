# Research Summary

## Overview
This research catalogues the QRSPI pipeline orchestration system, which executes a 10-stage workflow (Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report) via 55 specialized subagent files. The deepwork orchestrator dispatches stage subagents with structured prompt headers, parses a fixed return contract, emits JSONL telemetry at every boundary, and commits git checkpoints per stage. The system runs atop two extension frameworks: Pi's native extension API (factory-function lifecycle, `ExtensionAPI`, `resources_discover`) and the `@tintinweb/pi-subagents` (v0.7.3) package, which provides the `Agent` tool, `AgentManager`, and model resolution. Agent type definitions use YAML-frontmatter `.md` files discovered from project-local and global directories, with 15 optional config fields controlling tools, models, isolation, and prompt composition.

## Deepwork Pipeline Architecture
- The pipeline executes 10 sequential stages; each stage dispatches one `qrspi-*` stage orchestrator subagent (`deepwork.md:70-99`).
- Stage 1 (Goals) determines the route: **`full`** (multi-phase, all stages) or **`quick-fix`** (single-phase, skips Design, Structure, Replan) — `deepwork.md:472-475`.
- Route is locked after Stage 6 (Plan) completes (`deepwork.md:477`, `deepwork.md:690`).
- Multi-phase full runs cycle Stage 7 → Stage 8 → Stage 8.5 repeatedly until the final phase, then enter Stage 9 (`deepwork.md:479-483`).
- Stage dispatch table with inputs:
  - Stage 1: `=== RUN ID ===`, `=== USER TASK ===` — `deepwork.md:534-539`
  - Stage 2–5, 9–10: `=== RUN ID ===` only — `deepwork.md:558-560`, `deepwork.md:579-581`, `deepwork.md:602-604`, `deepwork.md:625-627`, `deepwork.md:840-842`, `deepwork.md:872-874`
  - Stage 6: adds `=== ROUTE ===`, `=== NEXT REMAINING PHASE ===`, `=== PRIOR PHASE MANIFEST ===`, `=== COMPLETED PHASES CONTEXT ===`, `=== FAILURE CONTEXT ===` — `deepwork.md:646-664`
  - Stage 7: adds `=== ROUTE ===`, `=== CURRENT PHASE ===`, `=== PHASE DIR ===`; quick-fix hardcodes phase=1, dir=`phases/phase-01`; verify-fix mode adds `=== MODE === verify-fix` and `=== VERIFY FAILURES ===` — `deepwork.md:700-722`, `deepwork.md:853`
  - Stage 8: adds `=== CURRENT PHASE ===`, `=== PHASE DIR ===` — `deepwork.md:742-760`
  - Stage 8.5: adds `=== ROUTE ===` (always `full`), `=== COMPLETED PHASE ===`, `=== COMPLETED PHASE DIR ===`, `=== NEXT PHASE DIR ===` — `deepwork.md:790-805`

### Return Contract
- All stages return `### Status`, `### Files Written`, `### Summary`; optional `### Telemetry` (single-line JSON) — `deepwork.md:132-144`.
- Stage 1 additionally returns `### Route` (`full` or `quick-fix`) — `deepwork.md:544`.
- Stages 7, 8, 8.5 may return `### Backward Loop Request` — triggers backward-loop protocol (`deepwork.md:727, 766, 811`).
- Stage 10 returns `### Report Content` — presented verbatim (`deepwork.md:879`).

### Backward Loop Protocol
- Triggered by `### Backward Loop Request` from Stages 7, 8, or 8.5 (`deepwork.md:887-896`).
- Six steps: emit `stage.failed` + `backward_loop.requested` telemetry, regenerate `run-log.md`, read `protocol/deepwork-backward-loop-protocol.md`, follow protocol with current route/phase, present user decision gate.
- Unclean-cap escalation gates at Stage 6 (`deepwork.md:669-678`) and Stage 8.5 (`deepwork.md:813-822`) offer options A (Continue), B (loop to Structure), C (loop to Design), D (loop to Goals).
- Stage 9 auto-fix route: on FAIL, re-dispatches `qrspi-implement` in verify-fix mode; second FAIL invokes backward loop protocol (`deepwork.md:850-858`).

### Human Gates
- Stages 1, 4, 5: always-present human gates, managed by the respective stage orchestrator (`deepwork.md:112-124`, `deepwork.md:547`, `deepwork.md:612`, `deepwork.md:635`).
- Stages 6, 8.5: conditional gates triggered when `terminal_review_state` is `unclean-cap` or `stable-cap` (`deepwork.md:669-678`, `deepwork.md:813-822`).
- Error handling on any `### Status — FAIL` without backward loop presents a retry/abort human gate via `question` (`deepwork.md:898-913`).

### state.md Schema
- 10 fields defined at `deepwork.md:321-340`: `run_id`, `route`, `current_phase`, `total_phases`, `last_completed_stage`, `next_stage`, `stages_completed`, `phase_history`, `backward_loops`, `resume_source`.
- Written at Pre-Flight, after every successful stage transition, after backward-loop routing, and after resume recovery (`deepwork.md:319`).
- Mid-stage interruption restarts that stage from its beginning — `state.md` is a stage-boundary-only checkpoint (`deepwork.md:108`).

## Telemetry System
- All events follow a required envelope defined in `protocol/telemetry-protocol.md:44`: `schema_version`, `event_id`, `sequence`, `ts` (UTC), `run_id`, `writer_agent`, `writer_scope`, `event_type`, `status`, `route`, `summary`.
- Conditional scope fields include `stage`, `stage_instance`, `phase`, `wave`, `task_id`, `review_round`, `attempt`, `child_agent`, `correlation_id` (`telemetry-protocol.md:46`).
- Payload objects: `context`, `artifacts`, `timing`, `decision`, `error`, `git` (`telemetry-protocol.md:48`).
- 25 event types defined at `telemetry-protocol.md:52-65` — covering run, stage, phase, gate, child-agent, review, backward-loop, checkpoint, artifact, and metrics events.
- Stage-specific `### Telemetry` context fields documented per stage (`telemetry-protocol.md:120-159`).
- Emission procedure uses `date -u`, manual JSON composition, `cat` + overwrite to append to `events.jsonl`, with incremented sequence counter (`deepwork.md:156-164`).
- `run-log.md` regenerated after each stage boundary with 6 sections: Run Overview, Current Status, Timeline, Active Phase Snapshot, Failure and Loop Index, Artifact Index (`deepwork.md:168-226`).
- `metrics-summary.md` generated at completion/abort with 8 sections: Run, Stage Durations, Child Agent Calls, Review Rounds, Retry and Loop Counts, Human Gate Outcomes, Test Evidence Quality, Code Health (`deepwork.md:228-306`).

## Git Integration
- Pre-Flight creates branch `qrspi/<run-id>` from `main` via `git checkout -b` (`deepwork.md:495`).
- After each successful stage: `git status --short` → if dirty, `git add -A` and `git commit -m "qrspi: stage <N> <name> <complete|skipped>"`; if clean, skip commit (`deepwork.md:52`).
- Commit message format documented per stage boundary (e.g., `qrspi: stage 1 goals complete` at `deepwork.md:548`).
- Rule 11 allowed-list cross-check: `git log -1 --format='%H' --grep='qrspi: stage <N> .* complete'` to resolve prior checkpoint, then `git diff --stat <prior_stage_checkpoint>..HEAD` to verify only allowed paths were changed (`deepwork.md:64-66`).
- Stage 7 uses per-task git worktrees with squash-merge reconciliation back onto the pipeline branch (`qrspi-implement.md:240-255`).

## QRSPI Agent Ecosystem (55 files)
- All 55 files at `/home/n3m6/.config/opencode/agents/` share mandatory frontmatter: `mode: subagent`, `hidden: true`, `temperature: 0.1`, `steps: <N>` (`q-03.md:6-23`).
- Four functional roles:
  - **11 orchestrators** (edit: allow): goals, questions, research, design, structure, plan, implement, accept, replan, verify, report.
  - **9 synthesizers/writers**: goals-synthesizer, design-synthesizer, research-synthesizer, plan-writer, question-generator, structure-mapper, task-spec-writer (edit: allow), replan-writer, reporter.
  - **19 reviewers**: nearly all read-only (edit: deny) except task-spec-reviewer (edit: allow — mutating). Includes 6 per-task code-review delegates and 3 acceptance reviewers.
  - **16 specialized workers**: codebase-researcher, web-researcher, baseline-checker, fast-impl-loop (11 invariants, 8-cycle cap), fast-impl-code (iteration budgets: fresh=3, code-repair=2, simplify=2), fast-impl-test (evidence classes: DETERMINISTIC, FLAKY, HARNESS_NOISY, AMBIGUOUS, REDUNDANT), fast-impl-verify (Route Hints: PASS, CODE_REPAIR, TEST_REPAIR, CODE_AND_TEST_REPAIR, BACKWARD_LOOP), code-review, e2e-regression-checker, integration-checker, baseline-regression-checker, simplify-pass, acceptance-tester (max 3 rounds, 3 plan-review cycles/round, 2 repair attempts/round), coverage-planner, backward-loop-detector (6 classifications: NO_LOOP, DEFER_REPLAN, LOOP_PLAN, LOOP_STRUCTURE, LOOP_DESIGN, LOOP_GOALS), verifier, reporter.
- Tool permissions: `edit` allowed on 14 agents (11 orchestrators + task-spec-writer + task-spec-reviewer + simplify-pass); `question` on goals, design, structure, fast-impl-code; `webfetch`/`websearch` on web-researcher only; `todowrite` on implement, acceptance-tester, verifier (`q-03.md:236-244`).
- Full subagent dispatch graph documented from orchestrator → leaf agents with nested chains (e.g., fast-impl-loop → fast-impl-code → build) (`q-03.md:246-263`).

### Key System Prompt Constraints
- Stage 3 research agents are goal-blind: *"Goal-blind. Facts only."* constraint inserted verbatim into every child research prompt (`qrspi-research.md:29`).
- Stage 2 orchestrator: *"CRITICAL RULES"* — forbidden from writing code, invoke subagents directly, stop after dispatch (`qrspi-questions.md:21-28`).
- Stage 7 fast-impl-loop: 11 invariants including ONE TASK ONLY, MAX 8 OUTER CYCLES, STALL DETECTION (`qrspi-fast-impl-loop.md:26-38`).
- Stage 7 fast-impl-verify: Route Hints — PASS, CODE_REPAIR, TEST_REPAIR, CODE_AND_TEST_REPAIR, BACKWARD_LOOP (`qrspi-fast-impl-verify.md:223-231`).
- Backward-loop-detector: priority order for classifications: LOOP_GOALS → LOOP_DESIGN → LOOP_STRUCTURE → DEFER_REPLAN → NO_LOOP → LOOP_PLAN (`qrspi-backward-loop-detector.md:39-47`).

## Pi Extension System (Lifecycle, API, Skills)
- Extensions export a **default factory function** `export default function (pi: ExtensionAPI)`; can be async; cleanup via `session_shutdown` event subscription.
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md`, `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts`
- `ExtensionContext` provides `ui`, `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `signal`, `abort()`, `shutdown()`, among others.
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts`
- Key events: `resources_discover` (inject skill/prompt/theme paths), `session_start`/`session_shutdown`, `before_agent_start`, `agent_start`/`agent_end`, `turn_start`/`turn_end`, `tool_call`/`tool_result`, `input`, `model_select`/`thinking_level_select`.
- **Command registration**: `pi.registerCommand(name, { description, getArgumentCompletions, handler })`.
- **Tool registration**: `pi.registerTool(definition)` with `name`, `label`, `description`, `parameters` (TypeBox schema), `execute(toolCallId, params, signal, onUpdate, ctx)` returning `{ content, details }`.
- **resources_discover** event provides `{ type: "resources_discover", cwd, reason }`; handlers return `{ skillPaths?, promptPaths?, themePaths? }`.
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md`

### Skill Discovery Convention
- Pi's native loader discovers skills from 4 locations: `~/.pi/agent/skills/`, `~/.agents/skills/`, `<cwd>/.pi/skills/`, `<cwd>/.agents/skills/`.
- Flat-file skills: `<root>/<name>.md` (Pi-standard dirs only). Directory skills: `<root>/.../<name>/SKILL.md` (all locations, recursive; `node_modules` and dotfiles skipped).
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/skills.ts`
- pi-subagents' skill preloader (`skill-loader.ts`) follows the same convention with discovery roots: `<cwd>/.pi/skills/`, `<cwd>/.agents/skills/`, `$PI_CODING_AGENT_DIR/skills/`, `~/.agents/skills/`, `~/.pi/skills/` (first match wins). Symlinks rejected.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/skill-loader.ts`

### Extension Discovery and Installation
- Auto-discovery from: `~/.pi/agent/extensions/*.ts`, `~/.pi/agent/extensions/*/index.ts`, `.pi/extensions/*.ts`, `.pi/extensions/*/index.ts`. Additional paths via `settings.json` `extensions` array.
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md`, `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md`
- `pi install` supports `npm:`, `git:`, `https://`, `ssh://` sources with `@ref` syntax for branch/tag/commit pinning.
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md`, `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md`
- Git clones are **full clones** (no `--depth`); post-clone runs `npm install --omit=dev` if `package.json` exists.
  - Source: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/package-manager.ts`
- No symlink-based registration; discovery is filesystem scanning.
- Ad-hoc loading: `pi -e <path|npm:|git:>`.

### UI Methods
- `ctx.ui.confirm(title, message, { timeout?, signal? })` → `Promise<boolean>`: `true` on confirm, `false` on cancel/timeout.
- `ctx.ui.select(title, options[], { timeout?, signal? })` → `Promise<string | undefined>`: returns selected string or `undefined` on cancel/timeout.
- Other UI methods: `input()`, `editor()`, `notify()`, `setStatus()`, `setWidget()`, `setTitle()`, `custom()`.
- Available in all event handler contexts; `ctx.hasUI` is `false` in print/JSON mode.
  - Source: `https://pi.dev/docs/latest/extensions`, `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md`

## pi-subagents Package (`@tintinweb/pi-subagents` v0.7.3)

### Agent Tool API
- Three LLM-callable tools: `Agent`, `get_subagent_result`, `steer_subagent`.
- `Agent` tool parameters: `prompt` (required), `description` (required), `subagent_type` (required), plus optional `model`, `thinking`, `max_turns`, `run_in_background`, `resume`, `isolated`, `isolation`, `inherit_context`, `schedule`.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/index.ts` (TypeBox schema)
- Agent config `.md` frontmatter values for `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background`, `isolated`, `isolation` are **locked** — tool call parameters only fill unspecified fields.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/README.md`

### AgentManager
- `spawn(pi, ctx, type, prompt, options)` → returns agent ID string (background/fire-and-forget).
- `spawnAndWait(pi, ctx, type, prompt, options)` → returns `Promise<AgentRecord>` (foreground blocking).
- `AgentRecord` has fields: `id`, `type`, `description`, `status` (queued|running|completed|steered|aborted|stopped|error), `result?`, `error?`, `toolUses`, `startedAt`, `completedAt?`, `session?`.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/agent-manager.ts`, `https://github.com/tintinweb/pi-subagents/blob/master/src/types.ts`

### Symbol.for("pi-subagents:manager") Registration
- Set synchronously at module-init time on `globalThis` with a facade exposing `waitForAll()`, `hasRunning()`, `spawn()`, `getRecord()`.
- Deleted on `session_shutdown`.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/index.ts` (lines ~431–440, line ~495)
- When extension is not installed, `(globalThis as any)[Symbol.for("pi-subagents:manager")]` evaluates to `undefined` — no error thrown. No formal graceful-degradation protocol documented.
  - Source: q-09.md; `https://github.com/tintinweb/pi-subagents/blob/master/CHANGELOG.md`

### Agent Type .md Files — Discovery and Schema
- Discovered from two directories (priority order): `<cwd>/.pi/agents/*.md` (project-local, highest), `$PI_CODING_AGENT_DIR/agents/*.md` (global, default `~/.pi/agent/agents/*.md`).
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/custom-agents.ts:10-25`
- Filename (minus `.md`) becomes agent type name; same-named project files override global and built-in defaults.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/agent-types.ts:31-42`
- 15 optional YAML frontmatter fields: `description`, `display_name`, `tools`, `extensions`/`inherit_extensions`, `skills`/`inherit_skills`, `disallowed_tools`, `model`, `thinking`, `max_turns`, `prompt_mode` (default `replace`), `inherit_context`, `run_in_background`, `isolated`, `memory`, `isolation`, `enabled`.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/custom-agents.ts:70-87`, `https://github.com/tintinweb/pi-subagents/blob/master/src/types.ts:35-79`
- **Contradiction noted**: `tools: "none"` is intended to block all tools but `getToolNamesForType` in `src/agent-types.ts:138-141` checks `config?.builtinToolNames?.length`, and an empty array has `length: 0` (falsy), so it falls back to all 7 built-in tools — `tools: "none"` currently results in full tool access (`q-06.md:60-65`).
- Default agents: `general-purpose` (all tools, prompt_mode=append, inherit model), `Explore` (read+bash+grep+find+ls, prompt_mode=replace, model=haiku), `Plan` (read+bash+grep+find+ls, prompt_mode=replace, inherit model).
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/default-agents.ts`

### Model Resolution
- Supports full `provider/modelId` strings and fuzzy tier names (`"haiku"`, `"sonnet"`).
- Resolution uses fuzzy scoring (exact ID=100, substring=60+, name contains=40+, scattered parts=20; min score 20).
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/model-resolver.ts:1-71`
- Three-tier priority: agent config frontmatter `model` (highest) > tool-call `model` parameter > parent agent's model.
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/invocation-config.ts:13-30`
- No literal keyword `"inherit"` — inheritance works by omission (neither config nor params specify `model` → `modelInput` is `undefined` → stays as `ctx.model`).
  - Source: `https://github.com/tintinweb/pi-subagents/blob/master/src/default-agents.ts:14-29`

## Cross-References
- **Pipeline ↔ Agents**: Each of the 10 deepwork stages maps to exactly one `qrspi-*` stage orchestrator (Q1 `deepwork.md:112-124` ↔ Q3 agent inventory).
- **Dispatch contracts ↔ AgentManager**: The deepwork orchestrator's `Invoke <agent> as a subagent` pattern (Q2) is the mechanism through which `pi-subagents`' `Agent` tool (Q5) is invoked by the QRSPI agents.
- **Telemetry ↔ Pipeline stages**: Stage-specific telemetry context fields (`telemetry-protocol.md:120-159`) correspond to the review-loop and gate behaviors defined in each orchestrator's system prompt (Q3).
- **Git worktrees ↔ Stage 7**: `qrspi-implement.md:240-255` describes per-task git worktrees; this is a feature of the QRSPI agent system prompt, not pi-subagents' `isolation: "worktree"` feature (Q5, Q6) — these are independent implementations of worktree isolation.
- **Skill discovery ↔ Resources**: Pi's native `resources_discover` event (Q4) and pi-subagents' `skill-loader.ts` (Q4) both follow the same `SKILL.md` convention but differ in discovery roots — pi-subagents adds `$PI_CODING_AGENT_DIR` as an additional source.
- **Extension API ↔ UI gates**: `ctx.ui.confirm()` and `ctx.ui.select()` (Q7) are the underlying primitives that could implement the human gates described in the pipeline (Q1), though no direct invocation evidence was found.

## Open Questions
- **Human gate implementation**: The pipeline documents human gates at Stages 1, 4, 5, and conditional gates at 6 and 8.5 (Q1), but no findings confirm which UI method (`ctx.ui.confirm` vs. `ctx.ui.select` vs. `question` tool) implements each gate.
- **`tools: "none"` bug (Q6)**: The documented intent conflicts with observed behavior. No finding indicates whether this is a known issue or by-design.
- **pi-subagents graceful degradation**: No formal protocol exists for when `@tintinweb/pi-subagents` is absent (Q9). Consumer code must implement its own null-check pattern.
- **Worktree isolation implementations**: The QRSPI Stage 7 worktree lifecycle (`qrspi-implement.md:240-255`) appears to be agent-prompt-guided (via system prompt instructions), while pi-subagents' `isolation: "worktree"` (Q5, Q6) is an extension-side feature. No finding clarifies whether these share implementation or are independent mechanisms.
- **Telemetry ↔ pi-subagents**: No cross-reference found between deepwork's telemetry events (Q2) and pi-subagents' callback hooks (`onToolActivity`, `onTurnEnd`, etc. — Q5).
