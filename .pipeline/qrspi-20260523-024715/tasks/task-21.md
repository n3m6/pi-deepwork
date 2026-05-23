# Task 21: Stage 9–10 agent types (Verify and Report)

## Metadata
- **Task:** 21
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 4a — Verify + Report

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 9–10 agent types — all 10 stages produce their prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree following the file-based protocol convention. These four agent type files are the Stage 9 and Stage 10 subagent definitions that the orchestrator dispatches to execute verification and report generation.), AC 7 (model tier frontmatter — works with multiple model tiers: all four agents carry sonnet-tier models in their frontmatter, with the verifier additionally carrying `thinking: medium` to distinguish its higher reasoning requirement)
- **NFRs:** NFR: Compatibility (model tier — each agent type carries an explicit `model` field in its YAML frontmatter so pi-subagents resolves the correct model tier; the verifier agent has `thinking: medium` explicitly set to signal higher reasoning needs for comprehensive verification against all acceptance criteria)
- **Replan Gate Criteria:** Phase 4 replan gate (Verify + Report agents complete — all four Stage 9–10 agent type `.md` files are converted from opencode sources with correct YAML frontmatter per the conversion tables, each structurally valid with parseable frontmatter and system prompt body present, dispatch contracts preserved, auto-fix fallback logic intact)

## Source Traceability
- **Goals:** AC 6, AC 7
- **Plan:** Task 21, Phase 4 — Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix)
- **Design:** Slice 4a — Verify + Report (Stage 9 orchestrator dispatches `qrspi-verifier` to run full build/lint/test suite with baseline comparison; on FAIL, re-dispatches `qrspi-implement` in verify-fix mode; second FAIL invokes backward-loop protocol. Stage 10 orchestrator dispatches `qrspi-reporter`, gathers all stage summaries and phase metadata, produces final pipeline report. Generates `metrics-summary.md`.)
- **Structure:** Slice 4a — Verify & Report Stages (Stages 9–10); files: `agents/qrspi-verify.md`, `agents/qrspi-verifier.md`, `agents/qrspi-report.md`, `agents/qrspi-reporter.md`

## Description

Create four pi agent type `.md` files for the Stage 9 (Verify) and Stage 10 (Report) pipeline stages. Each file is ported from its opencode equivalent using the documented conversion tables from the requirements. Every agent type follows the pi YAML frontmatter convention with required fields: `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`. The system prompt body (everything after the `---` closing delimiter) is adapted from the opencode source by replacing opencode-specific patterns with pi equivalents.

### Conversion Rules Applied

Apply these substitutions to every opencode pattern found in the system prompt body of all four agent files:

| OpenCode pattern | pi equivalent |
|---|---|
| `Invoke <agent> as a subagent:` | `Use the qrspi_dispatch tool with subagent_type: "<agent>":` |
| `Invoke @build` | `Use the qrspi_dispatch tool with subagent_type: "build":` |
| `dispatch <agent> as a subagent` | `dispatch <agent> via qrspi_dispatch` |
| `cat .pipeline/<path>` | `Read .pipeline/<path>` |
| `cat` (any file read) | `Read` (the appropriate file path) |
| `ls .pipeline/...` (directory listing) | `bash: ls .pipeline/...` |
| `@build` (build agent reference) | `qrspi_dispatch` with `subagent_type: "build"` |

Additionally:
- Remove all `todowrite` references. pi has its own task tracking.
- Remove opencode permission system language (permission lists, `allowed-list`, Rule 11, etc.). In pi, permissions are approximated via `tools` and `disallowed_tools` frontmatter fields.
- Keep all pipeline protocol content verbatim: `=== RUN ID ===` headers, `=== GOALS ===`, `=== REQUIREMENTS ===`, `=== BASELINE RESULTS ===`, and all other `===`-delimited input block headers that the main orchestrator constructs for dispatch. Keep `### Status — PASS/PARTIAL/FAIL` return format, `### Files Written`, `### Summary`, `### Telemetry` sections, `### Report Content` block for Stage 10, and all artifact paths.
- Keep all stage logic intact: auto-fix fallback protocol (Stage 9), verify-fix mode re-dispatch logic, verification pass steps (check reuse decision, build/lint/test/E2E execution, baseline comparison, requirement/acceptance evaluation), reporter formatting rules, and return contracts.

### Agent 1: `agents/qrspi-verify.md` — Stage 9 Verify Orchestrator

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-verify.md` (83 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Stage 9 orchestrator — dispatches verifier to run full build/lint/test suite with baseline comparison. Writes stage9-summary.md."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 80
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations beyond the conversion table:**

1. **Core identity line (line ~20):** Replace `Invoke qrspi-verifier as a subagent — end your turn immediately after dispatch` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-verifier" — end your turn immediately after dispatch.`. Keep the constraint "Do not write project code; write only `.pipeline/<run-id>/stage9-summary.md`." intact.

2. **Step A — Read Artifacts (lines ~27-34):** Replace `Read:` followed by paths with references to pi's `Read` tool. Replace `ls .pipeline/<run-id>/phases/phase-*/` with `bash: ls .pipeline/<run-id>/phases/phase-*/` to discover phase directories. All artifact paths (`.pipeline/<run-id>/goals.md`, `.pipeline/<run-id>/requirements.md`, `.pipeline/<run-id>/baseline-results.md`, per-phase `execution-manifest.md`, `acceptance-results.md`, `stage7-summary.md`, `regression-results.md`) are preserved exactly.

3. **Step B — Invoke Verifier (lines ~37-61):** Replace `Invoke qrspi-verifier with:` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-verifier":`. Keep the entire input block structure verbatim — all `===` delimited sections (`=== GOALS ===`, `=== REQUIREMENTS ===`, `=== EXECUTION MANIFESTS ===`, `=== STAGE 7 SUMMARIES ===`, `=== PHASE REGRESSION RESULTS ===`, `=== ACCEPTANCE RESULTS (ALL PHASES) ===`, `=== BASELINE RESULTS ===`) and the per-phase header convention (`## Phase N` prepended to each pasted artifact) are preserved exactly.

4. **Step C — Write Results (lines ~63-65):** Keep verbatim. Replace any `cat`-style write instruction with a reference to the `write` tool or `bash` for writing. The first-line constraint ("The first line of the file MUST be `### Status — PASS`, `### Status — PARTIAL`, or `### Status — FAIL`, mirroring the verifier's Overall Status") is preserved — this is critical for the resume protocol.

5. **Return contract (lines ~67-83):** Keep unchanged — the structured return format with `### Status`, `### Files Written`, `### Summary`, and `### Telemetry` sections. The unrecoverable-failure variant is also preserved.

6. **Remove:** The opencode permission block (lines 7-17: `permission:` with `edit`, `bash`, `task`, `webfetch`, `todowrite`, `question` fields) — replaced by the pi frontmatter fields. The `question: deny` restriction is implicit in pi (this agent does not call `qrspi_question`).

### Agent 2: `agents/qrspi-verifier.md` — Final Verification Agent

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-verifier.md` (149 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Verifies implementation completeness against acceptance results, preserved requirements, and the recorded baseline. Runs the full configured build, lint, typecheck, E2E, and test suite, distinguishes known baseline failures from new regressions, and reports failures without modifying project source."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 80
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations beyond the conversion table:**

1. **Core identity and rules (lines ~20-29):** Keep the identity statement ("You are the QRSPI Verifier.") and all five rules intact. The rule "Do not write code or modify tests. Do not delegate fixes to `@build`." becomes "Do not write code or modify tests. Do not delegate fixes via `qrspi_dispatch`." The rule "After each subagent dispatch, stop and wait for the response before continuing." stays — it applies equally to `qrspi_dispatch` in foreground mode. The rule "Run one full verification pass. Report failures with enough evidence for Stage 7 fix/review routing; do not attempt repair in Stage 9." is preserved verbatim.

2. **Step 0 — Reuse decision (lines ~42-57):**
   - Replace any `bash` git commands with `bash:` references appropriate for pi (`git log -1 --format='%H' --grep='^qrspi: phase'` and `git log --oneline <hash>..HEAD -- ':!*.test.*' ':!*.spec.*' ':!**/test/**' ':!**/tests/**' ':!**/__tests__/**'`) — keep the exact git commands since they run via pi's `bash` tool.
   - The `@build` references in the reuse description ("Run **only** the acceptance test full re-run plus a smoke sub-suite of `### E2E` via `@build`") become "Run **only** the acceptance test full re-run plus a smoke sub-suite of `### E2E` via `qrspi_dispatch` with `subagent_type: "build"`".
   - Keep the reuse criteria (1, 2, 3) and the reuse procedure (annotated statuses with `Verified at Stage 7` message, skip Step 1 logic) verbatim.

3. **Step 1 — Run checks (lines ~60-80):**
   - Replace `Invoke @build:` with `Use the qrspi_dispatch tool with subagent_type: "build":`.
   - Keep the entire instruction block (`=== INSTRUCTIONS ===` with the five-check suite description: Build, Lint, Typecheck, E2E, Test) and the expected return format (`### Build — PASS / FAIL / SKIPPED / NOT CONFIGURED`, etc.) verbatim.
   - The instruction to "Report PASS, FAIL, SKIPPED (with reason), or NOT CONFIGURED (no standard command defined). Include failure output." is preserved.

4. **Step 2 — Baseline comparison (lines ~82-91):** Keep verbatim. The four classification labels (Unchanged baseline failure, New regression, Improved, non-failing carry-forward) and the per-regression cross-reference procedure (`=== EXECUTION MANIFESTS ===` → Phase Introduced, Last Modified Phase, Likely Owner with `unknown` fallback) are preserved exactly. No opencode-specific tool references exist in this section.

5. **Step 3 — Requirements and acceptance (lines ~93-103):** Keep verbatim. The four requirement classifications (`SATISFIED`, `FAILED`, `UNVERIFIED`, `OUT_OF_SCOPE`) and acceptance criterion marking (✅/❌) are preserved exactly.

6. **Step 4 — Evaluate (lines ~105-108):** Keep verbatim. The PASS criteria and FAIL-trigger conditions are preserved.

7. **Status Rules (lines ~110-114):** Keep verbatim. The three-way status (`PASS`, `PARTIAL`, `FAIL`) with precise definitions is critical for the pipeline's auto-fix and backward-loop routing.

8. **Output format (lines ~116-149):** Keep all six output sections verbatim:
   - `### Check Results` (table: Check, Status, Likely Owner, Details)
   - `### Baseline Comparison` (table: Check, Baseline Status, Current Status, Regression Status, Phase Introduced, Last Modified Phase)
   - `### Requirement Checks` (table: Requirement, Evidence, Status, Notes)
   - `### Acceptance Criteria Status` (table: Phase, #, Criterion, Status, Failure Reason)
   - `### Code Health Summary` (table: Phase, Tasks, Deterministic, Flaky, Harness Noisy, Ambiguous, Redundant, No-Test Tasks, No-Test Audit Overrides, Simplifier Applied, Simplifier Reverted, Outstanding Concerns) with the three plain-text lines (Plan/Replan terminal review state, Coverage, Notes)
   - `### Verification Iterations` (`1/1` with one-line description)
   - `### Overall Status — PASS / PARTIAL / FAIL`
   - `### Stage Summary` (one-line digest)

9. **Remove:** The opencode permission block (lines 7-17: `permission:` with `edit`, `bash`, `task`, `webfetch`, `todowrite` fields) — replaced by pi frontmatter. The `todowrite: allow` permission is removed entirely. All `todowrite` references in the body (none found in this source — the source does not use `todowrite` as a tool) are already absent, so no body-level removals are needed.

### Agent 3: `agents/qrspi-report.md` — Stage 10 Report Orchestrator

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-report.md` (109 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Stage 10 orchestrator — reads all stage summaries, phase metadata, and replan notes and dispatches the reporter to produce the final pipeline report. Writes stage10-summary.md."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 30
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations beyond the conversion table:**

1. **Core identity and constraints (lines ~20-24):** Keep the identity statement ("You are the QRSPI Stage 10 Report orchestrator.") and the two constraints. Replace "Invoke `qrspi-reporter` directly as a subagent. After dispatch, stop and wait for its response." with "Dispatch `qrspi-reporter` directly via `qrspi_dispatch`. After dispatch, stop and wait for its response." Replace any `cat`-based read instructions in the constraints with `Read` tool references.

2. **Input section (lines ~26-28):** Keep verbatim. The `=== RUN ID ===` dispatch header convention and path construction rule (`.pipeline/<run-id>/`) are preserved.

3. **Step A — Read Inputs (lines ~30-43):**
   - Replace `read with cat:` with `read with the Read tool:`.
   - Replace `cat` (the tool instruction) with `Read` for each artifact path.
   - **Required artifacts:** `config.md`, `goals.md`, `baseline-results.md`, `stage9-summary.md` — paths preserved verbatim.
   - **Optional artifacts:** `phase-manifest.md` (fallback `N/A`), `phases/phase-*/replan/phase-*-replan.md` per phase (fallback `None.`) — paths and fallbacks preserved verbatim.
   - **Per phase:** Replace `list directories with ls .pipeline/<run-id>/phases/phase-*/` with `list directories with bash: ls .pipeline/<run-id>/phases/phase-*/`. For each `phase-NN` read: `stage7-summary.md`, `stage7-integration-summary.md`, `stage8-summary.md`, `acceptance-results.md` — paths preserved verbatim.

4. **Step B — Dispatch Reporter (lines ~44-85):**
   - Replace `Invoke qrspi-reporter as a subagent. Fill each placeholder with the verbatim artifact content read in Step A. Repeat per-phase blocks for every discovered phase.` with `Use the qrspi_dispatch tool with subagent_type: "qrspi-reporter":. Fill each placeholder with the verbatim artifact content read in Step A. Repeat per-phase blocks for every discovered phase.`
   - Keep the entire dispatch prompt template verbatim — all `===` delimited sections (`=== PIPELINE CONFIG ===`, `=== GOALS ===`, `=== PHASE MANIFEST ===`, `=== BASELINE RESULTS ===`, `=== ACCEPTANCE RESULTS (ALL PHASES) ===`, `=== STAGE SUMMARIES ===`, `=== REPLAN NOTES ===`) and the per-phase header convention (`## Phase NN`) with the Stage 7, Stage 7 Integration Gate, Stage 8, Stage 9, and replan note placeholders.

5. **Step C — Write Report (lines ~87-89):** Keep verbatim. Replace any write instructions with appropriate pi tool references (the `write` tool or `bash`).

6. **Return contract (lines ~91-109):**
   - Keep the PASS return format with `### Status — PASS`, `### Files Written — stage10-summary.md`, `### Report Content` (reporter output verbatim), `### Summary`, and `### Telemetry — {}` verbatim.
   - Keep the FAIL return format with `### Status — FAIL`, `### Files Written`, `### Summary`, and `### Telemetry — {}` verbatim.

7. **Remove:** The opencode permission block (lines 7-17: `permission:` with `edit`, `bash`, `task`, `webfetch`, `todowrite`, `question` fields) — replaced by pi frontmatter.

### Agent 4: `agents/qrspi-reporter.md` — Final Report Formatter

**Source:** `/home/n3m6/.config/opencode/agents/qrspi-reporter.md` (92 lines)

**Pi frontmatter (exact):**

```yaml
---
description: "Formats the Final Report from supplied pipeline artifacts only. Never writes code or modifies files."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
enabled: false
---
```

**System prompt body adaptations beyond the conversion table:**

1. **Core identity (line ~16):** Keep verbatim: "Format only supplied artifacts into the Final Report. Do not run tools, modify files, or invent missing facts. If required data is absent, write `Unknown` or `N/A`."

2. **Inputs section (lines ~18-27):** Keep verbatim. The input list (`config.md`, `goals.md`, `baseline-results.md`, per-phase `acceptance-results.md`, per-phase Stage 7 implementation summary, Stage 7 integration summary, Stage 8 summary, replan note, Stage 9 verification summary) is preserved exactly.

3. **Output format (lines ~29-81):** Keep the entire output template verbatim:
   - `## QRSPI Pipeline Complete` header
   - `### Pipeline Info` (Route, Run ID, Date from config)
   - `### Goals Summary` (2–3 sentence summary from goals.md)
   - `### Baseline Summary` (verbatim or one-line status)
   - `### Per-Phase Results` with per-phase block: Implementation, Integration, Acceptance, Replan
   - `### Verification Result` (Stage 9 summary verbatim)
   - `### Build / Lint / Test Status` (table: Check, Status with pass/fail/unknown)
   - `### Acceptance Criteria` (table: Phase, #, Criterion, Status)
   - `### Overall Status: [PASS / PARTIAL / FAIL]`
   - `### Audit Trail` (`.pipeline/qrspi-<run-id>/`)
   - `### Unresolved Items` (failed acceptance criteria and Stage 9 PARTIAL/FAIL checks)

4. **Rules section (lines ~83-92):** Keep all seven rules verbatim — no opencode-specific tool references exist:
   - "Copy all stage summaries verbatim; never reinterpret or summarize them."
   - "If baseline failures exist, include them in Baseline Summary or Unresolved Items as appropriate."
   - "Overall Status must come from the Stage 9 summary."
   - "Build/Lint/Test statuses must come from explicit artifact evidence only; use `unknown` when absent."
   - "Acceptance Criteria table rows come from acceptance-results.md files only; include phase, number, criterion text, and status."
   - "Failed acceptance criteria must appear in Unresolved Items."
   - "Explicitly named Stage 9 PARTIAL/FAIL checks must appear in Unresolved Items."
   - "The Audit Trail path must use the run_id from config.md."

5. **No conversions needed** — the reporter's system prompt body has zero opencode-specific tool references. It contains no `cat`, no `Invoke`, no `@build`, no `todowrite`, no `question`, no `mkdir`, no `date` references. It is a pure formatting specification. The entire body (lines 16-92 after the frontmatter) transfers verbatim.

6. **Remove:** The opencode permission block (lines 7-14: `permission:` with `edit`, `bash`, `task`, `webfetch` fields) — replaced by pi frontmatter.

### File Creation

All four files are placed in `agents/` at the project root. Create the `agents/` directory if it does not exist (`bash: mkdir -p agents`). Each file is a new `.md` file following the exact frontmatter and system prompt body as specified above.

## Files
- `agents/qrspi-verify.md` (CREATE) — Stage 9 Verify orchestrator agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 80`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-verify.md` with adaptations: `Invoke qrspi-verifier` → `qrspi_dispatch` with `subagent_type: "qrspi-verifier"`, `cat` → `Read`, `ls .pipeline/...` → `bash: ls .pipeline/...`, removed permission system references. Preserves the three-step process (Read Artifacts → Invoke Verifier with structured input blocks → Write stage9-summary.md) and the return contract with `### Status — PASS/PARTIAL/FAIL`, `### Files Written`, `### Summary`, and `### Telemetry`.

- `agents/qrspi-verifier.md` (CREATE) — Final verification agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: medium`, `max_turns: 80`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-verifier.md` with adaptations: `Invoke @build` → `qrspi_dispatch` with `subagent_type: "build"`, `@build` → `qrspi_dispatch` with `subagent_type: "build"`, removed `todowrite` references and permission system block. Preserves the full verification pass (Step 0 — reuse decision for incremental regression results, Step 1 — run Build/Lint/Typecheck/E2E/Test via build subagent, Step 2 — baseline comparison with regression classification, Step 3 — requirement/acceptance evaluation, Step 4 — final evaluation), the three-way Status Rules (PASS/PARTIAL/FAIL), and the comprehensive output format with Check Results, Baseline Comparison, Requirement Checks, Acceptance Criteria Status, Code Health Summary, Verification Iterations, Overall Status, and Stage Summary.

- `agents/qrspi-report.md` (CREATE) — Stage 10 Report orchestrator agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 30`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-report.md` with adaptations: `Invoke qrspi-reporter` → `qrspi_dispatch` with `subagent_type: "qrspi-reporter"`, `cat` → `Read`, `ls .pipeline/...` → `bash: ls .pipeline/...`, removed permission system references. Preserves the three-step process (Read Inputs — required and optional artifacts with per-phase discovery → Dispatch Reporter with structured input blocks → Write stage10-summary.md) and the return contract with `### Status — PASS/FAIL`, `### Files Written`, `### Report Content`, `### Summary`, and `### Telemetry`.

- `agents/qrspi-reporter.md` (CREATE) — Final report formatter agent type. YAML frontmatter: `description`, `tools: read, bash, grep, find, ls, write, edit`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`, `enabled: false`. System prompt body ported from opencode source at `/home/n3m6/.config/opencode/agents/qrspi-reporter.md` with no conversion changes needed — the body is a pure formatting specification with zero opencode-specific tool references. Preserves the output template (`## QRSPI Pipeline Complete` with Pipeline Info, Goals Summary, Baseline Summary, Per-Phase Results, Verification Result, Build/Lint/Test Status table, Acceptance Criteria table, Overall Status, Audit Trail, and Unresolved Items) and all seven formatting rules.

## Test Expectations
- **Valid YAML frontmatter on qrspi-verify.md:** When the file `agents/qrspi-verify.md` is parsed, the YAML frontmatter block (between the first `---` and the closing `---`) contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`, and `enabled`. The `tools` field value is `read, bash, grep, find, ls, write, edit`. The `model` field is `anthropic/claude-sonnet-4-5`. The `thinking` field is `low`. The `max_turns` field is `80`.

- **Valid YAML frontmatter on qrspi-verifier.md:** When the file `agents/qrspi-verifier.md` is parsed, the YAML frontmatter block contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`, and `enabled`. The `tools` field value is `read, bash, grep, find, ls, write, edit`. The `model` field is `anthropic/claude-sonnet-4-5`. The `thinking` field is `medium`. The `max_turns` field is `80`.

- **Valid YAML frontmatter on qrspi-report.md:** When the file `agents/qrspi-report.md` is parsed, the YAML frontmatter block contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`, and `enabled`. The `tools` field value is `read, bash, grep, find, ls, write, edit`. The `model` field is `anthropic/claude-sonnet-4-5`. The `thinking` field is `low`. The `max_turns` field is `30`.

- **Valid YAML frontmatter on qrspi-reporter.md:** When the file `agents/qrspi-reporter.md` is parsed, the YAML frontmatter block contains exactly the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`, and `enabled`. The `tools` field value is `read, bash, grep, find, ls, write, edit`. The `model` field is `anthropic/claude-sonnet-4-5`. The `thinking` field is `low`. The `max_turns` field is `20`.

- **qrspi-verify system prompt uses qrspi_dispatch not Invoke:** When the body of `agents/qrspi-verify.md` (after the closing `---`) is inspected, it contains the string `qrspi_dispatch` (not `Invoke` as a subagent dispatch verb) and the pattern `subagent_type: "qrspi-verifier"` appears for the verifier dispatch instruction.

- **qrspi-verify system prompt uses Read not cat:** When the body of `agents/qrspi-verify.md` is inspected, artifact reads reference `Read .pipeline/` (not `cat .pipeline/`).

- **qrspi-verify preserves the return contract:** When the body of `agents/qrspi-verify.md` is inspected, it contains `### Status — PASS` or `### Status — FAIL` return formats with `### Files Written`, `### Summary`, and `### Telemetry` sections, and the first-line-of-stage9-summary.md constraint requiring `### Status — PASS`, `### Status — PARTIAL`, or `### Status — FAIL`.

- **qrspi-verify preserves input block structure:** When the body of `agents/qrspi-verify.md` is inspected, the dispatch prompt for the verifier includes all six `===`-delimited input blocks: `=== GOALS ===`, `=== REQUIREMENTS ===`, `=== EXECUTION MANIFESTS ===`, `=== STAGE 7 SUMMARIES ===`, `=== PHASE REGRESSION RESULTS ===`, `=== ACCEPTANCE RESULTS (ALL PHASES) ===`, and `=== BASELINE RESULTS ===`.

- **qrspi-verifier system prompt uses qrspi_dispatch not @build:** When the body of `agents/qrspi-verifier.md` is inspected, the build agent dispatch references use `qrspi_dispatch` with `subagent_type: "build"` (not `Invoke @build` or `@build` as a bare agent reference).

- **qrspi-verifier preserves the verification pass steps:** When the body of `agents/qrspi-verifier.md` is inspected, it contains the complete verification pass: Step 0 (reuse decision with three criteria and git-based change detection), Step 1 (run checks with Build/Lint/Typecheck/E2E/Test instruction block and return format), Step 2 (baseline comparison with four regression classifications and per-regression ownership cross-reference), Step 3 (requirements and acceptance evaluation with SATISFIED/FAILED/UNVERIFIED/OUT_OF_SCOPE and ✅/❌), and Step 4 (final evaluation with PASS criteria).

- **qrspi-verifier preserves three-way Status Rules:** When the body of `agents/qrspi-verifier.md` is inspected, it contains the `### Status Rules` section with precise definitions for PASS (all checks pass, all acceptance pass, all requirements SATISFIED, no new regressions), PARTIAL (no new regressions, acceptance pass, requirements SATISFIED, only unchanged baseline failures persist), and FAIL (any new regression, any non-baseline-failure check fail, any acceptance criterion fail, any in-scope requirement FAILED or UNVERIFIED).

- **qrspi-verifier preserves the output format:** When the body of `agents/qrspi-verifier.md` is inspected, it contains all six output sections: `### Check Results` (table with Check/Status/Likely Owner/Details), `### Baseline Comparison` (table with regression classifications and phase attribution), `### Requirement Checks` (table with SATISFIED/FAILED/UNVERIFIED/OUT_OF_SCOPE), `### Acceptance Criteria Status` (table with ✅/❌ and Failure Reason), `### Code Health Summary` (table with evidence classification counts and simplifier columns), and `### Verification Iterations` / `### Overall Status` / `### Stage Summary` sections.

- **qrspi-verifier retains "Do not write code" constraint:** When the body of `agents/qrspi-verifier.md` is inspected, Rule 1 states that the verifier must not write code or modify tests, and must not delegate fixes via subagent dispatch. This constraint is preserved even though the frontmatter grants full write/edit tools.

- **qrspi-report system prompt uses qrspi_dispatch:** When the body of `agents/qrspi-report.md` is inspected, it contains the string `qrspi_dispatch` and the pattern `subagent_type: "qrspi-reporter"` for the reporter dispatch instruction.

- **qrspi-report preserves the dispatch prompt template:** When the body of `agents/qrspi-report.md` is inspected, the dispatch prompt for the reporter includes all seven `===`-delimited input blocks: `=== PIPELINE CONFIG ===`, `=== GOALS ===`, `=== PHASE MANIFEST ===`, `=== BASELINE RESULTS ===`, `=== ACCEPTANCE RESULTS (ALL PHASES) ===`, `=== STAGE SUMMARIES ===`, and `=== REPLAN NOTES ===`, with the per-phase `## Phase NN` header convention.

- **qrspi-report preserves the Report Content return:** When the body of `agents/qrspi-report.md` is inspected, the return contract includes `### Report Content` section containing the reporter output verbatim, and the `### Telemetry — {}` empty telemetry block.

- **qrspi-reporter preserves the full output template:** When the body of `agents/qrspi-reporter.md` is inspected, it contains the complete output template: `## QRSPI Pipeline Complete` with `### Pipeline Info` (Route, Run ID, Date), `### Goals Summary`, `### Baseline Summary`, `### Per-Phase Results` (Implementation, Integration, Acceptance, Replan per phase), `### Verification Result`, `### Build / Lint / Test Status` table, `### Acceptance Criteria` table, `### Overall Status`, `### Audit Trail`, and `### Unresolved Items`.

- **qrspi-reporter preserves all formatting rules:** When the body of `agents/qrspi-reporter.md` is inspected, all seven rules are present: verbatim stage summaries, baseline failures in appropriate sections, Overall Status from Stage 9 summary, Build/Lint/Test from explicit evidence only (use `unknown` when absent), Acceptance Criteria from acceptance-results.md only, failed criteria and PARTIAL/FAIL checks in Unresolved Items, and Audit Trail path from config.md run_id.

- **No opencode permission system references:** When the bodies of all four agent files are inspected, none contain opencode permission terminology (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.todowrite`, `permission.question`, `allowed-list`, `Rule 11`).

- **No todowrite references:** When the bodies of all four agent files are inspected, none contain `todowrite` as a tool reference.

- **Model tier and thinking assignments:** When the YAML frontmatter of the four files is inspected, `qrspi-verify.md` specifies `model: anthropic/claude-sonnet-4-5` with `thinking: low` (sonnet-tier orchestrator), `qrspi-verifier.md` specifies `model: anthropic/claude-sonnet-4-5` with `thinking: medium` (sonnet-tier with elevated reasoning for comprehensive verification), `qrspi-report.md` specifies `model: anthropic/claude-sonnet-4-5` with `thinking: low` (sonnet-tier orchestrator), and `qrspi-reporter.md` specifies `model: anthropic/claude-sonnet-4-5` with `thinking: low` (sonnet-tier writer).

- **All four files specify enabled: false:** When the YAML frontmatter of all four files is inspected, each contains `enabled: false` to match the `hidden: true` convention from opencode — these agents are spawnable by the orchestrator but not listed for direct user invocation.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
