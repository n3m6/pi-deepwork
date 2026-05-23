# Task 20: Backward loop and replan agents

## Metadata
- **Task:** 20
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3e — Backward Loop / Replan

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 4 (Backward loop protocol triggers replan when acceptance testing identifies issues — observable: a replan artifact appears in `.pipeline/<run-id>/` and the pipeline revisits the Plan stage), AC 6 (All 10 stages produce their prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree following the file-based protocol convention — backward loop and replan agents are part of the Stage 8/8.5 artifact chain), AC 7 (Extension works with multiple model tiers — haiku-tier models for detector and reviewer agents, sonnet-tier models for replan orchestrator and writer agents)
- **NFRs:** NFR: Compatibility (multiple model tiers — haiku-tier for detector and replan reviewer leaf agents, sonnet-tier for replan orchestrator and replan writer agents)
- **Replan Gate Criteria:** Phase 3 replan gate (Backward loop agents complete) — backward loop detector, replan orchestrator, replan writer, and replan reviewer agent type `.md` files are converted from opencode sources with correct YAML frontmatter per the conversion tables, each structurally valid with parseable frontmatter and system prompt body present, dispatch contracts preserved, review loop logic intact.

## Source Traceability
- **Goals:** AC 4, AC 6, AC 7
- **Plan:** Task 20, Phase 3 — Implementation Loop (Stages 7–8.5)
- **Design:** Slice 3e — Backward Loop / Replan (part of Slice 3: Implementation Loop — Stages 7–8.5). The backward-loop-detector analyzes persistent Stage 8 acceptance failures, classifies them by the earliest upstream artifact that must change, and returns one of six recommendations. The replan orchestrator dispatches the replan writer and replan reviewer, runs a review loop (up to 5 rounds with convergence detection), and writes updated plan.md, phase-manifest.md, and next-phase task specs. Unclean-cap escalation gates offer options A-D for looping to earlier stages. The backward-loop-detector is also referenced under Slice 3d (Acceptance Testing) as part of the Stage 8 orchestration unit.
- **Structure:** `agents/qrspi-backward-loop-detector.md` (CREATE — Slice 3d/3e), `agents/qrspi-replan.md` (CREATE — Slice 3e), `agents/qrspi-replan-writer.md` (CREATE — Slice 3e), `agents/qrspi-replan-reviewer.md` (CREATE — Slice 3e)

## Description

Create four agent type `.md` files for the QRSPI backward loop and replan pipeline stage. These agents collaborate to analyze acceptance failures, determine whether a replan is needed and at what level, revise the remaining implementation plan, and review the replan artifacts for correctness.

Each agent file follows the pi agent type convention: YAML frontmatter containing `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions` fields, followed by a system prompt body adapted from the opencode source equivalents using the conversion tables documented in requirements.md.

### Conversion Rules Applied

The opencode → pi frontmatter mappings applied to these agents:

| opencode field | pi frontmatter | Value for these agents |
|---|---|---|
| `description` | `description` | Direct mapping — preserved from opencode, optionally condensed |
| `mode: subagent` | N/A | All pi agents are subagent-style |
| `hidden: true` | `enabled: false` | All four agents are hidden from listing but spawnable |
| `steps: N` | `max_turns: N` | As specified per agent below |
| `temperature: 0.1` | N/A | pi handles temperature differently — omit |
| `permission.edit: allow` | `tools: read, bash, grep, find, ls, write, edit` | Replan orchestrator and writer get full write access |
| `permission.edit: deny` | `tools: read, bash, grep, find, ls` | Detector and reviewer get read-only tools |
| `permission.bash: "*": deny` | Subset of `tools` | Detector and reviewer have no bash, only grep/find/ls |
| `permission.task: "qrspi-replan-*"` | N/A | Uses `qrspi_dispatch` tool instead |
| `permission.webfetch: deny` | `extensions: false` | No web fetch access |

System prompt body adaptations applied:
- `cat .pipeline/...` → `Read .pipeline/...` (read tool)
- `Invoke <agent> as a subagent:` → `Use the qrspi_dispatch tool with subagent_type: "<agent>"`
- `mkdir -p` → `bash: mkdir -p` (bash tool)
- File write operations via the `bash` tool or `write`/`edit` tools
- `=== RUN ID ===` headers preserved verbatim in dispatch prompt context
- Return contract parsing (`### Status — PASS/FAIL`, `### Backward Loop Request`) preserved verbatim

---

### Agent 1: `agents/qrspi-backward-loop-detector.md` (Backward Loop Detector)

**Role:** Analyzes persistent Stage 8 acceptance failures after the acceptance loop finishes, classifies them by the earliest upstream artifact that must change, and returns one of six recommendations. Read-only — does not edit artifacts or suggest code fixes.

**Frontmatter:**
- `description`: "Stage 8 backward-loop detector — analyzes the completed phase after acceptance testing, classifies persistent failures, and recommends the earliest loop-back target, a defer-to-replan outcome, or a full reset to goals when structural issues are present."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `20`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-backward-loop-detector.md`):**

The agent is the QRSPI Backward Loop Detector. It processes labeled input sections (Goals, Execution Manifest, Integration Results, Design Context, Structure Context, Coverage Plan, Acceptance Results table with `Failure Reason` column, Persistent Failures, Current Phase, Phase Manifest, and Completed Phase Summaries) and follows a decision algorithm:

1. **Group persistent failures by shared root cause.** Do not classify repeated symptoms of the same defect independently.

2. **For each root cause, answer the change-type checklist** in order: Scope Change (must goals/acceptance criteria change?), Architecture Change (must architecture, technology, vertical slice, or phase boundary change?), File Boundary Change (must files/components/modules be added, removed, renamed, or relocated?), Interface Change (must API contract, event shape, schema, or interface boundary change?), Safe To Defer (can the current phase honestly satisfy its contract?), Local Code Only (can the fix be made entirely within existing implementation code?).

3. **Classify each root cause** using this priority order (first YES wins):
   - Scope Change YES → `LOOP_GOALS`
   - Architecture Change YES → `LOOP_DESIGN`
   - File Boundary Change OR Interface Change YES → `LOOP_STRUCTURE`
   - Safe To Defer YES (and current phase contract still holds) → `DEFER_REPLAN`
   - Local Code Only YES → `NO_LOOP`
   - Otherwise → `LOOP_PLAN`

4. **Overall recommendation** is the earliest upstream target across all root causes: goals before design before structure before plan. `DEFER_REPLAN` and `NO_LOOP` are only valid when no earlier loop target applies.

5. **Use Completed Phase Summaries** to distinguish a new current-phase defect from a defect inherited from earlier planning/design decisions.

The system prompt includes:

- **Classification Reference Table** mapping each change type to its label with examples: `NO_LOOP` (fix fits in existing implementation), `DEFER_REPLAN` (issue belongs to next phase; current phase satisfies its contract), `LOOP_PLAN` (omitted behavior or bad task decomposition), `LOOP_STRUCTURE` (file, component, interface, schema, API, or event-shape change required), `LOOP_DESIGN` (architecture, technology, vertical-slice, or phase-boundary change required), `LOOP_GOALS` (acceptance criteria or scope statement must change).

- **Anti-Downgrade Rules**: `NO_LOOP` does not mean acceptance passed — it means no upstream artifact must change. Interface/schema/API/event-shape/file-boundary changes are `LOOP_STRUCTURE`, never `NO_LOOP` or `LOOP_PLAN`. Architecture/technology/vertical-slice/phase-boundary changes are `LOOP_DESIGN`, never `LOOP_STRUCTURE` or `LOOP_PLAN`. `DEFER_REPLAN` is valid only when the current phase honestly satisfies its assigned contract. Do not split repeated symptoms of the same upstream defect into independent local bugs. Do not downgrade a classification to avoid a backward loop.

- **Failure-Reason Constraints** based on the `Failure Reason` column:
  - `executed_failed` — the test ran and failed. Eligible for any classification.
  - `blocking_review` and `reconciliation` — coverage plan or test lifecycle broken; maximum classification `LOOP_PLAN` (never escalate to `LOOP_STRUCTURE`, `LOOP_DESIGN`, or `LOOP_GOALS`).
  - `blocked_action` — criterion not testable in current phase. Default `DEFER_REPLAN` if rationale implies next phase, otherwise `LOOP_PLAN`. Never `LOOP_STRUCTURE` or higher.
  - When a root cause spans multiple rows with mixed reasons, use the most-eligible reason among them.

- **Output Format**:
  ```
  ### Severity Analysis
  | # | Criterion | Failure Reason | Failure | Local Code Only | File Boundary Change | Interface Change | Architecture Change | Scope Change | Safe To Defer | Classification | Loop-back Target | Rationale |

  ### Overall Recommendation
  [NO_LOOP | DEFER_REPLAN | LOOP_PLAN | LOOP_STRUCTURE | LOOP_DESIGN | LOOP_GOALS]

  ### Rationale
  [one paragraph]

  ### Backward Loop Request
  **Criteria**: [affected criteria]
  **Issue**: [shared root cause]
  **Affected Artifact**: [plan | structure | design | goals | replan]
  **Recommendation**: [what upstream change is needed]
  ```
  Include `### Backward Loop Request` whenever the overall recommendation is not `NO_LOOP`. Omit it only for `NO_LOOP`.

---

### Agent 2: `agents/qrspi-replan.md` (Replan Orchestrator)

**Role:** Stage 8.5 orchestrator — sequences reads, dispatches the replan writer and reviewer via `qrspi_dispatch`, manages the review loop, writes updated plan.md, phase-manifest.md, and next-phase task specs, and returns a structured contract to the main orchestrator. Handles unclean-cap escalation and backward loop escalation when goals or design must change.

**Frontmatter:**
- `description`: "Stage 8.5 orchestrator — revises the remaining plan after a completed phase, runs automated review rounds, and writes updated remaining-work artifacts. Writes plan.md, phase-manifest.md, next-phase task specs, review artifacts, and a phase-local replan note."
- `tools`: `read, bash, grep, find, ls, write, edit`
- `model`: `anthropic/claude-sonnet-4-5`
- `thinking`: `low`
- `max_turns`: `60`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-replan.md`):**

The agent is the QRSPI Replan stage orchestrator. It sequences reads, dispatches child agents, writes pipeline state files, and manages the review loop. It does not write code or make planning decisions.

**Critical rules (preserved verbatim):**
1. FORBIDDEN FROM WRITING CODE — only writes pipeline state files inside `.pipeline/qrspi-<run-id>/`.
2. INVOKE SUBAGENTS DIRECTLY — when a child agent is needed, dispatch it via `qrspi_dispatch` rather than describing the handoff in plain text.
3. STOP AFTER SUBAGENT DISPATCH — after dispatching a child agent, do not write anything further; end the turn and wait for the subagent response.
4. REPLAN ONLY REMAINING WORK — do not rewrite completed phases. Replan adjusts the unfinished portion only.
5. NO GOALS OR DESIGN DRIFT — if goals or the chosen architecture must change, return a `### Backward Loop Request` to the main orchestrator instead of forcing a replan.

**Input:** Parse Run ID, Route, Completed Phase, Completed Phase Dir, Next Phase Dir from the dispatch prompt. All pipeline paths constructed as `.pipeline/<run-id>/`.

**Step A — Read Inputs:**
- Core context: `goals.md`, `design.md`, `structure.md`, `plan.md`, `phase-manifest.md`
- Completed phase evidence: `<completed-phase-dir>/execution-manifest.md`, `<completed-phase-dir>/integration-results.md`, `<completed-phase-dir>/acceptance-results.md`, `<completed-phase-dir>/stage7-summary.md`, `<completed-phase-dir>/stage8-summary.md`, `<completed-phase-dir>/tasks/task-*.md` (each individually)
- Next-phase task specs (source-of-truth rule): if `<next-phase-dir>/tasks/task-*.md` exists, treat those as the authoritative remaining task specs; otherwise use top-level `tasks/task-*.md`.
- Prior phase summaries if completed phase > 1
- Deferred feedback: `ls .pipeline/<run-id>/feedback/deferred-replan-*.md`; if none exist, use `None.`

**Step B — Create Working Directories:**
```
bash: mkdir -p .pipeline/<run-id>/reviews
bash: mkdir -p .pipeline/<run-id>/<completed-phase-dir>/replan
bash: mkdir -p .pipeline/<run-id>/<next-phase-dir>/tasks
```

**Step C — Dispatch Replan Writer** via `qrspi_dispatch` with `subagent_type: "qrspi-replan-writer"` and a structured prompt containing all input sections: `=== GOALS ===`, `=== DESIGN ===`, `=== STRUCTURE ===`, `=== CURRENT PLAN ===`, `=== CURRENT PHASE MANIFEST ===`, `=== EXECUTION MANIFEST ===`, `=== INTEGRATION RESULTS ===`, `=== ACCEPTANCE RESULTS ===`, `=== STAGE 7 SUMMARY ===`, `=== STAGE 8 SUMMARY ===`, `=== COMPLETED PHASE TASK SPECS ===`, `=== CURRENT REMAINING TASK SPECS ===`, `=== COMPLETED PHASE ===`, `=== DEFERRED REPLAN FEEDBACK ===`, `=== PRIOR COMPLETED PHASE SUMMARIES ===`, and instructions to revise only remaining work. If the writer returns `### Backward Loop Request`, return it immediately to the main orchestrator with `### Status — PASS` and the backward loop request pasted verbatim. Otherwise, write the writer's output: `### plan.md` → `.pipeline/<run-id>/plan.md`, `### phase-manifest.md` → `.pipeline/<run-id>/phase-manifest.md`, each `### task-NN.md` → `.pipeline/<run-id>/<next-phase-dir>/tasks/task-NN.md`, `### Replan Note` → `.pipeline/<run-id>/<completed-phase-dir>/replan/phase-[PP]-replan.md` (prepending `### Status — PASS` or `### Status — FAIL` as the first line). Do not delete completed-phase task files.

**Step D — Automated Review Loop:**
1. Set `review_round = 1`.
2. For each round, re-read the current `plan.md`, `phase-manifest.md`, next-phase task files, and replan note.
3. Dispatch `qrspi-replan-reviewer` via `qrspi_dispatch` with `subagent_type: "qrspi-replan-reviewer"` passing all required input sections (`=== GOALS ===`, `=== DESIGN ===`, `=== STRUCTURE ===`, `=== PLAN ===`, `=== PHASE MANIFEST ===`, `=== NEXT PHASE TASK SPECS ===`, `=== EXECUTION MANIFEST ===`, `=== ACCEPTANCE RESULTS ===`, `=== COMPLETED PHASE ===`, `=== REPLAN NOTE ===`).
4. Write reviewer output to `.pipeline/<run-id>/reviews/replan-review-round-{NN}.md`.
5. Apply decision logic in order:
   - If reviewer returns `### Status — PASS`: stop the review loop. Terminal state: `clean`.
   - If reviewer returns `### Status — FAIL` and `review_round >= 2` and the current round's `### Fix Guidance` is identical to the prior round's after whitespace normalization: stop the review loop. Terminal state: `stable-cap`.
   - If reviewer returns `### Status — FAIL` and `review_round < 5`: extract the root cause of failure as a one-sentence `ROOT CAUSE OF FAILURE`, write a one-sentence `MUTATION INSTRUCTION`, and re-dispatch `qrspi-replan-writer` with the rejected draft plus `=== CURRENT REPLAN DRAFT PLAN ===`, `=== CURRENT REPLAN DRAFT PHASE MANIFEST ===`, `=== CURRENT NEXT PHASE TASK SPECS ===`, `=== CURRENT REPLAN NOTE ===`, `=== ROOT CAUSE OF FAILURE ===`, `=== MUTATION INSTRUCTION ===`, and `=== REVIEW FEEDBACK ===` (the `### Fix Guidance` section from the reviewer output). Overwrite the updated artifacts, increment `review_round`, and continue.
   - If reviewer returns `### Status — FAIL` and `review_round = 5`: stop the review loop. Terminal state: `unclean-cap`.
6. Track the terminal review state: `clean`, `stable-cap`, or `unclean-cap`.

**Step E — Append Review Status To Next-Phase Task Specs:**
After the review loop ends, append to every task file in `<next-phase-dir>/tasks/`:
```
## Review Status
- **State:** [clean (round NN) | stable-cap (round NN) | unclean-cap (round 5)]
- **Outstanding Concerns:** ["None." if clean, otherwise paste the final review summary verbatim]
```
Skip this step if the refreshed manifest has no further implementation phase.

**Return contract** (three variants):

If the writer requested a backward loop:
```
### Status — PASS
### Phase — [completed phase number]
### Files Written — None.
### Backward Loop Request — [paste verbatim]
### Summary — Phase [N]: backward loop requested during replan: [brief description].
### Telemetry — {"review_rounds": 0, "backward_loop_requested": true}
```

If the replan succeeds:
```
### Status — PASS
### Phase — [completed phase number]
### Files Written — plan.md, phase-manifest.md, <next-phase-dir>/tasks/task-NN.md, reviews/replan-review-round-{NN}.md, <completed-phase-dir>/replan/phase-[PP]-replan.md
### Summary — Replan completed after phase [N]. Remaining work updated for the next phase. Final review state: [clean|stable-cap|unclean-cap].
### Telemetry — {"review_rounds": <N>, "backward_loop_requested": false, "terminal_review_state": "<clean|stable-cap|unclean-cap>"}
```

If any step fails unrecoverably:
```
### Status — FAIL
### Phase — [completed phase number]
### Files Written — [list any files written before failure]
### Summary — [description of what went wrong]
### Telemetry — {"review_rounds": <N completed>, "backward_loop_requested": false, "terminal_review_state": "<clean|stable-cap|unclean-cap>"}
```

---

### Agent 3: `agents/qrspi-replan-writer.md` (Replan Writer)

**Role:** Revises the remaining implementation plan after a completed phase, updating the phase manifest and writing the complete task set for the next implementation phase while preserving completed work. Escalates with `### Backward Loop Request` when the remaining work cannot stay within the existing goals or chosen design approach. Does not write files directly — returns updated artifact contents for the parent orchestrator to write.

**Frontmatter:**
- `description`: "Revises the remaining implementation plan after a completed phase, updating the phase manifest and writing the complete task set for the next implementation phase while preserving completed work. Minor design amendments are allowed only when the chosen approach stays intact."
- `tools`: `read, bash, grep, find, ls, write, edit`
- `model`: `anthropic/claude-sonnet-4-5`
- `thinking`: `low`
- `max_turns`: `40`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-replan-writer.md`):**

The agent is the Replan Writer. It revises only unfinished work after a completed QRSPI phase. It returns updated artifact contents for the parent orchestrator to write.

**Input:** Required inputs arrive under headings: `=== GOALS ===`, `=== DESIGN ===`, `=== STRUCTURE ===`, `=== CURRENT PLAN ===`, `=== CURRENT PHASE MANIFEST ===`, `=== EXECUTION MANIFEST ===`, `=== INTEGRATION RESULTS ===`, `=== ACCEPTANCE RESULTS ===`, `=== STAGE 7 SUMMARY ===`, `=== STAGE 8 SUMMARY ===`, `=== COMPLETED PHASE TASK SPECS ===`, `=== CURRENT REMAINING TASK SPECS ===`, `=== COMPLETED PHASE ===`, `=== DEFERRED REPLAN FEEDBACK ===`. Optional inputs: `=== REVIEW FEEDBACK ===`, `=== ROOT CAUSE OF FAILURE ===`, `=== MUTATION INSTRUCTION ===`, `=== CURRENT REPLAN DRAFT PLAN ===`, `=== CURRENT REPLAN DRAFT PHASE MANIFEST ===`, `=== CURRENT NEXT PHASE TASK SPECS ===`, `=== CURRENT REPLAN NOTE ===`. When retry draft artifacts are present, this is retry revision mode — treat those drafts as authoritative.

**Priority Order (when sources conflict):**
1. Goals and chosen Design approach — immutable. If either must change, return a Backward Loop Request.
2. Completed phases — historical fact; never rewrite scope, numbering, or outcomes.
3. Retry draft artifacts — when present, authoritative working draft.
4. Root Cause of Failure + Mutation Instruction — apply to the draft before broader edits; result must differ from the rejected draft in affected sections.
5. Current Remaining Task Specs — authoritative source for unfinished work; preserve unchanged specs as full copies.

**Deviation Classification:**
- **Minor amendment** — API, library, configuration, or implementation-detail change that keeps the chosen approach, architectural patterns, and component boundaries intact. Document in the replan note.
- **Approach change** — any alteration to the chosen approach, architectural patterns, component boundaries, or system topology. Do not replan; return a Backward Loop Request.

**Remaining-Work Rules:**
- Replan unfinished phases only.
- Keep existing task IDs stable. New tasks receive new IDs and must be named in the replan note.
- Carry forward unchanged next-phase specs as full copies, not references.
- Split a task when it became too large or ambiguous.
- Add a task only when it traces to an existing acceptance criterion or a named completed-phase learning.
- Remove or supersede a task only when the replan note explains how the affected acceptance criterion remains covered.
- Write the complete task set for the next phase only. If no further implementation phase remains, omit task sections and state that in the replan note.
- Every task spec must be self-contained: no placeholders, no "similar to Task N", no hidden assumptions.
- Every remaining phase boundary must state what it proves and what its replan gate checks.
- The replan note must record pragmatic shortcuts or risks from the completed phase and either classify them as safe for the next phase or attach mitigation.

**Output format:**

If Goals or Design must change:
```
### Backward Loop Request
Issue: [what invalidated the remaining plan]
Affected Upstream Stage: Goals | Design
Why Replan Is Unsafe: [why the remaining work cannot stay within the current contract]
```

Otherwise:
```
### plan.md
[full updated plan; completed phases preserved as history]

### phase-manifest.md
[full updated manifest with explicit remaining phase boundaries and replan gates]

### task-NN.md
[one section per task assigned to the next phase — complete set]

### Tasks Added
- [task number and title, or None.]

### Tasks Modified
- [task number and title, or None.]

### Tasks Removed
- [task number and title, or None.]

### Replan Note
# Replan After Phase [N]

## What Changed
- [specific delta]

## Why It Changed
- [specific learning from the completed phase]

## Design Amendments
- [None. or amendment with why it stays within the existing approach]

## Technical Debt Assessment
- Safe for next phase: [item or None.]
- Risk requiring mitigation: [item and mitigation, or None.]

## Next Phase Ready
- Phase [N+1] — [name and what it now proves]
```
If no tasks were added, modified, or removed, write `None.` for that section.

---

### Agent 4: `agents/qrspi-replan-reviewer.md` (Replan Reviewer)

**Role:** Reviews replanned remaining-work artifacts after a completed phase for goals alignment, amendment classification, phase coherence, dependency correctness, and justified task additions or removals. Read-only — does not edit artifacts.

**Frontmatter:**
- `description`: "Reviews replanned remaining-work artifacts after a completed phase for goals alignment, amendment classification, phase coherence, dependency correctness, and justified task additions or removals. Read-only."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `20`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-replan-reviewer.md`):**

The agent is the Replan Reviewer. It reviews updated remaining-work artifacts after a completed phase. It does not edit artifacts, call tools beyond read/bash/grep/find/ls, ask questions, or invent requirements. All findings are based on the supplied artifacts only.

**Inputs:** Goals, Design, Structure, updated plan.md, updated phase-manifest.md, changed/added task-NN.md files, execution-manifest.md (completed phase), acceptance-results.md (completed phase), Completed Phase number, and Replan Note.

**Review Areas** — evaluates each area against the supplied artifacts; PASS only when fully satisfied:

1. **Goals alignment** — new/modified remaining work maps to the existing goals and acceptance criteria.
2. **Evidence alignment** — additions, removals, reordering, and risk handling are supported by the completed phase's execution and acceptance evidence.
3. **Amendment classification** — claimed minor amendments do not change the chosen approach, architectural patterns, or component boundaries.
4. **No design drift** — the replan does not silently change the chosen architecture, vertical-slice strategy, or component boundaries.
5. **Phase coherence** — remaining phase boundaries make sense after the completed phase; each remaining phase has a clear proof target and replan gate.
6. **Dependency correctness** — remaining tasks have explicit, acyclic, backward-pointing dependencies.
7. **Task quality** — changed task specs are self-contained, concrete, and implementable from the supplied artifacts without unstated assumptions.
8. **Change justification** — additions, removals, splits, and reorderings are explicitly justified by completed-phase learnings.
9. **Risk handling** — material technical debt and next-phase risks from the completed phase are captured and either mitigated or explicitly safe to carry.
10. **Completed-phase preservation** — completed phase history is not rewritten or invalidated; removed tasks are not still depended on by the manifest.

**Decision Rules:**
- Return `### Status — PASS` only if every area passes.
- If goals or design must change, fail the relevant area for drift and do not propose new goals or design.
- Under `### Fix Guidance`, write `None.` when all areas pass; otherwise list corrections tied to failed areas only.

**Output format:**
```
### Status — PASS or FAIL

### Review Findings
| Area | Status | Notes |
|------|--------|-------|
| Goals alignment | PASS/FAIL | [brief reason] |
| Evidence alignment | PASS/FAIL | [specific unsupported change, or brief pass reason] |
| Amendment classification | PASS/FAIL | [specific amendment that changes approach, or brief pass reason] |
| No design drift | PASS/FAIL | [what drifted and why, or brief pass reason] |
| Phase coherence | PASS/FAIL | [brief reason] |
| Dependency correctness | PASS/FAIL | [missing or forward dependency, or brief pass reason] |
| Task quality | PASS/FAIL | [brief reason] |
| Change justification | PASS/FAIL | [unjustified change, or brief pass reason] |
| Risk handling | PASS/FAIL | [missing or unmitigated risk, or brief pass reason] |
| Completed-phase preservation | PASS/FAIL | [brief reason] |

### Fix Guidance
None. OR:
1. [artifact correction]
2. [artifact correction]

### Summary
[One-line summary: overall PASS or FAIL and primary issues, if any.]
```

## Files
- `agents/qrspi-backward-loop-detector.md` (CREATE) — Backward loop detector agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the decision algorithm (group failures → change-type checklist → classify by priority → overall recommendation), the classification reference table for all six outcomes (NO_LOOP, DEFER_REPLAN, LOOP_PLAN, LOOP_STRUCTURE, LOOP_DESIGN, LOOP_GOALS), anti-downgrade rules, failure-reason constraints (executed_failed, blocking_review, reconciliation, blocked_action), and the structured output format with Severity Analysis table, Overall Recommendation, Rationale, and optional Backward Loop Request section.
- `agents/qrspi-replan.md` (CREATE) — Replan orchestrator agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 60`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the five-step process (A — read inputs including core context, completed phase evidence, next-phase task specs, prior phase summaries, deferred feedback; B — create working directories; C — dispatch replan writer via qrspi_dispatch with structured prompt including all input sections, handling backward loop escalation and writing artifacts; D — automated review loop up to 5 rounds with convergence detection, mutation instruction generation, and terminal states clean/stable-cap/unclean-cap; E — append review status to next-phase task specs) with three return contract variants (backward loop requested, replan succeeds, unrecoverable failure). Includes critical rules (forbidden from writing code, invoke subagents directly, stop after dispatch, replan only remaining work, no goals or design drift).
- `agents/qrspi-replan-writer.md` (CREATE) — Replan writer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 40`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the priority order for conflict resolution (goals/design immutable, completed phases historical, retry drafts authoritative, root cause + mutation instruction, remaining task specs), deviation classification (minor amendment vs approach change), remaining-work rules (stable IDs, full copies, task split/add/remove criteria, self-contained specs, phase boundary proof targets, replan note with technical debt assessment), and the dual output format (Backward Loop Request when goals/design must change, or plan.md + phase-manifest.md + task-NN.md sections + Tasks Added/Modified/Removed tables + Replan Note with What Changed, Why It Changed, Design Amendments, Technical Debt Assessment, Next Phase Ready).
- `agents/qrspi-replan-reviewer.md` (CREATE) — Replan reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the 10 review areas (goals alignment, evidence alignment, amendment classification, no design drift, phase coherence, dependency correctness, task quality, change justification, risk handling, completed-phase preservation) with PASS/FAIL per area, decision rules (PASS requires every area to pass; do not propose new goals/design on drift failure), and structured output format with Review Findings table, Fix Guidance, and Summary.

## Test Expectations
- **YAML frontmatter parseable on all four files:** When any YAML parser reads each `agents/qrspi-backward-loop-detector.md`, `agents/qrspi-replan.md`, `agents/qrspi-replan-writer.md`, and `agents/qrspi-replan-reviewer.md`, the frontmatter between `---` delimiters parses without error and contains the keys `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`.
- **Detector frontmatter values correct:** When `qrspi-backward-loop-detector.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `20`, and `prompt_mode` equals `"replace"`.
- **Replan orchestrator frontmatter values correct:** When `qrspi-replan.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls, write, edit"`, `model` equals `"anthropic/claude-sonnet-4-5"`, `thinking` equals `"low"`, `max_turns` equals `60`, and `prompt_mode` equals `"replace"`.
- **Replan writer frontmatter values correct:** When `qrspi-replan-writer.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls, write, edit"`, `model` equals `"anthropic/claude-sonnet-4-5"`, `thinking` equals `"low"`, `max_turns` equals `40`, and `prompt_mode` equals `"replace"`.
- **Replan reviewer frontmatter values correct:** When `qrspi-replan-reviewer.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `20`, and `prompt_mode` equals `"replace"`.
- **Detector system prompt contains six classifications with priority order:** When `qrspi-backward-loop-detector.md` is read, the body describes six classifications and states the priority order as LOOP_GOALS → LOOP_DESIGN → LOOP_STRUCTURE → DEFER_REPLAN → NO_LOOP → LOOP_PLAN (first YES wins), and includes a classification reference table with change types, labels, and examples.
- **Detector system prompt contains anti-downgrade rules:** When `qrspi-backward-loop-detector.md` is read, the body forbids downgrading a classification to avoid a backward loop, states that interface/schema/API changes are LOOP_STRUCTURE (never LOOP_PLAN or NO_LOOP), and that architecture changes are LOOP_DESIGN (never LOOP_STRUCTURE or LOOP_PLAN).
- **Detector system prompt contains failure-reason constraints:** When `qrspi-backward-loop-detector.md` is read, the body describes how `blocking_review`/`reconciliation` rows cap classification at LOOP_PLAN, `blocked_action` default to DEFER_REPLAN or LOOP_PLAN, and `executed_failed` rows are eligible for the full classification ladder.
- **Detector system prompt contains output format with Severity Analysis table:** When `qrspi-backward-loop-detector.md` is read, the body describes the output format containing a `### Severity Analysis` table with columns for Criterion, Failure Reason, Failure, all change-type checklists, Classification, Loop-back Target, and Rationale, plus `### Overall Recommendation`, `### Rationale`, and optional `### Backward Loop Request` sections.
- **Replan orchestrator system prompt contains five critical rules:** When `qrspi-replan.md` is read, the body contains the text "FORBIDDEN FROM WRITING CODE" (or equivalent), references `qrspi_dispatch` as the dispatch mechanism, and states the rule to stop after subagent dispatch.
- **Replan orchestrator system prompt contains five-step process:** When `qrspi-replan.md` is read, the body describes Steps A–E (read inputs, create directories, dispatch writer, review loop, append review status) in sequence.
- **Replan orchestrator system prompt contains review loop with convergence logic:** When `qrspi-replan.md` is read, the body describes a review loop with up to 5 rounds, convergence detection (stable-cap when fix guidance repeats), mutation instruction extraction on FAIL, and terminal states `clean`, `stable-cap`, and `unclean-cap`.
- **Replan orchestrator system prompt contains backward loop escalation:** When `qrspi-replan.md` is read, the body describes that if the replan writer returns a backward loop request, the orchestrator returns immediately with `### Status — PASS` and `### Backward Loop Request` pasted verbatim.
- **Replan orchestrator system prompt contains return contract with three variants:** When `qrspi-replan.md` is read, the body contains return format examples for backward loop requested, replan succeeds, and unrecoverable failure, each with `### Status`, `### Phase`, `### Files Written`, `### Summary`, and `### Telemetry` sections.
- **Replan writer system prompt contains priority order for conflict resolution:** When `qrspi-replan-writer.md` is read, the body describes the priority order: goals/design immutable → completed phases → retry drafts → root cause + mutation instruction → remaining task specs.
- **Replan writer system prompt contains deviation classification:** When `qrspi-replan-writer.md` is read, the body distinguishes between minor amendments (approach stays intact) and approach changes (must return Backward Loop Request).
- **Replan writer system prompt contains remaining-work rules:** When `qrspi-replan-writer.md` is read, the body states that task IDs must stay stable, new tasks get new IDs, unchanged specs must be full copies, task splits/additions/removals have justification rules, and every task spec must be self-contained.
- **Replan writer system prompt contains dual output format:** When `qrspi-replan-writer.md` is read, the body describes both the Backward Loop Request output (Issue, Affected Upstream Stage, Why Replan Is Unsafe) and the standard artifact output (plan.md, phase-manifest.md, task-NN.md sections, Tasks Added/Modified/Removed, Replan Note with What Changed, Why It Changed, Design Amendments, Technical Debt Assessment, Next Phase Ready).
- **Replan reviewer system prompt contains 10 review areas:** When `qrspi-replan-reviewer.md` is read, the body lists exactly 10 review areas: goals alignment, evidence alignment, amendment classification, no design drift, phase coherence, dependency correctness, task quality, change justification, risk handling, and completed-phase preservation.
- **Replan reviewer system prompt contains decision rules:** When `qrspi-replan-reviewer.md` is read, the body states that PASS requires every area to pass, and that goals/design drift failures should not propose new goals or design (that is the orchestration layer's job).
- **Replan reviewer system prompt contains structured output format:** When `qrspi-replan-reviewer.md` is read, the body describes the output format containing `### Status — PASS or FAIL`, a `### Review Findings` table with columns Area, Status, and Notes for all 10 areas, `### Fix Guidance` (numbered corrections or `None.`), and `### Summary` (one-line summary).
- **Model tier assignment:** When comparing all four files, the orchestrator (`qrspi-replan`) uses `anthropic/claude-sonnet-4-5` (sonnet-tier), the writer (`qrspi-replan-writer`) uses `anthropic/claude-sonnet-4-5` (sonnet-tier), the detector (`qrspi-backward-loop-detector`) uses `anthropic/claude-haiku-4-5` (haiku-tier), and the reviewer (`qrspi-replan-reviewer`) uses `anthropic/claude-haiku-4-5` (haiku-tier), satisfying the model tier requirement from AC 7 and NFR: Compatibility.
- **File count:** When listing created files, exactly four agent type `.md` files exist: `agents/qrspi-backward-loop-detector.md`, `agents/qrspi-replan.md`, `agents/qrspi-replan-writer.md`, and `agents/qrspi-replan-reviewer.md`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
