# Task 16: Stage 7 checker agents

## Metadata
- **Task:** 16
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3b — Checkers

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (checker agent types), AC 7 (model tier frontmatter)
- **NFRs:** NFR: Compatibility (model tier)
- **Replan Gate Criteria:** Phase 3 replan gate (Checker agents complete)

## Source Traceability
- **Goals:** AC 6 (all 10 stages produce prescribed artifacts), AC 7 (works with multiple model tiers)
- **Plan:** Task 16, Phase 3 — Implementation Loop
- **Design:** Slice 3b — Stage 7 Checkers & Simplifier
- **Structure:** Slice 3b — Stage 7 Checkers & Simplifier — `agents/qrspi-e2e-regression-checker.md`, `agents/qrspi-integration-checker.md`, `agents/qrspi-baseline-regression-checker.md`

## Description

Create three Stage 7 checker agent type `.md` files that form the post-wave validation gate of the QRSPI deepwork pipeline: the E2E regression checker, the integration checker, and the baseline regression checker. These agents are ported from their opencode equivalents using the conversion tables documented in `requirements.md`. Every agent file follows the pi agent type convention: YAML frontmatter with `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions` fields, followed by a system prompt body that preserves the original agent's detection logic, attribution rules, return contract format, and gate protocols.

All three agents are read-only — they detect and classify regressions but never modify source code. They are dispatched by `qrspi-implement` (the Stage 7 orchestrator) via `qrspi_dispatch` after each task wave completes, before the wave is considered finished and before `qrspi-simplify-pass` runs. All use the haiku-tier model (`anthropic/claude-haiku-4-5`) to minimise cost for automated checking.

### Conversion Rules (opencode → pi)

Apply these conversions to every system prompt body in this task:

| opencode pattern | pi equivalent |
|---|---|
| `Invoke <agent> as a subagent:` | `Use the qrspi_dispatch tool with subagent_type: "<agent>"` |
| `Invoke 'build'` / `Invoke @build` as a subagent | Run the commands directly via `bash` — these agents have `bash` in their tools list and do not need a separate build subagent in pi. The command delegation that went to opencode's `build` agent is inlined: the checker reads the recorded commands from `baseline-results.md` or the pipeline config and executes them itself via `bash`. |
| `cat .pipeline/...` | `Read .pipeline/...` (read tool) |
| `mkdir -p .pipeline/...` | `bash: mkdir -p .pipeline/...` |
| `date -u +...` | `bash: date -u +...` |
| `question` (tool) | `qrspi_question` (tool) |
| `todowrite` | Available in pi (keep references) |
| `Run ID: qrspi-<timestamp>` | Same — pass verbatim in dispatch prompt |
| `=== RUN ID ===` headers | Same — pass verbatim in dispatch prompt |
| `### Status — PASS/FAIL` returns | Same — parsed from subagent output |
| Stop after subagent dispatch | Same — foreground agents return results inline |

Remove from system prompt bodies: opencode permission system references (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `permission.allowed_paths`, rule 11 allowed-list cross-check logic). Tool access is determined by the `tools` frontmatter field only. Keep all detection logic, attribution rules, return contract parsing, gate protocols, and classification criteria intact.

### Agent 1: `agents/qrspi-e2e-regression-checker.md` — E2E Regression Checker

**Role**: After each completed Stage 7 wave, detects new end-to-end regressions by comparing the current E2E state against the pre-implementation baseline recorded in `baseline-results.md`. Attributes each regression to suspected task IDs using the current execution manifest. Does not fix, plan, or implement anything — read-only.

**Inputs**: Baseline results (`baseline-results.md`) and the current wave's execution manifest. The checker receives these paths via its dispatch prompt from `qrspi-implement`.

**Responsibilities**:
1. Read `baseline-results.md` and extract the E2E row and the E2E failure inventory. Ignore all other check types (build, lint, typecheck, test, coverage).
2. Inspect the E2E gate status from the baseline:
   - If the baseline E2E row is `NOT CONFIGURED` or `SKIPPED`: return an empty regression table with the matching gate status. Do not run E2E commands. The gate is non-blocking.
   - If the baseline E2E row is `PASS` or `FAIL` but no E2E command is recorded: return `### E2E Gate Status — SKIPPED` with no regressions — the wave-level E2E gate is skipped because there was no command to run.
3. Read the current execution manifest to extract `Files Modified` and `Files Created` columns per task row. This provides the file-to-task mapping used for attribution.
4. Run the recorded E2E command from the baseline via `bash` and collect results.
5. Compare current E2E results against the baseline E2E failure inventory:
   - A **regression** is any E2E failure that was absent from, or is materially worse than, the baseline failure inventory.
   - Failures that are materially unchanged from the baseline are pre-existing — ignore them.
6. For each regression found, cross-reference the failing file path(s) against the execution manifest's `Files Modified` and `Files Created` columns to attribute to suspected task IDs. Record `unknown` when no task matches or when the failing file cannot be identified.
7. For each regression, record: the exact test name or error text, the command that surfaced it, the failing file(s) (`unknown` if not identifiable), and the suspected task IDs (`unknown` if no task file matches).

**Return Contract**:
```
### Status — PASS or FAIL
### Wave — [current wave number]
### E2E Gate Status — EXECUTED or SKIPPED or NOT CONFIGURED
### E2E Regressions
| # | Failing Test / Error | Command | Failing File(s) | Suspected Task IDs |
|---|----------------------|---------|-----------------|--------------------|
[one row per regression, or "None."]
### Summary
["No E2E regressions." or "N E2E regression(s) found across tasks: [task IDs]."]
```

Return `### Status — PASS` when the regression list is empty (including `SKIPPED` and `NOT CONFIGURED` gate states). Return `### Status — FAIL` when any regression is present in the table.

**YAML Frontmatter**:
```yaml
---
description: "E2E regression checker — detects new end-to-end regressions after each Stage 7 wave by diffing against baseline-results.md and attributing to task IDs"
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
---
```

### Agent 2: `agents/qrspi-integration-checker.md` — Integration Checker

**Role**: A lightweight Stage 7 integration gate that runs after implementation waves and before acceptance testing. Validates cross-task compatibility across four dimensions: build sanity, shared interface compatibility, generated-artifact parity, and targeted smoke checks for interactions between implemented tasks. Read-only — does not redo acceptance or full verification.

**Inputs**: Execution manifest, pipeline config (`config.md`), plan (`plan.md`), current phase number, baseline results (`baseline-results.md`), completed phase summaries, review status summary, and design/structure context (`N/A` for quick-fix). These are provided via the dispatch prompt from `qrspi-implement`.

**Responsibilities**:
1. Read all input artifacts to understand the current phase's task outputs, the project's configuration, and the review/implementation status.
2. Interpret review statuses:
   - Plan `clean` = no unresolved concerns.
   - Plan `unclean-cap` = unresolved plan concerns.
   - Implementation `CLEAN` = review passed.
   - Implementation `UNRESOLVED` = blocking findings remain.
   - Implementation `NOT RUN` = Stage 7 contract violation — report `FAIL`.
   - If a failure matches unresolved concerns, cite that upstream concern in the details.
3. Run four integration checks:
   - **Build sanity** — verify the full changed-file set builds cleanly by running the project's build command via `bash`.
   - **Interfaces** — check shared interface compatibility across completed task outputs. Examine exported symbols, type declarations, and API surfaces touched by multiple tasks for compatibility.
   - **Artifact parity** — validate generated or derived artifacts (e.g., schemas, docs, declarations, generated clients, manifests) touched by completed task outputs. Prefer config-driven patterns from `config.md`; otherwise fall back to best-effort inference from changed paths and artifact names.
   - **Smoke checks** — run targeted tests that exercise interactions between the tasks implemented in this wave. Prefer integration tests or smoke-test commands referenced in the project config.
4. Determine structural mismatch: when integration failures indicate that the design, structure, or plan must change (not merely local implementation defects), record `### Backward Loop Request` with the affected artifact (`design`, `structure`, or `plan`) and a recommendation for what upstream artifact must change. If no structural mismatch is found, omit the backward loop request entirely.
5. Do not run full verification, acceptance testing, or additional review cycles — this is a narrow integration-only gate.

**Return Contract**:
```
### Status — PASS or FAIL

### Integration Results
| Check | Status | Details |
|-------|--------|---------|
| Build sanity | PASS or FAIL | [details] |
| Interfaces | PASS or FAIL | [details] |
| Artifact parity | PASS or FAIL | [details] |
| Smoke checks | PASS or FAIL | [details] |

### Stage Summary
Integration gate [PASS or FAIL]. Build sanity: [PASS/FAIL]. Interfaces: [PASS/FAIL]. Artifact parity: [PASS/FAIL]. Smoke checks: [PASS/FAIL].

### Backward Loop Request — only if a structural mismatch was found
**Issue**: [description of structural mismatch]
**Affected Artifact**: [design | structure | plan]
**Recommendation**: [what upstream artifact must change]
```

Return `### Status — PASS` only if all four integration checks pass. Return `### Status — FAIL` if any check fails. Include `### Backward Loop Request` only for upstream artifact problems, not local implementation defects — omit it when structural mismatch is `None`.

**YAML Frontmatter**:
```yaml
---
description: "Integration gate — validates cross-task build sanity, interface compatibility, artifact parity, and smoke checks after Stage 7 waves"
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
---
```

### Agent 3: `agents/qrspi-baseline-regression-checker.md` — Baseline Regression Checker

**Role**: Detects new build, lint, typecheck, E2E, test, and coverage regressions introduced by the current phase by diffing against `baseline-results.md`. Attributes each regression to task IDs and phases using the current and prior execution manifests. Does not fix, plan, or implement anything — read-only.

**Inputs**: Run ID, current phase number, pipeline config (`config.md`), baseline results (`baseline-results.md`), execution manifest, and prior phase execution manifests. These are provided via the dispatch prompt from `qrspi-implement`.

**Responsibilities**:
1. **Build the phase changed-path inventory**: Parse the execution manifest's `Files Modified` and `Files Created` columns. Union into a deduplicated, normalized `phase_changed_paths` set of repo-relative paths. If the set is empty (no rows or missing columns), behave defensively as if it contained every file — run all checks fully.
2. **Decide the per-check run plan**:
   - **Build / Typecheck** — always run (transitive impact across the project).
   - **Lint** — run when any path in `phase_changed_paths` matches a lintable extension (project-defined; default `.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.scala,.php,.swift`). Otherwise mark `SKIPPED (no relevant changes)`.
   - **E2E** — run when any path in `phase_changed_paths` is not a test file (i.e., exercises production code). Test-globs come from `config.md.test_globs` or a sensible default. Otherwise mark `SKIPPED (no production changes)`.
   - **Test** — run only the test files whose module dependency graph includes any path from `phase_changed_paths`. If the project tooling cannot resolve a focused test set, fall back to running the full test suite. Mark `SKIPPED` only when no production changes occurred at all (test-only changes still re-run their owning tests).
   - **Coverage** (only when baseline includes a Coverage row) — re-measure regardless of skip status (coverage rates depend on absolute project state, not just changed files). Compare against `coverage_threshold` from `config.md`.
3. **Read the baseline results**: Extract `### Check Results` and the failure inventory for each check type.
4. **Execute checks via `bash`**: For each check that the run plan says to run, use the recorded command from the baseline when available. For Test in `run-focused` mode, append the focused test file list to the test command in a tool-appropriate way; if the tooling cannot accept a file list, run the full test suite and report `Test (full suite due to tooling)`. Skip checks with baseline status `SKIPPED` or `NOT CONFIGURED`, or whose run plan status is `skip` — do not run them and do not report regressions for them. Surface skipped checks in a separate table with rationale.
5. **Classify failures as regressions**:
   - Baseline `PASS`, now failing: every current failing item for that check is a regression.
   - Baseline `FAIL`, now has more failures: a failure is a regression only if its test/error name and file path were absent from the baseline failure inventory for that check. Failures sharing the same check, test/error name, and file path as a baseline entry are pre-existing — ignore them.
6. **Coverage gate**: If the baseline has a Coverage row, re-measure and compare: if `current >= coverage_threshold` → no regression, status PASS. If `current < coverage_threshold` → emit a Coverage regression row with `Failing Test / Error` = `coverage <current>% < threshold <threshold>%` and `Suspected Task IDs` derived from execution-manifest rows whose changed files dominate the coverage drop (best-effort; use `unknown` if attribution is uncertain).
7. **Attribute each regression**: For each regression, cross-reference failing file path(s) against the current and prior execution manifests. Use the earliest matching phase as `Phase Introduced`, the latest matching phase as `Last Modified Phase`, and the latest matching task row(s) as `Suspected Task IDs`. Use `unknown` for any field that cannot be derived.
8. **Return the regression inventory** as a structured contract.

**Return Contract**:
```
### Status — PASS or FAIL
### Regressions
| # | Check | Failing Test / Error | Command | Failing File(s) | Suspected Task IDs | Phase Introduced | Last Modified Phase |
|---|-------|----------------------|---------|-----------------|--------------------|------------------|---------------------|
[one row per regression, or "None."]
### Skipped Checks
| Check | Rationale |
|-------|-----------|
[one row per skipped check, or "None."]
### Coverage
[current=<n>%, baseline=<n>%, threshold=<n>%, status=PASS|FAIL — or "Not gated." if baseline had no Coverage row]
### Summary
["No regressions." or "N regression(s) found across checks/tasks: [comma-separated checks/task IDs]."]
```

Return `### Status — PASS` when the regression list is empty (Coverage included); return `### Status — FAIL` when any regression is present.

**YAML Frontmatter**:
```yaml
---
description: "Baseline regression checker — detects new build/lint/typecheck/E2E/test/coverage regressions by diffing against baseline-results.md and attributing to task IDs and phases"
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
---
```

## Files
- `agents/qrspi-e2e-regression-checker.md` (CREATE) — E2E regression checker subagent: after each Stage 7 wave, runs the recorded E2E command, diffs against baseline-results.md E2E failure inventory, attributes new regressions to suspected task IDs via execution manifest cross-reference. Returns E2E Gate Status, regression table, and PASS/FAIL. Read-only. Frontmatter: tools read,bash,grep,find,ls, max_turns 20, thinking low, model anthropic/claude-haiku-4-5.
- `agents/qrspi-integration-checker.md` (CREATE) — Integration checker subagent: lightweight cross-task gate running build sanity, interface compatibility, artifact parity, and smoke checks. Returns four-check result table, stage summary, and optional Backward Loop Request for structural mismatches. Read-only. Frontmatter: tools read,bash,grep,find,ls, max_turns 20, thinking low, model anthropic/claude-haiku-4-5.
- `agents/qrspi-baseline-regression-checker.md` (CREATE) — Baseline regression checker subagent: builds phase changed-path inventory, decides per-check run plan (build/typecheck always, lint/E2E/test conditional, coverage if present), runs checks, diffs against baseline-results.md, classifies new/worsened failures as regressions, attributes to task IDs and phases via current and prior execution manifests. Returns regression table with Phase Introduced/Last Modified Phase columns, skipped checks table, coverage status, and PASS/FAIL. Read-only. Frontmatter: tools read,bash,grep,find,ls, max_turns 20, thinking low, model anthropic/claude-haiku-4-5.

## Test Expectations
- **Valid YAML frontmatter in all three agent files**: When each agent file is parsed by a YAML frontmatter parser, expect all required fields (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`) to be present with the exact values: `tools` is `read, bash, grep, find, ls`, `model` is `anthropic/claude-haiku-4-5`, `thinking` is `low`, `max_turns` is `20`, `prompt_mode` is `replace`, `extensions` is `false`.
- **Model tier frontmatter reflects AC 7**: When inspecting all three agent files, expect every file to use `model: anthropic/claude-haiku-4-5` (haiku-tier), consistent with the design decision that checker/leaf agents use the cheaper haiku model.
- **qrspi-e2e-regression-checker contains E2E-specific gate logic**: When reading `qrspi-e2e-regression-checker.md`, expect the system prompt to describe: (a) reading only the E2E row from `baseline-results.md`, (b) returning `SKIPPED` or `NOT CONFIGURED` gate status without running commands when the baseline lacks E2E configuration, (c) running the recorded E2E command via `bash`, (d) classifying a failure as a regression only when it is absent from or materially worse than the baseline failure inventory, (e) attributing each regression to task IDs via execution manifest cross-reference with `unknown` as the fallback, (f) a return contract containing `### E2E Gate Status`, `### E2E Regressions` table (with columns: Failing Test / Error, Command, Failing File(s), Suspected Task IDs), and `### Summary`.
- **qrspi-e2e-regression-checker returns PASS on empty regressions**: When reading `qrspi-e2e-regression-checker.md`, expect the system prompt to state that `### Status — PASS` is returned when the regression list is empty, including `SKIPPED` and `NOT CONFIGURED` gate states, and `### Status — FAIL` when any regression is present.
- **qrspi-integration-checker contains four-check integration gate**: When reading `qrspi-integration-checker.md`, expect the system prompt to describe four distinct integration checks: (a) build sanity via the project build command, (b) shared interface compatibility across completed task outputs, (c) generated-artifact parity validation, (d) targeted smoke checks for inter-task interactions. Expect all four to be required for a PASS result.
- **qrspi-integration-checker contains backward loop trigger**: When reading `qrspi-integration-checker.md`, expect the system prompt to describe the optional `### Backward Loop Request` section, triggered only when a structural mismatch is found (not for local implementation defects), identifying the affected artifact (`design`, `structure`, or `plan`) and a recommendation. Expect the prompt to state that this section is omitted when structural mismatch is `None`.
- **qrspi-integration-checker interprets review statuses**: When reading `qrspi-integration-checker.md`, expect the system prompt to define `NOT RUN` as a Stage 7 contract violation (report FAIL), and to cite upstream unresolved concerns when a failure matches them.
- **qrspi-baseline-regression-checker contains per-check run plan logic**: When reading `qrspi-baseline-regression-checker.md`, expect the system prompt to describe: (a) building a `phase_changed_paths` inventory from the execution manifest, (b) per-check run decisions (build/typecheck always run; lint conditional on lintable extension changes; E2E conditional on non-test production changes; test run-focused on changed paths with full-suite fallback; coverage re-measured when baseline has it), (c) running checks via `bash` using recorded commands from baseline, (d) skipped checks surfaced with rationale.
- **qrspi-baseline-regression-checker classifies failures incrementally**: When reading `qrspi-baseline-regression-checker.md`, expect the system prompt to describe: (a) baseline PASS→now failing = regression for every current failing item, (b) baseline FAIL→now more failures = only new/worsened items are regressions (matching check/test/error/name/file are pre-existing and ignored), (c) coverage regression when `current < coverage_threshold`.
- **qrspi-baseline-regression-checker attributes across phases**: When reading `qrspi-baseline-regression-checker.md`, expect the regression table columns to include `Phase Introduced` and `Last Modified Phase`, and the system prompt to describe cross-referencing failing files against both current and prior execution manifests to populate these fields, with `unknown` as the fallback.
- **qrspi-baseline-regression-checker return contract is complete**: When reading `qrspi-baseline-regression-checker.md`, expect the system prompt to define a return contract with: `### Status` (PASS/FAIL), `### Regressions` table (8 columns), `### Skipped Checks` table (Check + Rationale), `### Coverage` (one line or "Not gated."), and `### Summary`. Expect PASS when regression list is empty; FAIL when any regression is present.
- **No opencode permission artifacts**: When reading any of the three agent files, expect zero occurrences of opencode-specific permission fields (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `permission.allowed_paths`, rule 11 allowed-list cross-check) in the system prompt body. The opencode `build` subagent delegation pattern is replaced with direct `bash` command execution.
- **All three agent files are structurally complete**: When each `.md` file is opened, expect a valid YAML frontmatter delimited by `---`, followed by a system prompt body containing at least 20 lines of agent-specific instructions, ending without extraneous content. No placeholder text (TBD, TODO, "details omitted") appears in the final system prompt body.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
