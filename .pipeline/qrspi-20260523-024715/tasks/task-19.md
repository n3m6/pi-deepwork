# Task 19: Stage 8 acceptance agents

## Metadata
- **Task:** 19
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3d — Acceptance

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 8 agent types — these six agent types are the Stage 8 subagent definitions that enable the Accept-Test stage to execute acceptance testing against implemented phases, produce acceptance results artifacts, and trigger backward loop detection when failures persist), AC 7 (model tier in frontmatter — haiku-tier for reviewer agents `qrspi-review-accept-goal-traceability`, `qrspi-review-accept-spec`, `qrspi-review-accept-code-quality`; sonnet-tier for orchestrator `qrspi-accept` and leaf writer/planner agents `qrspi-acceptance-tester`, `qrspi-coverage-planner`)
- **NFRs:** NFR: Compatibility (model tier frontmatter — each agent type carries an explicit `model` field in its YAML frontmatter so pi-subagents resolves the correct model tier; the three reviewers use haiku-tier `anthropic/claude-haiku-4-5` while the orchestrator, tester, and coverage planner use sonnet-tier `anthropic/claude-sonnet-4-5`)
- **Replan Gate Criteria:** Phase 3 replan gate (Acceptance agents complete — all six Stage 8 agent type `.md` files are converted from opencode sources with correct YAML frontmatter per the conversion tables, each structurally valid, dispatch contracts preserved, acceptance loop logic and backward-loop detection triggering intact)

## Source Traceability
- **Goals:** AC 6, AC 7
- **Plan:** Task 19, Phase 3 — Implementation Loop (Stages 7–8.5)
- **Design:** Slice 3d — Acceptance Testing Stage (Stage 8). The Stage 8 orchestrator (`qrspi-accept`) dispatches `qrspi-acceptance-tester`, writes tester artifacts, optionally dispatches `qrspi-backward-loop-detector` when failures persist, and writes the stage summary. The acceptance tester runs an inner loop (max 3 rounds, 3 plan-review cycles per round, 2 repair attempts per round), dispatching the coverage planner and three accept-reviewer lenses. All agents together form the Stage 8 acceptance gate.
- **Structure:** Slice 3d — Acceptance Testing Stage (Stage 8); files: `agents/qrspi-accept.md` (CREATE), `agents/qrspi-acceptance-tester.md` (CREATE), `agents/qrspi-coverage-planner.md` (CREATE), `agents/qrspi-review-accept-goal-traceability.md` (CREATE), `agents/qrspi-review-accept-spec.md` (CREATE), `agents/qrspi-review-accept-code-quality.md` (CREATE)

## Description

Create six agent type `.md` files for the Stage 8 — Acceptance pipeline stage. Each file follows the pi-subagents YAML frontmatter convention and contains a system prompt body ported from the corresponding opencode agent source at `/home/n3m6/.config/opencode/agents/`. Apply the opencode-to-pi conversion rules documented in `requirements.md`.

If the `agents/` directory does not exist at the project root, create it. Write exactly six files.

### Conversion Rules (applied to all six agents)

**Frontmatter mappings:**
- opencode `description` → pi `description` (preserve the opencode description verbatim or lightly adapted for pi context)
- opencode `steps: N` → pi `max_turns: N` (use the outline values specified per agent below, which may differ from the opencode steps)
- opencode `hidden: true` → pi `enabled: false` (hidden from default listing, spawnable by orchestrator via `qrspi_dispatch` or the `Agent` tool)
- opencode `permission.edit: allow` / `permission.bash: "*": allow` → pi `tools: all` (encompasses `read, bash, grep, find, ls, write, edit`)
- opencode `permission.edit: deny` / `permission.bash: "*": deny` → pi `tools: read, bash, grep, find, ls`
- opencode `permission.webfetch: deny` / `permission.question: deny` → pi `extensions: false`
- opencode `permission.task` (subagent dispatch permissions) → dropped (subagent dispatch uses `qrspi_dispatch` tool; the presence of `tools: all` grants access to it)
- opencode `permission.todowrite` → dropped (pi has its own task tracking)
- opencode `mode: subagent` / `temperature: 0.1` → dropped (not applicable in pi)
- Always include: `prompt_mode: replace`

**System prompt body adaptations:**
- Replace `Invoke <agent-name> as a subagent:` with `Use the qrspi_dispatch tool with subagent_type: "<agent-name>"` and include the full dispatch prompt block verbatim
- Replace `cat .pipeline/<run-id>/...` with `Read .pipeline/<run-id>/...` (use the Read tool)
- Replace `mkdir -p .pipeline/<run-id>/...` with `bash: mkdir -p .pipeline/<run-id>/...`
- Replace `date -u +...` with `bash: date -u +...`
- Replace `Invoke build as a subagent` / `Dispatch build` (in the acceptance tester) with direct `bash` command execution — the agent uses the `bash` tool to run build commands, test commands, and fix commands directly, preserving the same instruction text but changing the dispatch mechanism to direct shell execution
- Remove all opencode permission system references (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `allowed-list`, `Rule 11`)
- Remove all `todowrite` references from system prompt bodies
- Preserve all pipeline directory paths (`.pipeline/<run-id>/...`, `.pipeline/<run-id>/<phase-dir>/...`), run ID references (`qrspi-<timestamp>`), stage names, route names, return contract formats (`### Status — PASS/FAIL`, `### Files Written`, `### Summary`, `### Telemetry`, `### Backward Loop Request`, `### Phase`), structured output tables, and all dispatch prompt templates verbatim
- Preserve all pipeline logic: the acceptance inner loop (3-round cap, 3 plan-review cycles/round, 2 repair attempts/round), invariants, the quick-fix invariant check, prior-phase context collection, backward-loop detection dispatch, and all four return-contract variants

---

### Agent 1: `agents/qrspi-accept.md` (Stage 8 Orchestrator)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-accept.md` (212 lines)

**Role:** Stage 8 orchestrator — reads phase inputs (goals, requirements, execution manifest, integration results, phase manifest, optional design and structure), dispatches `qrspi-acceptance-tester` to execute the acceptance inner loop, writes the tester's artifacts (coverage plan, acceptance results, review round artifacts, boundary violations), dispatches `qrspi-backward-loop-detector` when persistent failures remain, writes the stage summary (`stage8-summary.md`), and returns the stage contract with one of four return variants.

**Frontmatter (exact):**
```yaml
---
description: "Stage 8 orchestrator — reads phase inputs, dispatches qrspi-acceptance-tester, writes phase artifacts, dispatches qrspi-backward-loop-detector when failures persist, and returns the stage contract to deepwork."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 100
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations (key changes from opencode source):**

1. **CRITICAL RULES (lines 23-30):** Replace "INVOKE SUBAGENTS DIRECTLY" with equivalent pi wording: "Dispatch leaf agents via `qrspi_dispatch`. Never describe a handoff in plain text." Replace "STOP AFTER DISPATCH. After invoking a child agent, end your turn immediately" with "After dispatching a child agent, end your turn immediately — `qrspi_dispatch` runs in foreground and blocks until the child agent completes." Remove rule 6 "NO PRODUCTION FIXES" if it references opencode-specific permission language — rephrase in pi terms: "Acceptance may create or repair acceptance tests, but it must not modify production/source code. Production defects discovered here remain persistent failures for Stage 7 fix/review routing or backward-loop classification."

2. **Step A — Read Inputs (lines 38-63):** Replace all `cat` references with `Read` tool instructions. The quick-fix invariant check (if `config.md` route is `quick-fix` and `design.md` or `structure.md` exists, return FAIL immediately) must be preserved verbatim — only replace any `cat` references in the check with `Read`. The prior phase context collection logic is preserved verbatim.

3. **Step B — Dispatch Acceptance Tester (lines 66-102):** Replace `Invoke qrspi-acceptance-tester as a subagent:` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-acceptance-tester":`. Keep the complete dispatch prompt block (`=== GOALS ===`, `=== REQUIREMENTS ===`, etc.) verbatim. Replace any `cat` or file-reading instructions within the dispatch prompt with pi-appropriate instructions.

4. **Step C — Write Tester Artifacts (lines 104-112):** The orchestrator writes the tester's output sections to disk. Replace any file-write instructions (`write` → `Write` tool or `edit` tool). The boundary-violation check (Step C final paragraph) is preserved verbatim — this is a Stage 8 contract guard.

5. **Step D — Dispatch Backward-Loop Detector (lines 114-155):** Replace `Invoke qrspi-backward-loop-detector as a subagent:` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-backward-loop-detector":`. Preserve the dispatch prompt block verbatim. Note: the `qrspi-backward-loop-detector.md` agent type file is created separately in Task 20; this agent's prompt may reference it by name.

6. **Step E — Write Stage Summary (lines 157-159):** Preserve verbatim — the stage summary instruction references writing `stage8-summary.md` with specific content requirements (Status line, phase number, round counts, failure reason breakdown, persistent failure status, boundary violation status, detector loop recommendation).

7. **Return contract (lines 161-212):** Preserve all four return-contract variants verbatim:
   - All criteria passed: `### Status — PASS` with telemetry showing `backward_loop_requested: false`
   - Persistent failures + detector recommends a loop: `### Status — PASS` with `### Backward Loop Request` and `backward_loop_requested: true`
   - Acceptance boundary violation: `### Status — FAIL` with `boundary_violation: true`
   - Persistent failures + detector recommends `NO_LOOP`: `### Status — FAIL` with `backward_loop_requested: false`
   - Unrecoverable error: `### Status — FAIL` with partial files written

### Agent 2: `agents/qrspi-acceptance-tester.md` (Acceptance Tester)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-acceptance-tester.md` (386 lines)

**Role:** Owns the Stage 8 inner loop. Extracts phase-scoped acceptance criteria, dispatches `qrspi-coverage-planner` to produce a coverage plan, dispatches all three accept reviewers (`qrspi-review-accept-goal-traceability`, `qrspi-review-accept-spec`, `qrspi-review-accept-code-quality`) to review the plan, writes acceptance tests via direct `bash` execution, reconciles test lifecycle, runs tests, attempts up to 2 acceptance-test repairs per round, and loops up to 3 rounds. Reports persistent failures but does not classify backward loops.

**Frontmatter (exact):**
```yaml
---
description: "Maps the current phase's acceptance criteria to a reviewed coverage plan, dispatches a coverage planner plus three acceptance reviewers, gates test generation on review, reconciles acceptance-test lifecycle changes, runs the active tests, and loops up to 3 rounds. Reports persistent failures but does not classify backward loops."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 50
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations (key changes from opencode source):**

1. **Invariants (lines 24-45):** Preserve all 16 invariants but adapt for pi:
   - "No code writing. Delegate all test writing, test execution, and local code fixes to `build`." → "Run test writing, test execution, and local code fixes via `bash` commands — do not delegate to a subagent for these operations."
   - "Invoke subagents directly. After each dispatch, end your turn immediately" → "Dispatch `qrspi-coverage-planner` and the three reviewers via `qrspi_dispatch`. After each dispatch, end your turn immediately — `qrspi_dispatch` runs in foreground and blocks until the child agent completes."
   - "Do not modify production/source code." preserved verbatim.
   - All caps (max 3 rounds, max 3 plan-review cycles, max 2 repair attempts) preserved verbatim.

2. **Pre-Step — Extract Phase-Scoped Criteria (lines 47-70):** Preserved verbatim. The early return for no assigned criteria is preserved.

3. **Shared Dispatch Context (lines 70-104):** Preserved verbatim — all eight shared context sections (`=== GOALS ===`, `=== REQUIREMENTS ===`, etc.) are kept unchanged. These are pasted into every child agent dispatch prompt.

4. **Inner Loop Steps 1–7 (lines 106-324):**
   - **Step 1 — Dispatch Coverage Planner (lines 110-148):** Replace `Dispatch qrspi-coverage-planner` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-coverage-planner":`. Preserve the dispatch prompt block verbatim.
   - **Step 2 — Review the Coverage Plan (lines 150-183):** Replace the three-reviewer dispatch with `qrspi_dispatch` calls for each: `subagent_type: "qrspi-review-accept-goal-traceability"`, `subagent_type: "qrspi-review-accept-spec"`, `subagent_type: "qrspi-review-accept-code-quality"`. The opencode source dispatches all three "in the same turn"; in pi, dispatch them sequentially via `qrspi_dispatch` (each dispatch is one turn since foreground dispatch blocks until completion). Preserve the plan-review cycle rule (max 3 cycles) verbatim.
   - **Step 3 — Write the Planned Tests (lines 184-232):** The opencode source dispatches `build` as a subagent. In pi, replace this with: the agent runs `bash` commands directly to create, revise, or confirm test files according to the coverage plan. The `=== COVERAGE PLAN ===`, `=== EXECUTION MANIFEST ===`, and other instruction blocks are kept as guidance for the agent itself (it reads them and executes the appropriate bash commands). Preserve the Test style rules and the return format expectations (`### Test Files Reused`, `### Test Files Revised`, `### Test Files Created`, `### Test Files Deleted`, `### Files Modified`, `### Files Created`, `### Boundary Violations`, `### Criterion Mapping`, `### Summary`).
   - **Step 4 — Reconcile Test Lifecycle (lines 234-246):** Preserved verbatim — this is a reasoning step with no dispatch.
   - **Step 5 — Run the Planned Tests (lines 248-270):** Replace `Dispatch build` with direct `bash` execution to run the test commands. The `=== COVERAGE PLAN ===`, `=== TEST FILES ===`, and `=== INSTRUCTIONS ===` blocks become guidance for the agent to execute tests itself using the `bash` tool. Preserve the return format expectations (`### Acceptance Results` table, `### Failed Criteria`, `### Summary`).
   - **Step 6 — Acceptance-Test Repair Attempts (lines 272-318):** Replace `dispatch build` with direct `bash` execution for test repairs. The agent reads the current acceptance results, identifies eligible test-only defects, applies fixes via `bash`/`edit`, reruns affected tests, and reports outcomes. The return format expectations (`### Fix Attempt`, `### Root Cause`, `### Fix Status`, `### Files Modified`, `### Files Created`, `### Boundary Violations`, `### Acceptance Results`, `### Remaining Failures`, `### Summary`) are preserved.
   - **Step 7 — Decide Whether to Continue (lines 320-324):** Preserved verbatim.

5. **Round Artifact Format (lines 326-359):** Preserved verbatim. The `#### acceptance-review-round-NN.md` block format with all subsections (Phase-Scoped Criteria, Coverage Plan Snapshot, Reviewers Run, Findings, Writer Summary, Reconciliation Summary, Execution Summary, Remaining Failures) is kept exactly.

6. **Output Format (lines 361-386):** Preserved verbatim — the six output sections (`### Status`, `### Coverage Plan`, `### Review Round Artifacts`, `### Acceptance Results`, `### Persistent Failures`, `### Boundary Violations`, `### Stage Summary`) with their exact table schemas and field expectations are kept.

7. **Remove:** The `todowrite: allow` permission (already handled by dropping it from frontmatter). Any `todowrite` references in the system prompt body are removed.

### Agent 3: `agents/qrspi-coverage-planner.md` (Coverage Planner)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-coverage-planner.md` (59 lines)

**Role:** Drafts or revises the current phase's acceptance coverage plan for a single Stage 8 round. Maps phase-scoped criteria to concrete test approaches (action, test type, trigger, expected outcome, planned test file) and uses preserved requirements only to refine acceptance-scope coverage. Does not write tests, review implementation code, or modify files.

**Frontmatter (exact):**
```yaml
---
description: "Drafts or revises the current phase's acceptance coverage plan for a single round. Maps phase-scoped criteria to concrete test approaches and lifecycle actions and uses preserved requirements only to refine acceptance-scope coverage."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 25
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations:**

1. The opencode source has this agent as read-only (`edit: deny`, `bash: "*": deny`, `task: "*": deny`) with no subagent dispatch capability. In the pi port, per the outline, this agent receives `tools: all`. The system prompt body is almost entirely a pure input→output specification with no opencode-specific tool references — the body itself requires minimal adaptation.

2. **Inputs section (line 19-22):** Preserved verbatim — it lists the expected input fields without referencing specific tools.

3. **Rules 1–10 (lines 23-38):** All 10 rules are preserved verbatim. They are tool-agnostic and define the coverage planning contract without referencing any opencode-specific mechanisms.

4. **Output format (lines 40-59):** Preserved verbatim — the `### Coverage Plan` format (with `Criterion`, `Phase Scope Source`, `Action`, `Action Rationale`, `Test Type`, `Trigger`, `Expected Outcome`, `Relevant Files/Components`, `Planned Test File`, `Notes` fields) and `### Summary` section are kept exactly.

### Agent 4: `agents/qrspi-review-accept-goal-traceability.md` (Goal Traceability Reviewer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-review-accept-goal-traceability.md` (42 lines)

**Role:** Read-only reviewer. Checks that current-phase acceptance criteria map cleanly to the planned acceptance coverage without duplicate or extraneous tests. Evaluates five review areas (Mapping, Trace, Coverage, Extra, Drift) and assigns severity levels (CRITICAL through LOW).

**Frontmatter (exact):**
```yaml
---
description: "Acceptance-plan goal-traceability reviewer — checks that current-phase acceptance criteria map cleanly to planned acceptance coverage without duplicate or extraneous tests."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 15
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations:**

1. The opencode source is already a pure review specification with no opencode-specific tool references (`edit: deny`, `bash: "*": deny`, `task: "*": deny`, `webfetch: deny`, `question: deny`). No conversion changes are needed in the body.

2. Preserve verbatim: the five review checks (Mapping, Trace, Coverage, Extra, Drift), the severity definitions (CRITICAL through LOW), the output format (`### Status — PASS or FAIL`, `### Findings` table with columns `#`, `Severity`, `Criterion`, `Category`, `Issue`, `Recommendation`), and the PASS/FAIL rules (return FAIL for any CRITICAL or HIGH finding).

### Agent 5: `agents/qrspi-review-accept-spec.md` (Spec Reviewer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-review-accept-spec.md` (37 lines)

**Role:** Read-only reviewer. Checks that planned current-phase acceptance coverage matches the intended trigger and expected outcome of each criterion. Evaluates five review areas (Trigger Fidelity, Outcome Fidelity, Assertion Specificity, Boundary Inclusion, Action Consistency) and assigns severity levels.

**Frontmatter (exact):**
```yaml
---
description: "Acceptance-plan spec reviewer — checks that planned current-phase acceptance coverage matches the intended trigger and expected outcome of each criterion."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 15
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations:**

1. The opencode source is already a pure review specification. No conversion changes are needed.

2. Preserve verbatim: the five review checks (Trigger Fidelity, Outcome Fidelity, Assertion Specificity, Boundary Inclusion, Action Consistency), the severity definitions, the output format (`### Status — PASS or FAIL`, `### Findings` table), and the PASS/FAIL rules.

### Agent 6: `agents/qrspi-review-accept-code-quality.md` (Code Quality Reviewer)

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-review-accept-code-quality.md` (49 lines)

**Role:** Read-only reviewer. Reviews current-phase acceptance coverage plans for deterministic, behavior-focused tests without needless suite sprawl. Evaluates six review areas (Determinism, Behavior Focus, Isolation, Data Realism, Anti-Patterns, Suite Reuse) and assigns severity levels.

**Frontmatter (exact):**
```yaml
---
description: "Reviews current-phase acceptance coverage plans for deterministic, behavior-focused tests without needless suite sprawl."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 15
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations:**

1. The opencode source is already a pure review specification. No conversion changes are needed.

2. Preserve verbatim: the six review criteria (Determinism, Behavior Focus, Isolation, Data Realism, Anti-Patterns, Suite Reuse), the severity definitions (CRITICAL through LOW), the output format (`### Status — PASS or FAIL`, `### Findings` table), and the PASS/FAIL rules (return FAIL only for CRITICAL or HIGH findings).

### File Creation

All six files are placed in `agents/` at the project root. Create the `agents/` directory if it does not exist (`mkdir -p agents`). Each file is a new `.md` file following the exact frontmatter and system prompt body as specified above.

## Files
- `agents/qrspi-accept.md` (CREATE) — Stage 8 orchestrator agent type. YAML frontmatter: `description`, `tools: all`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 100`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-accept.md` (212 lines) with adaptations: `Invoke <agent> as a subagent` → `qrspi_dispatch` tool with `subagent_type`, `cat` → `Read`, `mkdir -p` → `bash: mkdir -p`, removed opencode permission system and `todowrite` references. Preserves all five steps (Read Inputs → Dispatch Acceptance Tester → Write Tester Artifacts → Dispatch Backward-Loop Detector → Write Stage Summary), the quick-fix invariant check, the four return-contract variants (all PASS, persistent failures + loop, boundary violation, NO_LOOP failure, unrecoverable error), and the complete dispatch prompt templates for both child agents.
- `agents/qrspi-acceptance-tester.md` (CREATE) — Acceptance tester agent type. YAML frontmatter: `description`, `tools: all`, `model: anthropic/claude-sonnet-4-5`, `thinking: medium`, `max_turns: 50`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-acceptance-tester.md` (386 lines) with adaptations: `Invoke <agent> as a subagent` → `qrspi_dispatch` tool, `build` subagent dispatch replaced with direct `bash` command execution for test writing, running, and repair, `todowrite` references removed, opencode permission system removed. Preserves all 16 invariants, the pre-step criteria extraction, the shared dispatch context block, the 7-step inner loop (coverage planner → review → write tests → reconcile → run tests → repair attempts → continue/stop), all caps (3 rounds, 3 plan-review cycles/round, 2 repair attempts/round), the round artifact format, and the six-section output format.
- `agents/qrspi-coverage-planner.md` (CREATE) — Coverage planner agent type. YAML frontmatter: `description`, `tools: all`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 25`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-coverage-planner.md` (59 lines). No conversion changes needed — the body is a pure input→output specification with no opencode-specific tool references. Preserves all 10 rules and the output format (`### Coverage Plan` with 10 fields per criterion, `### Summary`).
- `agents/qrspi-review-accept-goal-traceability.md` (CREATE) — Goal traceability reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 15`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-review-accept-goal-traceability.md` (42 lines). No conversion changes needed — the body is a read-only review specification. Preserves the five review checks (Mapping, Trace, Coverage, Extra, Drift), severity definitions, and output format.
- `agents/qrspi-review-accept-spec.md` (CREATE) — Spec reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 15`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-review-accept-spec.md` (37 lines). No conversion changes needed. Preserves the five review checks (Trigger Fidelity, Outcome Fidelity, Assertion Specificity, Boundary Inclusion, Action Consistency), severity definitions, and output format.
- `agents/qrspi-review-accept-code-quality.md` (CREATE) — Code quality reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 15`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-review-accept-code-quality.md` (49 lines). No conversion changes needed. Preserves the six review criteria (Determinism, Behavior Focus, Isolation, Data Realism, Anti-Patterns, Suite Reuse), severity definitions, and output format.

## Test Expectations
- **YAML frontmatter parseable on all six files:** When any YAML parser reads each `agents/qrspi-accept.md`, `agents/qrspi-acceptance-tester.md`, `agents/qrspi-coverage-planner.md`, `agents/qrspi-review-accept-goal-traceability.md`, `agents/qrspi-review-accept-spec.md`, and `agents/qrspi-review-accept-code-quality.md`, the frontmatter between the first `---` and the closing `---` parses without error and contains the keys `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`, and `enabled`.
- **Orchestrator frontmatter values correct:** When `qrspi-accept.md` frontmatter is read, `tools` equals `"all"`, `model` equals `"anthropic/claude-sonnet-4-5"`, `thinking` equals `"low"`, `max_turns` equals `100`, `prompt_mode` equals `"replace"`, `enabled` equals `false`.
- **Acceptance tester frontmatter values correct:** When `qrspi-acceptance-tester.md` frontmatter is read, `tools` equals `"all"`, `model` equals `"anthropic/claude-sonnet-4-5"`, `thinking` equals `"medium"`, `max_turns` equals `50`, `prompt_mode` equals `"replace"`, `enabled` equals `false`.
- **Coverage planner frontmatter values correct:** When `qrspi-coverage-planner.md` frontmatter is read, `tools` equals `"all"`, `model` equals `"anthropic/claude-sonnet-4-5"`, `thinking` equals `"low"`, `max_turns` equals `25`, `prompt_mode` equals `"replace"`, `enabled` equals `false`.
- **Goal traceability reviewer frontmatter values correct:** When `qrspi-review-accept-goal-traceability.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `15`, `prompt_mode` equals `"replace"`, `enabled` equals `false`.
- **Spec reviewer frontmatter values correct:** When `qrspi-review-accept-spec.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `15`, `prompt_mode` equals `"replace"`, `enabled` equals `false`.
- **Code quality reviewer frontmatter values correct:** When `qrspi-review-accept-code-quality.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `15`, `prompt_mode` equals `"replace"`, `enabled` equals `false`.
- **Orchestrator system prompt dispatches acceptance tester via qrspi_dispatch:** When `qrspi-accept.md` is read, the body after the frontmatter contains a `qrspi_dispatch` instruction with `subagent_type: "qrspi-acceptance-tester"` and the full dispatch prompt block (`=== GOALS ===`, `=== REQUIREMENTS ===`, `=== EXECUTION MANIFEST ===`, etc.).
- **Orchestrator system prompt dispatches backward-loop detector via qrspi_dispatch:** When `qrspi-accept.md` is read, the body contains a `qrspi_dispatch` instruction with `subagent_type: "qrspi-backward-loop-detector"` and the corresponding dispatch prompt block.
- **Orchestrator system prompt uses Read not cat:** When `qrspi-accept.md` is read, the body contains `Read .pipeline/` references (not `cat .pipeline/`) for reading pipeline artifacts.
- **Orchestrator system prompt contains all four return-contract variants:** When `qrspi-accept.md` is read, the body contains the four distinct `### Status — PASS` and `### Status — FAIL` return blocks covering: all criteria passed, persistent failures with backward-loop request, boundary violation failure, and NO_LOOP failure.
- **Orchestrator system prompt contains the quick-fix invariant check:** When `qrspi-accept.md` is read, the body contains a check that returns `### Status — FAIL` with a quick-fix route inconsistency message when `config.md` route is `quick-fix` and `design.md` or `structure.md` exists.
- **Acceptance tester system prompt contains all invariants:** When `qrspi-acceptance-tester.md` is read, the body contains the invariants that (a) acceptance tests only are written (no production code), (b) child agents are dispatched via `qrspi_dispatch`, (c) scope is limited to current-phase criteria from `phase-manifest.md`, (d) each criterion has exactly one row in `### Acceptance Results` with a `Failure Reason` from the enum `{none, blocking_review, reconciliation, blocked_action, executed_failed}`, (e) reviewers evaluate the coverage plan only, (f) blocking findings prevent test dispatch, (g) the 3-round cap, 3 plan-review cycles/round cap, and 2 repair attempts/round cap are stated.
- **Acceptance tester system prompt replaces build subagent with bash:** When `qrspi-acceptance-tester.md` is read, the body for Steps 3, 5, and 6 uses `bash` command execution instructions (not `dispatch build` or `Invoke build as a subagent`) for test writing, test running, and repair attempts.
- **Acceptance tester system prompt contains the seven-step inner loop:** When `qrspi-acceptance-tester.md` is read, the body describes the full sequence: Step 1 (dispatch coverage planner) → Step 2 (dispatch three reviewers) → Step 3 (write tests) → Step 4 (reconcile test lifecycle) → Step 5 (run tests) → Step 6 (repair attempts) → Step 7 (decide to continue), with the plan-review cycle logic and reconciliation guard rules.
- **Acceptance tester system prompt contains the output format:** When `qrspi-acceptance-tester.md` is read, the body contains the six output sections: `### Status`, `### Coverage Plan`, `### Review Round Artifacts` (with `#### acceptance-review-round-NN.md` block format), `### Acceptance Results` (table with columns `#`, `Criterion`, `Test File`, `Status`, `Failure Reason`, `Details`), `### Persistent Failures`, `### Boundary Violations`, and `### Stage Summary`.
- **Acceptance tester system prompt contains the pre-step early return:** When `qrspi-acceptance-tester.md` is read, the body contains an early return path (`### Status — PASS` with `### Coverage Plan: N/A`, `### Acceptance Results: N/A`, `### Persistent Failures: None.`) for the case when the current phase has no assigned acceptance criteria.
- **Coverage planner system prompt contains the output schema:** When `qrspi-coverage-planner.md` is read, the body specifies the `### Coverage Plan` format with exactly 10 fields per criterion: `Criterion`, `Phase Scope Source`, `Action` (`reuse`/`revise`/`new`/`blocked`), `Action Rationale`, `Test Type`, `Trigger`, `Expected Outcome`, `Relevant Files/Components`, `Planned Test File`, and `Notes`.
- **Coverage planner system prompt contains the 10 rules:** When `qrspi-coverage-planner.md` is read, the body contains rules stating that (a) Phase-Scoped Criteria is authoritative scope, (b) `reuse` and `revise` are preferred over `new`, (c) `blocked` requires concrete rationale, (d) expected outcomes must be publicly observable (not internal state), and (e) on rounds 2–3 the plan uses prior round findings/failures/artifacts/mapping for revision.
- **Goal traceability reviewer system prompt contains five review checks:** When `qrspi-review-accept-goal-traceability.md` is read, the body describes the five review areas: Mapping, Trace, Coverage, Extra, and Drift, with severity levels `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, and states that FAIL is returned for any CRITICAL or HIGH finding.
- **Spec reviewer system prompt contains five review checks:** When `qrspi-review-accept-spec.md` is read, the body describes the five review areas: Trigger Fidelity, Outcome Fidelity, Assertion Specificity, Boundary Inclusion, and Action Consistency, with the severity scale and PASS/FAIL rules.
- **Code quality reviewer system prompt contains six review checks:** When `qrspi-review-accept-code-quality.md` is read, the body describes the six review areas: Determinism, Behavior Focus, Isolation, Data Realism, Anti-Patterns, and Suite Reuse, with the severity scale and PASS/FAIL rules.
- **Reviewer output formats consistent:** When all three reviewer agent files are read, each contains a `### Status — PASS or FAIL` line and a `### Findings` table with columns `#`, `Severity`, `Criterion`, `Category`, `Issue`, `Recommendation`.
- **No opencode permission system references:** When the bodies of all six agent files are read, none contain opencode permission terminology (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `allowed-list`, `Rule 11`).
- **No todowrite references in acceptance tester:** When `qrspi-acceptance-tester.md` is read, the body does not contain the string `todowrite`.
- **Model tier assignment:** When comparing all six files, the orchestrator (`qrspi-accept`), acceptance tester (`qrspi-acceptance-tester`), and coverage planner (`qrspi-coverage-planner`) use `model: anthropic/claude-sonnet-4-5` (sonnet-tier). The three reviewers (`qrspi-review-accept-goal-traceability`, `qrspi-review-accept-spec`, `qrspi-review-accept-code-quality`) use `model: anthropic/claude-haiku-4-5` (haiku-tier).
- **Tool assignment correctness:** When the orchestrator, acceptance tester, and coverage planner frontmatter is read, each has `tools: all` granting access to all 7 built-in tools. When the three reviewer frontmatter is read, each has `tools: read, bash, grep, find, ls` (5 read-only tools, no `write`/`edit`).
- **Acceptance tester thinking level:** When `qrspi-acceptance-tester.md` frontmatter is read, `thinking` equals `"medium"` (the only Stage 8 agent with medium thinking — the code-writing/test-execution inner loop requires higher reasoning depth).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
