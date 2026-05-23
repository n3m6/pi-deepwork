# Task 09: Stage 2 agent types (Questions)

## Metadata
- **Task:** 09
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 2a — Questions

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 2 agent types — all 10 stages produce their prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree following the file-based protocol convention), AC 7 (model tier frontmatter — works with multiple model tiers: haiku-tier for reviewer and leaf agents, sonnet-tier for orchestrator agents)
- **NFRs:** NFR: Compatibility (multiple model tiers — haiku-tier for reviewer/leaf agents, sonnet-tier for orchestrator agents)
- **Replan Gate Criteria:** Phase 2 replan gate — Questions agents complete (all four Stage 2 agent type `.md` files are converted from opencode sources with correct YAML frontmatter per the conversion tables, each structurally valid with parseable frontmatter and system prompt body present, dispatch contracts preserved, review loop logic and synthesizer dispatch patterns intact)

## Source Traceability
- **Goals:** AC 6, AC 7
- **Plan:** Task 09, Phase 2 — Planning Pipeline (Stages 2–6)
- **Design:** Slice 2a — Questions (part of Slice 2: Planning Pipeline — Stages 2–6). The Questions stage reads `goals.md` + `requirements.md`, dispatches the generator and both reviewers, runs a quality/leakage review loop, and writes `goal-inventory.md`, `questions.md`, and review artifacts.
- **Structure:** Slice 2a — Questions Stage (Stage 2): `agents/qrspi-questions.md` (CREATE), `agents/qrspi-question-generator.md` (CREATE), `agents/qrspi-question-leakage-reviewer.md` (CREATE), `agents/qrspi-question-quality-reviewer.md` (CREATE)

## Description

Create four Stage 2 agent type `.md` files for the QRSPI Questions pipeline stage. These agents collaborate to generate neutral, goal-tracked research questions from the goals produced in Stage 1, run independent leakage and quality reviews, and loop automatically until reviews are clean or the review cap is reached.

Each agent file follows the pi agent type convention: YAML frontmatter containing `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions` fields, followed by a system prompt body adapted from the opencode source equivalents using the conversion tables documented in requirements.md.

### Conversion Rules Applied

The opencode → pi frontmatter mappings applied to these agents:

| opencode field | pi frontmatter | Value for these agents |
|---|---|---|
| `description` | `description` | Direct mapping — preserved from opencode |
| `mode: subagent` | N/A | All pi agents are subagent-style |
| `hidden: true` | `enabled: false` | All four agents are hidden from listing but spawnable |
| `steps: N` | `max_turns: N` | As specified per agent below |
| `temperature: 0.1` | N/A | pi handles temperature differently — omit |
| `permission.edit: allow` | `tools: read, bash, grep, find, ls, write, edit` | Orchestrator + generator get full write access |
| `permission.edit: deny` | `tools: read, bash, grep, find, ls` | Reviewers get read-only tools |
| `permission.bash: ...` | `tools` comma-separated list | Allowed bash operations folded into `tools` field |
| `permission.task: "qrspi-*"` | N/A | Uses `qrspi_dispatch` tool instead |
| `permission.webfetch: deny` | `extensions: false` | No web fetch access |
| `permission.question: deny` | N/A | Not needed for these agents |

System prompt body adaptations applied:
- `cat .pipeline/...` → `Read .pipeline/...` (read tool)
- `Invoke <agent> as a subagent:` → `Use the qrspi_dispatch tool with subagent_type: "<agent>"`
- File write operations via the `bash` tool or `write`/`edit` tools
- `=== RUN ID ===` and `=== USER TASK ===` headers preserved verbatim in dispatch prompt context

### Agent 1: `agents/qrspi-questions.md` (Stage 2 Orchestrator)

**Role:** Stage 2 orchestrator — reads `goals.md` and `requirements.md` from Stage 1, builds a normalized goal inventory, dispatches `qrspi-question-generator` to produce research questions, then runs a dual-review loop with `qrspi-question-leakage-reviewer` and `qrspi-question-quality-reviewer`. Writes `goal-inventory.md`, `questions.md`, `question-leakage-review.md`, and `question-quality-review.md` to `.pipeline/<run-id>/`.

**Frontmatter:**
- `description`: "Stage 2 orchestrator — generates neutral, goal-tracked research questions from goals and preserved requirements, runs dual reviews, and auto-continues after bounded review. Writes goal-inventory.md, questions.md, and review artifacts."
- `tools`: `read, bash, grep, find, ls, write, edit`
- `model`: `anthropic/claude-sonnet-4-5`
- `thinking`: `low`
- `max_turns`: `35`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-questions.md`):**

The orchestrator receives `=== RUN ID === <run-id>` from the main orchestrator and follows this process:

1. **Step A — Read Goals, Normalize, and Persist Goal Inventory.** Read `goals.md` and `requirements.md` from `.pipeline/<run-id>/`. Build a normalized goal inventory mapping `## Functional Requirements` bullets → `FR-1`, `FR-2`, ...; `## Non-Functional Requirements` bullets → `NFR-1`, `NFR-2`, ...; `## Constraints` bullets → `C-1`, `C-2`, ...; `## Acceptance Criteria` numbered items → `AC-1`, `AC-2`, .... Write `goal-inventory.md` as a markdown table with columns `ID`, `Type`, `Goal Item`.

2. **Step B — Generate Questions.** Dispatch `qrspi-question-generator` via `qrspi_dispatch` with subagent_type `"qrspi-question-generator"`, passing `goals.md`, `requirements.md`, and `goal-inventory.md` verbatim in the prompt. Write the output to `.pipeline/<run-id>/questions.md`.

3. **Step C — Review and Regeneration Loop.** Set `review_round = 1`. While `review_round ≤ 2`:
   - Dispatch both `qrspi-question-leakage-reviewer` and `qrspi-question-quality-reviewer` in a single turn via `qrspi_dispatch` (can dispatch multiple subagents in one turn; end the turn after dispatch).
   - Write leakage reviewer output to `question-leakage-review.md` and quality reviewer output to `question-quality-review.md`.
   - If both return `### Status — PASS`: set `terminal_review_state = clean` and return.
   - If either returns `### Status — FAIL` and `review_round < 2`: re-dispatch `qrspi-question-generator` with original inputs plus both review outputs as `=== REVIEW FEEDBACK ===`, overwrite `questions.md`, increment `review_round`, and repeat.
   - If either returns `### Status — FAIL` at `review_round = 2`: set `terminal_review_state = unclean-cap` and return without another regeneration.

4. **Return contract:**
   ```
   ### Status — PASS
   ### Files Written — goal-inventory.md, questions.md, question-leakage-review.md, question-quality-review.md
   ### Summary — Questions generated and reviewed. Final review state: [clean|unclean-cap].
   ### Telemetry — {"review_rounds": <N>, "gate_status": "none", "gate_rounds": 0, "terminal_review_state": "<clean|unclean-cap>"}
   ```
   On unrecoverable failure, return `### Status — FAIL` with files written, summary, and telemetry.

**Critical rules preserved in the prompt:**
- Forbidden from writing code — only writes pipeline state files inside `.pipeline/qrspi-<run-id>/`.
- Dispatches child agents directly via `qrspi_dispatch` (not plain text descriptions).
- Stops after subagent dispatch — does not write further until the subagent response is received.

### Agent 2: `agents/qrspi-question-generator.md` (Question Generator)

**Role:** Generates neutral, repo-grounded research questions from `goals.md`, `requirements.md`, and the normalized goal inventory. The normalized goal inventory is the sole completeness contract — every `FR-*`, `NFR-*`, `C-*`, and `AC-*` item must be covered by at least one question. Incorporates reviewer and human feedback when provided. Produces `questions.md`.

**Frontmatter:**
- `description`: "Generates neutral, tagged, goal-tracked research questions grounded in the repo and normalized goal inventory. Uses the normalized goal inventory as the sole completeness contract, drafts only necessary questions with traceability fields, and incorporates reviewer and human feedback. Read-only — never modifies project files."
- `tools`: `read, bash, grep, find, ls, write, edit`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `30`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-question-generator.md`):**

Receives goals, requirements, a normalized goal inventory, and optional review feedback. Follows these steps:

1. **Step 0 — Repo orientation (internal).** Run bounded read-only shell commands: `ls` top-level, read `README.md` and package manifests (`package.json`, etc.), `find . -maxdepth 2` (excluding `.git`, `node_modules`, `.pipeline`), and `grep` for up to 5 repo-facing nouns from the inventory.

2. **Step 1 — Build goal coverage map (internal).** For each inventory item, identify unknowns that would block design, planning, or verification if unanswered. Determine whether each needs codebase evidence, web evidence, or both. Assess materiality of external dependency behavior. Assign risk level (high/medium/low). Every ID must be covered by at least one question.

3. **Step 2 — Draft questions.** For each distinct unresolved unknown, draft one question with four required fields:
   - **Tag:** `codebase`, `web`, or `hybrid` (use `hybrid` only when splitting into separate questions would lose the decision point).
   - **Covers:** one or more normalized IDs with optional short labels: `FR-1 [label]; AC-2 [label]`.
   - **Answer shape:** 1–2 sentences specifying artifact form (table, list, matrix, inventory), scope boundary, and stop condition.
   - **Decision unblocked:** one primary downstream design, planning, or verification decision.

4. **Step 3 — Apply neutrality rewrites.** Every question must pass the neutrality contract: may reference existing systems, files, libraries, and patterns in the repo today; must not reference intended changes, proposed feature names, desired outcomes, future-state labels, or prescriptive implementation direction. Replace `where should we add X` → `where does the current code handle [related behavior] today`, `which approach should we use` → `what patterns already exist`, `how do we implement X` → `how does the current system work`.

5. **Steps 4–5 — Incorporate review feedback and human feedback** (if provided). Treat every question marked `LEAKS` or otherwise flagged as invalid. Rewrite, retag, split, merge, drop, or add questions per reviewer guidance. Confirm every normalized ID remains covered.

6. **Output format:** `# Research Questions` with each question as `### Q1: [question text]` followed by `**Tag**:`, `**Covers**:`, `**Answer shape**:`, `**Decision unblocked**:` fields.

7. **Pre-Return Checklist:** Verify every normalized goal ID appears in at least one `Covers` field, every question has exactly one tag and all four fields, every `Answer shape` specifies artifact form/scope/stop condition, no question references intended changes or asks for solution choices, no meta-questions about goals, no redundancy, `hybrid` used only when splitting would break coherence, reviewer-flagged questions are materially rewritten, all human feedback addressed.

### Agent 3: `agents/qrspi-question-leakage-reviewer.md` (Leakage Reviewer)

**Role:** Reviews generated research questions independently for goal leakage — flags any question text that could reveal the planned change to a goal-blind researcher. Infers the intended change from Goals and Requirements, then classifies each question as SAFE or LEAKS. Provides neutral rewrites only for leaking questions. Read-only.

**Frontmatter:**
- `description`: "Reviews generated research questions independently for goal leakage. Uses goals and preserved requirements as context to flag direct or indirect question-text wording that could reveal the planned change to a goal-blind researcher. Read-only."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `15`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-question-leakage-reviewer.md`):**

Receives Goals, Requirements, and Questions. Evaluates only each question's title/text (ignores `Covers`, `Answer shape`, `Decision unblocked` — those are internal planning aids). For each question asks: if a researcher saw only this question text, could they reasonably infer the planned feature, fix, desired outcome, or implementation direction?

**Leak labels:** `feature-name`, `desired-outcome`, `implementation-direction`, `prescriptive-solution`, `implicit-target-state`.

**Allowed:** existing-system terms (systems, files, libraries, patterns) when they appear as current-state context in the supplied artifacts.
**Leaking:** intended feature or change names, desired end states, future-state labels, implementation/replacement/migration/fix direction, or wording that asks what should be added or changed.

**Neutral rewrite patterns:** For each leaking question, preserve the information need while removing intent — prefer angles about how the current system works, where relevant behavior/code paths live, what existing patterns/constraints exist, or what evidence is needed for a later decision without presupposing that decision.

**Output format:**
```
### Status — PASS or FAIL

### Review Findings
| # | Question | Status | Notes |
|---|----------|--------|-------|

### Rewrite Guidance
[numbered rewrites, or `None.`]

### Stage Summary
[N] safe, [M] leaking. Overall: PASS or FAIL.
```

**Rules:** PASS only if every question is SAFE; FAIL if any question leaks. Write `None.` under `### Rewrite Guidance` when no questions leak. Do not add new research areas or invent goals. Do not ask user questions — this is an internal review pass.

### Agent 4: `agents/qrspi-question-quality-reviewer.md` (Quality Reviewer)

**Role:** Reviews generated research questions for normalized-goal coverage, objectivity, tag accuracy, dependency-question materiality, hybrid necessity, redundancy, boundedness, per-question field completeness, traceability, necessity, and decision relevance. Uses the normalized goal inventory as the sole coverage contract. Provides targeted correction guidance. Read-only.

**Frontmatter:**
- `description`: "Reviews generated research questions independently for normalized-goal coverage, objectivity, tag accuracy, dependency-question materiality, hybrid necessity, redundancy, boundedness, per-question field completeness, traceability, necessity, and decision relevance. Read-only."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `15`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-question-quality-reviewer.md`):**

Receives Goals, Requirements, Normalized Goal Inventory, and Questions. The inventory (`FR-*`, `NFR-*`, `C-*`, `AC-*`) is the sole coverage contract; uses goals and requirements only to interpret inventory items and assess materiality — does not derive additional required coverage.

**Per-question checks** (flag material issues in): objectivity (asks for facts, not proposed changes), tag accuracy (codebase/web/hybrid matches evidence required), field completeness (all four fields present), Covers (cites only real IDs from normalized inventory), bounded scope (Answer shape names concrete artifact form, scope boundary, completion condition), decision necessity (Decision unblocked names one primary real downstream decision).

**Set-level checks** (flag material issues in): coverage (every normalized goal ID appears in at least one question's Covers field), dependency materiality (dependency-validation questions exist only for materially relevant external deps), redundancy (no two questions ask materially the same thing).

**Process:**
1. Read all inputs. Interpret each inventory item using goals and requirements.
2. Review each question using per-question checks.
3. Build a traceability matrix: for every inventory ID, record which question(s) cover it and whether coverage is present.
4. Review the full set using set-level checks.
5. For every issue, provide precise guidance: retag, rewrite, split, merge, narrow, drop, or add a question tied to a specific inventory ID.

**Output format:**
```
### Status — PASS or FAIL

### Per-Question Findings
| # | Question | Status | Notes |
|---|----------|--------|-------|

### Traceability Matrix
| ID | Type | Goal Item | Covered by Q# | Status |
|----|------|-----------|---------------|--------|

### Set-Level Findings
[numbered issues, or `None.`]

### Improvement Guidance
[numbered guidance, or `None.`]

### Stage Summary
[N] questions OK, [M] questions need changes. Traceability: [K] inventory items covered, [J] missing. Overall: PASS or FAIL.
```

**Rules:** PASS only when every per-question check passes and the full set has no material coverage gaps, redundancy, boundedness failures, unjustified dependency questions, or uncovered inventory IDs. FAIL when any material issue exists or any inventory ID is uncovered. Always emit the traceability matrix. Write `None.` for empty sections. Do not invent goals, inventory IDs, or coverage requirements. Question count alone is never a failure reason. Do not ask user questions. Leakage is out of scope (handled by the leakage reviewer).

## Files
- `agents/qrspi-questions.md` (CREATE) — Stage 2 orchestrator agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 35`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the three-step process (read goals → normalize inventory → generate questions → dual review loop → return) with the critical rules, input format, goal inventory algorithm, dispatch prompts for all three child agents, review loop logic with 2-round cap, and return contract including telemetry.
- `agents/qrspi-question-generator.md` (CREATE) — Question generator agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 30`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the 6-step generation process (repo orientation → goal coverage map → draft questions with 4 required fields → apply neutrality rewrites → incorporate review/human feedback → pre-return checklist) with the output format (`# Research Questions` with `### Q1` headings and `Tag`/`Covers`/`Answer shape`/`Decision unblocked` fields), neutrality contract, completeness contract, and examples of good vs bad questions.
- `agents/qrspi-question-leakage-reviewer.md` (CREATE) — Leakage reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 15`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the leakage review process: infer intended change from Goals and Requirements, classify each question as SAFE or LEAKS based on whether its visible text reveals intent, provide neutral rewrites using preferred angles, and output in the structured format (`### Status`, `### Review Findings` table, `### Rewrite Guidance`, `### Stage Summary`). Includes leak label taxonomy and rewrite patterns.
- `agents/qrspi-question-quality-reviewer.md` (CREATE) — Quality reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 15`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body describes the quality review process: per-question checks (objectivity, tag, field completeness, Covers, bounded scope, decision necessity), set-level checks (coverage via traceability matrix, dependency materiality, redundancy), and output format (`### Status`, `### Per-Question Findings` table, `### Traceability Matrix` table, `### Set-Level Findings`, `### Improvement Guidance`, `### Stage Summary`). Includes rules for PASS/FAIL criteria.

## Test Expectations
- **YAML frontmatter parseable on all four files:** When any YAML parser reads each `agents/qrspi-questions.md`, `agents/qrspi-question-generator.md`, `agents/qrspi-question-leakage-reviewer.md`, and `agents/qrspi-question-quality-reviewer.md`, the frontmatter between `---` delimiters parses without error and contains the keys `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`.
- **Orchestrator frontmatter values correct:** When `qrspi-questions.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls, write, edit"`, `model` equals `"anthropic/claude-sonnet-4-5"`, `thinking` equals `"low"`, `max_turns` equals `35`, and `prompt_mode` equals `"replace"`.
- **Generator frontmatter values correct:** When `qrspi-question-generator.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls, write, edit"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `30`, and `prompt_mode` equals `"replace"`.
- **Leakage reviewer frontmatter values correct:** When `qrspi-question-leakage-reviewer.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `15`, and `prompt_mode` equals `"replace"`.
- **Quality reviewer frontmatter values correct:** When `qrspi-question-quality-reviewer.md` frontmatter is read, `tools` equals `"read, bash, grep, find, ls"`, `model` equals `"anthropic/claude-haiku-4-5"`, `thinking` equals `"low"`, `max_turns` equals `15`, and `prompt_mode` equals `"replace"`.
- **Orchestrator system prompt contains critical rules:** When `qrspi-questions.md` is read, the body after the frontmatter contains the text "FORBIDDEN FROM WRITING CODE" (or equivalent forbidding-code directive) and the `qrspi_dispatch` tool is referenced as the mechanism for dispatching child agents.
- **Orchestrator system prompt contains review loop:** When `qrspi-questions.md` is read, the body describes a review loop with at most 2 rounds, dispatching both `qrspi-question-leakage-reviewer` and `qrspi-question-quality-reviewer`, with re-dispatch of `qrspi-question-generator` on reviewer FAIL.
- **Orchestrator system prompt contains return contract:** When `qrspi-questions.md` is read, the body contains `### Status — PASS` or `### Status — FAIL` return format with `### Files Written`, `### Summary`, and `### Telemetry` sections.
- **Generator system prompt contains four output fields:** When `qrspi-question-generator.md` is read, the body requires every generated question to include `**Tag**:`, `**Covers**:`, `**Answer shape**:`, and `**Decision unblocked**:` fields.
- **Generator system prompt contains neutrality contract:** When `qrspi-question-generator.md` is read, the body forbids referencing intended changes, proposed feature names, desired outcomes, or implementation direction in question text.
- **Leakage reviewer system prompt contains SAFE/LEAKS classification:** When `qrspi-question-leakage-reviewer.md` is read, the body describes classifying each question as SAFE or LEAKS and provides leak labels and neutral rewrite patterns.
- **Quality reviewer system prompt contains traceability matrix:** When `qrspi-question-quality-reviewer.md` is read, the body requires a traceability matrix with columns for ID, Type, Goal Item, Covered by Q#, and Status, and states that every normalized goal ID must appear in the matrix.
- **Quality reviewer PASS/FAIL rules:** When `qrspi-question-quality-reviewer.md` is read, the body states that PASS requires every per-question check to pass and the full set to have no material coverage gaps, redundancy, boundedness failures, unjustified dependency questions, or uncovered inventory IDs.
- **Model tier assignment:** When comparing all four files, the orchestrator (`qrspi-questions`) uses `anthropic/claude-sonnet-4-5` (sonnet-tier) and all three leaf agents (`qrspi-question-generator`, `qrspi-question-leakage-reviewer`, `qrspi-question-quality-reviewer`) use `anthropic/claude-haiku-4-5` (haiku-tier), satisfying the model tier requirement.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
