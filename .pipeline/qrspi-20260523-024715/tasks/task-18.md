# Task 18: Code review coverage, goal, and simplifier lenses

## Metadata
- **Task:** 18
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3c — Code Review

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (review lens agent types), AC 7 (model tier frontmatter)
- **NFRs:** NFR: Compatibility (model tier — all four lenses must use haiku-tier model)
- **Replan Gate Criteria:** Phase 3 replan gate (All review lenses complete)

## Source Traceability
- **Goals:** AC 6 (all 10 stages produce prescribed artifacts — these four review lens agent types contribute to Stage 7 implementation artifacts), AC 7 (extension works with multiple model tiers — all four use `anthropic/claude-haiku-4-5` haiku-tier)
- **Plan:** Task 18, Phase 3 — Implementation Loop (Stages 7–8.5)
- **Design:** Slice 3c — Code Review System
- **Structure:** Slice 3c — Code Review System: `agents/qrspi-review-test-coverage.md`, `agents/qrspi-review-test-quality.md`, `agents/qrspi-review-code-simplifier.md`, `agents/qrspi-review-goal-traceability.md`

## Description

Convert the remaining four read-only code review lens agent types from their opencode source equivalents into pi-compatible `.md` files with YAML frontmatter. These agents are dispatched by the `qrspi-code-review` orchestrator in parallel after implementation code is written during Stage 7. Each lens assesses a specific quality concern against the changed files and task artifacts, returning a structured `### Status — PASS/FAIL` block with a `### Findings` table.

All four agents are **read-only** — they inspect files but never modify source code. They use the haiku-tier model (`anthropic/claude-haiku-4-5`) because their analysis is purely inspection work that does not require the stronger reasoning of sonnet-tier models.

### Files to Create

#### 1. `agents/qrspi-review-test-coverage.md` — Test Coverage Review Lens

**Frontmatter:**
- `description`: `"Read-only per-task test coverage reviewer. Flags behavioral gaps, weak tests, and non-behavioral tests; returns action-oriented PASS/FAIL findings."`
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `20`
- `prompt_mode`: `replace`
- `extensions`: `false`

**System prompt body:** Adapted from the opencode source (`/home/n3m6/.config/opencode/agents/qrspi-review-test-coverage.md`, 57 lines). Preserve verbatim:

- **Review Rules** (5 rules):
  1. **Coverage** — every observable test expectation in the task spec maps to at least one test. Flag missing required behaviors, explicit edge cases, and applicable failure paths stated in the spec or evident from the public interface. Do not flag uncovered lines or branches alone.
  2. **Test quality** — flag tests that pass for non-behavioral reasons: tautological mock assertions, over-mocking internal collaborators instead of real process boundaries, implementation-mirror tests, private-surface tests, coverage-padding tests, type-only tests (severity: HIGH).
  3. **Test isolation** — flag order dependence, leaked shared state, uncleaned global mutation, or brittle timing assumptions.
  4. **Non-behavioral tasks** — if the task is type-only, declaration-only, config-only, docs-only, or scaffolding-only and has no observable-behavior test expectation, flag task-authored tests that add no observable-behavior coverage. Do not flag their absence. Severity: HIGH.
  5. **Ambiguity** — if fixing a coverage gap would require inventing requirements not in the task spec, use `BACKWARD_LOOP` instead of guessing.

- **Severity levels:** `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` — with definitions matching the source.

- **Recommendation labels:** `DELETE`, `REWRITE`, `ADD`, `BACKWARD_LOOP` — one per finding.

- **Output format:**
  ```
  ### Status — PASS or FAIL
  ### Findings
  | # | Severity | File | Lines | Category | Issue | Recommendation |
  ```
  Return `PASS` when there are no `CRITICAL` or `HIGH` findings. Write `None.` under `### Findings` when there are none.

**Adaptation note:** Remove the opencode permission block (`mode: subagent`, `hidden: true`, `temperature: 0.1`, `steps: 25`, `permission`) and replace with pi frontmatter fields above. The system prompt body requires no further conversion — it contains no references to `task`, `question`, `todowrite`, or opencode-specific tool names.

#### 2. `agents/qrspi-review-test-quality.md` — Test Quality Review Lens

**Frontmatter:**
- `description`: `"Pre-GREEN RED_REVIEW gate subagent: reviews RED-phase test quality against task spec Test Expectations."`
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `20`
- `prompt_mode`: `replace`
- `extensions`: `false`

**System prompt body:** Adapted from the opencode source (`/home/n3m6/.config/opencode/agents/qrspi-review-test-quality.md`, 100 lines). Preserve verbatim:

- **Opening statement** establishing the agent's role reviewing RED-phase test files for meaningful assertions and structural anti-patterns. **Adaptation:** The original opencode source says "do not read or write files, run commands, or dispatch agents" and expects all inputs verbatim from the gate orchestrator. In pi, the agent has `read, bash, grep, find, ls` tools and CAN read pipeline artifacts directly. Remove the "do not read or write files, run commands" restriction — replace it with guidance that the agent may use its read tools to inspect files and artifacts from the pipeline directory, but must never write or edit files.

- **Rules** (4 rules):
  1. **SPEC IS THE REFERENCE** — no production code exists yet; judge solely against the task spec's `## Test Expectations`.
  2. **FAIL on CRITICAL or HIGH only** — MEDIUM and LOW are reported but do not affect status.
  3. **One finding per root cause.**
  4. **Evidence boundary** — flag only issues directly visible in provided inputs (Task Spec, Behavior Mapping, File Contents).

- **Checklist** (11 items, each with severity label): Trivial/Zero-Assertion (CRITICAL), Weak Assertions (HIGH), Tautological Mocking (HIGH), Over-Mocking Internal Collaborators (HIGH), Implementation-Mirror Tests (HIGH), Private-Surface Tests (HIGH), Happy-Path-Only Coverage (HIGH), Behavior/Spec Mismatch (CRITICAL), Unrelated Harness Failures (CRITICAL), Type/Compile-Time Tests (HIGH), Missing Spec Behaviors (CRITICAL/HIGH).

- **Recommendation labels:** `DELETE`, `REWRITE`, `ADD`, `BACKWARD_LOOP`.

- **Output format:**
  ```
  ### Status — PASS or FAIL
  ### Findings
  | # | Severity | File | Lines | Category | Issue | Recommendation |
  ```
  `PASS` = no CRITICAL or HIGH findings. Write `None.` under `### Findings` when there are no findings.

**Adaptation note:** In addition to the frontmatter conversion, modify the opening sentence to reflect pi tool availability. The opencode source line "all inputs arrive verbatim from the gate orchestrator; do not read or write files, run commands, or dispatch agents" must be changed to remove the prohibition on reading files and running commands — the agent in pi has `read, bash, grep, find, ls` tools. Replace with: "You are read-only — use read, grep, find, ls, and bash (for read-only commands only) to inspect pipeline artifacts. Never write or edit files."

#### 3. `agents/qrspi-review-code-simplifier.md` — Code Simplification Review Lens

**Frontmatter:**
- `description`: `"Per-task code simplifier — suggests semantics-preserving opportunities to reduce unnecessary complexity in QRSPI task changes."`
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `20`
- `prompt_mode`: `replace`
- `extensions`: `false`

**System prompt body:** Adapted from the opencode source (`/home/n3m6/.config/opencode/agents/qrspi-review-code-simplifier.md`, 42 lines). Preserve verbatim:

- **Opening statement:** Review only provided changed-file contents for concrete, semantics-preserving simplifications. Omit speculative or style-only suggestions. **Always return `PASS`** — findings are advisory, never cause a FAIL.

- **Checklist** (5 items):
  1. **Unnecessary Complexity** — single-caller abstractions, pass-through wrappers, over-parameterized helpers.
  2. **Dead Code** — obviously unused imports/locals, unreachable branches, write-only vars, commented-out code; do not mark exported/public symbols dead without usage evidence.
  3. **Verbose Patterns** — redundant temps/booleans/null checks.
  4. **Premature Abstraction** — hypothetical utilities/extension points.
  5. **Inconsistency** — mixed patterns for the same operation in changed files.

- **Severity levels:**
  - `HIGH` — unambiguous dead code (unused imports, unreachable branches, write-only locals) or single-caller pass-through wrappers. Mechanical to delete; semantics-preserving with high confidence.
  - `MEDIUM` — redundant temps/booleans/null checks or pattern inconsistency. Semantics-preserving but requires care.
  - `LOW` — minor verbose patterns, naming, or readability nits.
  - `💡` — speculative or stylistic suggestion; not actionable without further evidence.
  - HIGH and MEDIUM findings are the only ones the verifier will act on. LOW and 💡 remain advisory.

- **Output format:**
  ```
  ### Status — PASS
  ### Findings
  | # | Severity | File | Lines | Category | Issue | Recommendation |
  ```
  No findings: `None.` under `### Findings`. Never return `FAIL`.

**Adaptation note:** Remove the opencode permission block and replace with pi frontmatter. The system prompt body requires no further conversion — it contains no references to opencode-specific tool names. The `💡` emoji in the severity enum is preserved (it is used as a severity label in the output table, not as decorative text).

#### 4. `agents/qrspi-review-goal-traceability.md` — Goal Traceability Review Lens

**Frontmatter:**
- `description`: `"Checks full-route QRSPI traceability: goals ↔ expectations ↔ tests ↔ code."`
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `15`
- `prompt_mode`: `replace`
- `extensions`: `false`

**System prompt body:** Adapted from the opencode source (`/home/n3m6/.config/opencode/agents/qrspi-review-goal-traceability.md`, 41 lines). Preserve verbatim:

- **Opening statement:** The agent is the QRSPI Goal Traceability Reviewer. Read-only. Review only the provided changed files and provided task/goals/context.

- **Checklist** (4 items):
  1. **Forward Trace** — each acceptance criterion relevant to this task maps to a test and then to implementation.
  2. **Backward Trace** — each material changed behavior traces back to a task expectation and goal; flag unsupported extras.
  3. **Gaps** — acceptance criteria relevant to this task that are missing from the implementation.
  4. **Spec-Test Fidelity** — tests prove the intended behavior, not a weaker or different one.

- **Severity levels:**
  - `CRITICAL` — required goal or criterion contradicted or effectively uncovered.
  - `HIGH` — meaningful trace chain broken, or material behavior added with no goal support.
  - `MEDIUM` — partial or non-core trace gap; spec-test mismatch for a non-critical criterion.
  - `LOW` — minor traceability clarity improvement.

- **Output format:**
  ```
  ### Status — PASS or FAIL
  ### Findings
  | # | Severity | File | Lines | Category | Issue | Recommendation |
  ```
  Return `PASS` when there are no `CRITICAL` or `HIGH` findings. If there are no findings, write `None.` under `### Findings`.

**Adaptation note:** Remove the opencode permission block and replace with pi frontmatter. The system prompt body requires no further conversion. Note that `max_turns` is `15` (not `20` like the other three) — this is because goal traceability is a more focused analysis with a smaller checklist, and the outline specifies this reduced limit.

### Conversion Rules Applied

All four agents follow the opencode → pi conversion rules documented in `requirements.md`:

| opencode field | pi frontmatter | Value |
|---|---|---|
| `mode: subagent` | N/A | Removed |
| `hidden: true` | `enabled: false` | Can be included if desired; omitted by default |
| `temperature: 0.1` | N/A | Removed |
| `steps: N` | `max_turns: N` | 20 for three agents, 15 for goal-traceability |
| `permission.edit: deny` | `tools: read, bash, grep, find, ls` | Standard read-only tool set |
| `permission.webfetch: deny` | `extensions: false` | No extension tool access |
| `permission.bash: "*": deny` | N/A | Overridden by `tools` list which includes bash for read-only commands |
| `permission.task: "*": deny` | N/A | Not applicable; dispatched by orchestrator |
| `permission.question: deny` | N/A | Not applicable; no question tool in these agents |
| `permission.todowrite: deny` | N/A | Not applicable; no todowrite in these agents |

System prompt body adaptations applied:
- For `qrspi-review-test-quality.md` only: replace "all inputs arrive verbatim from the gate orchestrator; do not read or write files, run commands, or dispatch agents" with pi-compatible guidance reflecting that the agent has `read, bash, grep, find, ls` tools for inspection.
- All other agents: system prompt bodies are preserved verbatim — no opencode-specific tool name references exist.

## Files
- `agents/qrspi-review-test-coverage.md` (CREATE) — Test coverage review lens. Read-only. Frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`. System prompt: 5 review rules (coverage, test quality, isolation, non-behavioral tasks, ambiguity), severity classification (CRITICAL/HIGH/MEDIUM/LOW), recommendation labels (DELETE/REWRITE/ADD/BACKWARD_LOOP), structured output format (`### Status — PASS/FAIL`, `### Findings` table).
- `agents/qrspi-review-test-quality.md` (CREATE) — Test quality review lens. Read-only. Frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`. System prompt: 4 rules + 11-item checklist for RED-phase test review, severity classification, recommendation labels (DELETE/REWRITE/ADD/BACKWARD_LOOP), structured output format. Opening sentence adapted to reflect pi tool availability (can use read/bash/grep/find/ls, never writes files).
- `agents/qrspi-review-code-simplifier.md` (CREATE) — Code simplification review lens. Read-only. Frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`. System prompt: 5-item simplification checklist (unnecessary complexity, dead code, verbose patterns, premature abstraction, inconsistency), severity classification (HIGH/MEDIUM/LOW/💡), advisory-only (always returns `PASS`), structured output format.
- `agents/qrspi-review-goal-traceability.md` (CREATE) — Goal traceability review lens. Read-only. Frontmatter: `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 15`, `prompt_mode: replace`, `extensions: false`. System prompt: 4-item traceability checklist (forward trace, backward trace, gaps, spec-test fidelity), severity classification (CRITICAL/HIGH/MEDIUM/LOW), structured output format (`### Status — PASS/FAIL`, `### Findings` table).

## Test Expectations
- **Frontmatter validity:** When each agent `.md` file is parsed, the YAML frontmatter must contain the exact fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions` with parsable values of the correct type. The `tools` field value for every agent must be exactly `read, bash, grep, find, ls` (comma-separated, no quotes). The `model` field must be exactly `anthropic/claude-haiku-4-5` for all four agents. The `max_turns` field must be `20` for test-coverage, test-quality, and code-simplifier; `15` for goal-traceability. The `thinking` field must be `low` for all four agents.
- **Haiku-tier model:** When inspected, all four agent files specify `model: anthropic/claude-haiku-4-5` in frontmatter — no file uses a sonnet-tier or other model identifier. This satisfies the AC 7 requirement that reviewer/leaf agents use haiku-tier.
- **Read-only tool set:** When inspected, all four agent files specify `tools: read, bash, grep, find, ls` and do NOT include `write`, `edit`, or `all` in the tools list. This enforces the read-only constraint for review lens agents.
- **Structured output contract — test coverage lens:** When a downstream system reads the agent prompt, the `### Output Format` section must specify a `### Status — PASS or FAIL` header followed by a `### Findings` table with columns `#`, `Severity`, `File`, `Lines`, `Category`, `Issue`, `Recommendation`. The prompt must state that `PASS` is returned when there are no `CRITICAL` or `HIGH` findings.
- **Structured output contract — test quality lens:** The output format section must specify the same table structure as the test coverage lens, with the addition that `PASS` = no `CRITICAL` or `HIGH` findings, and the `### Findings` section writes `None.` when empty.
- **Structured output contract — code simplifier lens:** The output format section must specify that the agent always returns `### Status — PASS` (never `FAIL`), and findings are advisory. The severity enum must include `💡` as a valid severity label for speculative suggestions.
- **Structured output contract — goal traceability lens:** The output format section must specify `### Status — PASS or FAIL`, return `PASS` when no `CRITICAL` or `HIGH` findings exist, and write `None.` when there are no findings.
- **Severity classification — test coverage lens:** When the prompt is inspected, the severity section must define exactly four levels (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) with definitions that distinguish required-behavior gaps from edge-case gaps.
- **Checklist completeness — test quality lens:** When the prompt is inspected, the checklist must contain all 11 items from the opencode source (Trivial/Zero-Assertion through Missing Spec Behaviors), each with its designated severity label. No checklist items may be omitted or merged.
- **Checklist completeness — goal traceability lens:** When the prompt is inspected, the checklist must contain all 4 items (Forward Trace, Backward Trace, Gaps, Spec-Test Fidelity) with severity labels per the opencode source. No items omitted.
- **Checklist completeness — code simplifier lens:** When the prompt is inspected, the checklist must contain all 5 items (Unnecessary Complexity, Dead Code, Verbose Patterns, Premature Abstraction, Inconsistency).
- **System prompt body — test quality lens adaptation:** The opening paragraph must not contain the phrase "do not read or write files, run commands" — it must instead reflect pi tool availability. The phrase "all inputs arrive verbatim from the gate orchestrator" may be removed or adapted; the prompt must indicate the agent can use its read tools to inspect pipeline artifacts.
- **System prompt body — other lenses preserve source:** For `qrspi-review-test-coverage.md`, `qrspi-review-code-simplifier.md`, and `qrspi-review-goal-traceability.md`, the core review rules, severity definitions, recommendation labels, and output format specifications must match the opencode sources verbatim (modulo the removed permission block). No review rules may be added, removed, or altered.
- **No opencode artifacts:** When all four agent files are inspected, none may contain opencode-specific frontmatter fields (`mode`, `hidden`, `temperature`, `steps`, `permission`). No references to opencode tool names (`task`, `question` as a tool, opencode-specific permission syntax) may appear in the frontmatter or system prompt body.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
