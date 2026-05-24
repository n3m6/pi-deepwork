# Task 07: Stage 1 agent types (Goals)

## Metadata
- **Task:** 07
- **Phase:** 1
- **Route:** full
- **Slice:** Slice 1 — Stage 1 Goals

## Dependencies
- **Task 01** — Project scaffolding and package manifest. Task 01 creates the `agents/` directory (empty) under the project root, so this task can populate it with the three Stage 1 agent type files. If the directory is missing for any reason, this task creates it defensively via `mkdir -p agents`.

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 1 artifact production — these agent types are the Stage 1 subagents that produce `goals.md`, `config.md`, `requirements.md`, and review artifacts), AC 7 (model tier in frontmatter — haiku-tier for `qrspi-goals-reviewer`, sonnet-tier for `qrspi-goals` and `qrspi-goals-synthesizer`)
- **NFRs:** NFR: Compatibility (model tier frontmatter — each agent type carries an explicit `model` field in its YAML frontmatter so pi-subagents resolves the correct model tier)
- **Replan Gate Criteria:** Phase 1 replan gate (Stage 1 agents functional — these three agent type files are the Stage 1 subagent definitions that the orchestrator dispatches to execute the Goals stage end-to-end)

## Source Traceability
- **Goals:** AC 6, AC 7
- **Plan:** Task 07, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Slice 1 — Stage 1 Goals (Stage 1 orchestrator dispatches leaf agents `qrspi-goals-synthesizer` and `qrspi-goals-reviewer` via `qrspi_dispatch`; leaf agents produce `goals.md`, `config.md`, and review artifacts; human gate presented via `qrspi_question`)
- **Structure:** Slice 1 — Goals Stage (Stage 1 Orchestrator + Leaf Agents); files: `agents/qrspi-goals.md`, `agents/qrspi-goals-synthesizer.md`, `agents/qrspi-goals-reviewer.md`

## Description

Create three pi agent type `.md` files for the Stage 1 — Goals pipeline stage. Each file is ported from its opencode equivalent using the documented conversion tables from the requirements. Every agent type follows the pi YAML frontmatter convention with required fields: `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`. The system prompt body (everything after the `---` closing delimiter) is adapted from the opencode source by replacing opencode-specific patterns with pi equivalents.

### Conversion Rules Applied

Apply these substitutions to every opencode pattern found in the system prompt body of all three agent files:

| OpenCode pattern | pi equivalent |
|---|---|
| `Invoke <agent> as a subagent:` | `Use the qrspi_dispatch tool with subagent_type: "<agent>"` |
| `dispatch <agent> as a subagent` | `dispatch <agent> via qrspi_dispatch` |
| `cat .pipeline/<path>` | `Read .pipeline/<path>` |
| `mkdir -p <path>` | `bash: mkdir -p <path>` |
| `date -u +...` | `bash: date -u +...` |
| `question` (tool reference) | `qrspi_question` (tool reference) |

Additionally:
- Remove all `todowrite` references. pi has its own task tracking.
- Remove opencode permission system language (permission lists, `allowed-list`, Rule 11, etc.). In pi, permissions are approximated via `tools` and `disallowed_tools` frontmatter fields.
- Keep all pipeline protocol content verbatim: `=== RUN ID ===` headers, `### Status — PASS/FAIL` return format, `### Route`, `### Files Written`, `### Summary`, `### Telemetry` sections, stage dispatch prompt templates, and artifact paths.
- Keep all stage logic intact: interview loop, review loop, human gate workflow, feedback round handling, route determination, return contract.

### Agent 1: `agents/qrspi-goals.md` — Stage 1 Orchestrator

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-goals.md` (244 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Stage 1 orchestrator — captures user intent via interactive dialogue, dispatches goals synthesizer and reviewer, runs human gate for approval. Writes requirements.md, goals.md, and config.md."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 80
prompt_mode: replace
extensions: false
---
```

**System prompt body adaptations beyond the conversion table:**

1. **Step A2 — Repo orientation (line ~57-65):** Replace `cat README.md` with `Read README.md`. Replace `ls` with tool reference `ls` (pi's `ls` tool). Replace `find ...` with pi-appropriate glob or bash pattern. Replace `grep -r ...` with pi's `grep` tool reference. Keep the orientation steps structurally identical.

2. **Step B — Dispatch Synthesizer (line ~120-134):** Replace `Invoke qrspi-goals-synthesizer as a subagent:` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-goals-synthesizer":`. Keep the `=== RUN ID ===`, `=== USER TASK ===`, and `=== INTERVIEW RECORD ===` blocks verbatim. Remove the `=== FEEDBACK HISTORY ===` and `=== REVIEW FEEDBACK ===` optional blocks from the initial dispatch template — those are only included in review-loop re-dispatches.

3. **Step D — Checklist Review Loop (line ~142-168):** Replace `dispatch qrspi-goals-reviewer as a subagent:` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-goals-reviewer":`. Keep the `=== REQUIREMENTS ===`, `=== INTERVIEW RECORD ===`, and `=== GOALS ===` input blocks verbatim. Replace `mkdir -p .pipeline/<run-id>/reviews/` with `bash: mkdir -p .pipeline/<run-id>/reviews/`. Keep the "re-dispatch qrspi-goals-synthesizer" pattern — convert to `qrspi_dispatch` with `subagent_type: "qrspi-goals-synthesizer"` and include `=== REVIEW FEEDBACK ===` input block.

4. **Step E — Human Gate (line ~169-224):**
   - Replace each `date -u +%Y-%m-%dT%H:%M:%SZ` with `bash: date -u +%Y-%m-%dT%H:%M:%SZ`.
   - Replace `cat .pipeline/<run-id>/goals.md` with `Read .pipeline/<run-id>/goals.md`.
   - Replace `question` tool calls with `qrspi_question`. The `qrspi_question` tool takes `header`, `message`, `options`, and `type` parameters. Convert the question block so that the gate prompt text is the `message`, use `header: "Goals — Review"`, `options: ["approve", "provide feedback"]`, and `type: "select"`.
   - Replace `mkdir -p .pipeline/<run-id>/feedback` with `bash: mkdir -p .pipeline/<run-id>/feedback`.
   - Replace `cat .pipeline/<run-id>/feedback/goals-round-*.md` with reading those files via the `Read` tool (read each round's feedback file individually since pi's Read tool targets specific file paths).
   - Keep the feedback round logic, re-dispatch logic, and return contract unchanged.

5. **Return contract (line ~225-244):** Keep unchanged — pi stage orchestrators return structured text that the main orchestrator parses.

6. **Remove:** The "Critical Rules" section (line ~23-28) — particularly "Stop after each subagent dispatch" and "No code edits" — should be adapted, not removed. Keep the constraint about writing only pipeline state files. Replace "Dispatch subagents directly. Never describe a handoff in plain text." with pi-equivalent: "Dispatch leaf agents via `qrspi_dispatch`. Never describe a handoff in plain text." The "Stop after each subagent dispatch" rule stays because foreground `qrspi_dispatch` blocks until the leaf agent completes.

### Agent 2: `agents/qrspi-goals-synthesizer.md` — Goal Synthesizer Leaf Agent

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-goals-synthesizer.md` (93 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Synthesizes goals.md and config.md from interview context. Produces formal goals artifact with intent, functional requirements, non-functional requirements, technical specification, constraints, non-goals, acceptance criteria, and route determination."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 40
prompt_mode: replace
extensions: false
---
```

**System prompt body adaptations:**

1. The synthesizer is a read-only leaf agent in the opencode source (`edit: deny`, `bash: "*": deny`). In the pi port, it receives full read/write tools (`tools: read, bash, grep, find, ls, write, edit`) per the requirements agent-type table. The prompt body must retain the constraint: "Do not modify project files, run builds, or ask questions" — this keeps behavior consistent even though the tools allow writes. The only files it should write are pipeline artifacts written to `.pipeline/<run-id>/` by the orchestrator (the synthesizer returns sections of content to the orchestrator, not writes files directly).

2. **No conversion changes needed in the body** — the synthesizer has no `task`, `question`, `cat`, `mkdir`, or `date` references. Its system prompt is a pure input→output specification. Keep the input expectations (`=== RUN ID ===`, `=== USER TASK ===`, `=== INTERVIEW RECORD ===`, `=== FEEDBACK HISTORY ===`, `=== REVIEW FEEDBACK ===`), source authority rules, process steps (1–10), and output format (`### goals.md` and `### config.md` sections) verbatim.

3. The output format (lines ~47-93) is preserved exactly — the `### goals.md` and `### config.md` section delimiters, the goals.md structure (Intent, Functional Requirements, Non-Functional Requirements, Technical Specification, Constraints, Non-Goals, Acceptance Criteria), and the config.md YAML frontmatter (`created`, `route`, `run_id`, `coverage_threshold`, `test_globs`) are all kept.

### Agent 3: `agents/qrspi-goals-reviewer.md` — Goals Checklist Reviewer

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-goals-reviewer.md` (66 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Reviews goals.md for clarity, fidelity, scope, testability, and traceability. Read-only. Returns PASS/FAIL with fix guidance for each check area."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
---
```

**System prompt body adaptations:**

1. **No conversion changes needed in the body** — the reviewer has no `task`, `question`, `cat`, `mkdir`, or `date` references. Its system prompt is entirely a review specification. Keep the input description (Requirements, Interview Record, Goals), the nine check areas (Intent clarity, FR completeness, NFR specificity, Constraint specificity, Scope boundaries, Acceptance testability, Single-run scope, Implicit assumptions, Inference integrity), all rules, and the output format verbatim.

2. The output format (lines ~44-66) is preserved exactly — the `### Status — PASS or FAIL`, `### Review Findings` table with 9 rows, `### Fix Guidance`, and `### Summary` sections.

### File Creation

All three files are placed in `agents/` at the project root. Create the `agents/` directory if it does not exist (`mkdir -p agents`). Each file is a new `.md` file following the exact frontmatter and system prompt body as specified above.

## Files
- `agents/qrspi-goals.md` (CREATE) — Stage 1 orchestrator agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 80`, `prompt_mode: replace`, `extensions: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-goals.md` with adaptations: `Invoke <agent>` → `qrspi_dispatch`, `question` → `qrspi_question`, `cat` → `Read`, `mkdir -p` → `bash: mkdir -p`, `date` → `bash: date`, removed permission system references.
- `agents/qrspi-goals-synthesizer.md` (CREATE) — Goal synthesizer leaf agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 40`, `prompt_mode: replace`, `extensions: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-goals-synthesizer.md`. No conversion changes needed — the body is a pure input→output specification with no opencode-specific tool references.
- `agents/qrspi-goals-reviewer.md` (CREATE) — Goals checklist reviewer agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-goals-reviewer.md`. No conversion changes needed — the body is a review specification with no opencode-specific tool references.

## Test Expectations
- **Valid YAML frontmatter on qrspi-goals.md:** When the file `agents/qrspi-goals.md` is parsed, the YAML frontmatter block (between the first `---` and the closing `---`) contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`. The `tools` field value is `read, bash, grep, find, ls, write, edit`. The `model` field is `anthropic/claude-sonnet-4-5`. The `max_turns` field is `80`.
- **Valid YAML frontmatter on qrspi-goals-synthesizer.md:** When the file `agents/qrspi-goals-synthesizer.md` is parsed, the YAML frontmatter block contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`. The `tools` field value includes `write` and `edit` (the synthesizer receives full tool access per the requirements agent-type table). The `model` field is `anthropic/claude-sonnet-4-5`. The `max_turns` field is `40`.
- **Valid YAML frontmatter on qrspi-goals-reviewer.md:** When the file `agents/qrspi-goals-reviewer.md` is parsed, the YAML frontmatter block contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`. The `tools` field value is `read, bash, grep, find, ls` (read-only, no write/edit). The `model` field is `anthropic/claude-haiku-4-5`. The `max_turns` field is `20`.
- **qrspi-goals system prompt uses qrspi_dispatch not task:** When the body of `agents/qrspi-goals.md` (after the closing `---`) is inspected, it contains the string `qrspi_dispatch` (not `task` as a tool reference for subagent dispatch), and the pattern `subagent_type: "qrspi-goals-synthesizer"` and `subagent_type: "qrspi-goals-reviewer"` appear for leaf agent dispatch instructions.
- **qrspi-goals system prompt uses qrspi_question not question:** When the body of `agents/qrspi-goals.md` is inspected, the human gate interaction references `qrspi_question` (not the opencode `question` tool).
- **qrspi-goals system prompt uses Read not cat:** When the body of `agents/qrspi-goals.md` is inspected, artifact reads reference `Read .pipeline/` (not `cat .pipeline/`).
- **qrspi-goals-synthesizer produces correct output format:** When the body of `agents/qrspi-goals-synthesizer.md` is inspected, it specifies the output sections `### goals.md` and `### config.md` with the exact section structure: Intent, Functional Requirements, Non-Functional Requirements, Technical Specification, Constraints, Non-Goals, and Acceptance Criteria for goals.md; and `created`, `route`, `run_id`, optional `coverage_threshold`, and optional `test_globs` for config.md.
- **qrspi-goals-synthesizer retains source authority rules:** When the body of `agents/qrspi-goals-synthesizer.md` is inspected, it states that `user-answer` and `user-confirmed-finding` entries are authoritative and that `repo-finding` entries must not appear in Functional Requirements, Constraints, or Acceptance Criteria.
- **qrspi-goals-reviewer produces correct review format:** When the body of `agents/qrspi-goals-reviewer.md` is inspected, it specifies the output sections `### Status — PASS or FAIL`, `### Review Findings` (table with 9 check areas: Intent clarity, FR completeness, NFR specificity, Constraint specificity, Scope boundaries, Acceptance testability, Single-run scope, Implicit assumptions, Inference integrity), `### Fix Guidance`, and `### Summary`.
- **qrspi-goals-reviewer inference integrity check is present:** When the body of `agents/qrspi-goals-reviewer.md` is inspected, the Inference integrity check specifies that Functional Requirements, Constraints, and Acceptance Criteria must trace to `user-answer` or `user-confirmed-finding`, not solely to `repo-finding`.
- **qrspi-goals retains the full pipeline protocol:** When the body of `agents/qrspi-goals.md` is inspected, it contains the interview loop (Steps A0 through A4), the synthesizer dispatch (Step B), the artifact writing (Step C), the checklist review loop with 5-round cap (Step D), the human gate with feedback loop (Step E), and the return contract with `### Status`, `### Files Written`, `### Route`, `### Summary`, and `### Telemetry` fields.
- **No opencode permission system references:** When the bodies of all three agent files are inspected, none contain opencode permission terminology (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `allowed-list`, `Rule 11`).
- **Haiku tier for reviewer, sonnet tier for orchestrator/synthesizer:** When the YAML frontmatter of the three files is inspected, `qrspi-goals-reviewer.md` specifies `model: anthropic/claude-haiku-4-5` (haiku tier), while `qrspi-goals.md` and `qrspi-goals-synthesizer.md` specify `model: anthropic/claude-sonnet-4-5` (sonnet tier).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
