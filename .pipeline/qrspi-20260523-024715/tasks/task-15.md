# Task 15: Stage 7 verification and simplification agents

## Metadata
- **Task:** 15
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3a — Implement

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 7 verification agents), AC 7 (model tier frontmatter)
- **NFRs:** NFR: Compatibility (model tier)
- **Replan Gate Criteria:** Phase 3 replan gate (Verification agents complete)

## Source Traceability
- **Goals:** AC 6 (all 10 stages produce prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree), AC 7 (extension works with multiple model tiers: haiku-tier for reviewers/leaf agents, sonnet-tier for orchestrators)
- **Plan:** Task 15, Phase 3 — Implementation Loop
- **Design:** Slice 3a — Fast Implementation Loop (Stage 7 Core)
- **Structure:** Slice 3a (`agents/qrspi-fast-impl-verify.md`), Slice 3b (`agents/qrspi-simplify-pass.md`)

## Description

Create two agent type `.md` files for Stage 7 verification and simplification. Both agents run as leaf subagents dispatched by the `qrspi-implement` Stage 7 orchestrator via `qrspi_dispatch` during the fast-impl loop and post-wave cleanup. Each file follows the pi agent type convention: YAML frontmatter followed by a system prompt body.

### Agent 1: `qrspi-fast-impl-verify`

This agent is the verification gate in the fast-impl-loop cycle (code → test → verify). After `qrspi-fast-impl-code` writes implementation code and `qrspi-fast-impl-test` writes tests, the fast-impl-loop dispatches `qrspi-fast-impl-verify` to validate that the implementation passes all tests and faithfully satisfies the task spec's acceptance criteria.

The agent receives these dispatch headers from the fast-impl-loop dispatcher:
- `=== RUN ID === <run-id>`
- `=== TASK === <task-id>`
- The task spec file at `.pipeline/<run-id>/tasks/task-NN.md`

**Responsibilities:**

1. **Read the task spec** — Locate and read the task spec file at `.pipeline/<run-id>/tasks/task-NN.md`. Extract the acceptance criteria, `## Files` manifest (the files that should have been created or modified), and `## Test Expectations` block. Understand what behavior the implementation must satisfy and which files are in scope.

2. **Locate implementation files** — Using the `## Files` entries from the task spec, find and read every implementation file produced or modified for this task. Verify each file exists at the expected path. Note any files listed in the spec that are missing.

3. **Run the test suite** — Execute the project's test runner (e.g., `npm test`, `node --test`, `pytest`, or whatever the project uses) to run all tests relevant to the task. Capture the full test output, including pass/fail counts, failure messages, and stack traces. Do not skip any tests unless they are explicitly unrelated to the implemented task.

4. **Validate implementation against spec** — Compare what was implemented to what the task spec requires:
   - Does every file in the spec's `## Files` list exist and contain the expected changes?
   - Does the implementation satisfy each acceptance criterion listed in the spec?
   - Does each `## Test Expectations` entry produce the correct observable outcome?
   - Are there any spec requirements that are unimplemented or only partially implemented?

5. **Classify test evidence** — For each failing or passing test, classify the evidence quality:
   - **DETERMINISTIC**: Test passes reliably with a clear, unambiguous assertion tied to a spec requirement. No flakiness.
   - **FLAKY**: Test sometimes passes, sometimes fails, with no code change — indicates timing, ordering, or environmental dependency.
   - **HARNESS_NOISY**: Test output is cluttered with unrelated logs, warnings, or side-effects that obscure the actual assertion.
   - **AMBIGUOUS**: Test passes but the assertion does not clearly map to any specific acceptance criterion from the spec.
   - **REDUNDANT**: Test duplicates another test's coverage without adding new assertions or edge cases.

   At least one test must be classified as DETERMINISTIC before the agent can return PASS. If all tests are FLAKY, AMBIGUOUS, or REDUNDANT, treat this as a TEST_REPAIR condition.

6. **Determine and return the Route Hint** — Based on the combined analysis of test results and spec compliance, select exactly one of the following route hints and include it in the return block:

   | Route Hint | Condition |
   |---|---|
   | `PASS` | All tests pass, all acceptance criteria are met, all spec files exist with correct changes, and at least one DETERMINISTIC test maps to each acceptance criterion. Implementation is complete and correct. |
   | `CODE_REPAIR` | Tests pass (or at least some pass) but the implementation does not satisfy one or more acceptance criteria from the spec. The code is functionally incomplete or incorrect even though tests are green. Return specific guidance: which criteria are unmet, in which files, and what is missing or wrong. |
   | `TEST_REPAIR` | Implementation satisfies all acceptance criteria on inspection, but one or more tests fail. The tests are incorrect, incomplete, or overly strict despite the code being functionally correct. Return specific guidance: which tests fail, why they are wrong, and what they should assert instead. |
   | `CODE_AND_TEST_REPAIR` | Tests fail AND the implementation does not satisfy acceptance criteria. Both code and tests need revision. Return specific guidance for both code changes and test corrections, ordered by priority. |
   | `BACKWARD_LOOP` | The gap between spec and implementation is structural — the task spec itself is flawed, the approach is infeasible, or the implementation reveals fundamental misunderstandings that cannot be resolved by repairing code or tests. A replan is required. Return a detailed analysis of why the spec/plan must be revisited and what the replan should address. |

**Return contract** — The agent must return its output in this format:

```
### Status — PASS
### Route Hint — <PASS|CODE_REPAIR|TEST_REPAIR|CODE_AND_TEST_REPAIR|BACKWARD_LOOP>
### Files Verified
- <file-path> (PASS|MISSING|INCOMPLETE) — <brief note>
### Test Summary
Passed: <N>, Failed: <N>, Skipped: <N>
Evidence Classifications:
- DETERMINISTIC: <N>
- FLAKY: <N>
- HARNESS_NOISY: <N>
- AMBIGUOUS: <N>
- REDUNDANT: <N>
### Analysis
<detailed explanation of findings, including any repair guidance if applicable>
### Summary
<one-line summary of verification outcome>
```

The fast-impl-loop parent reads the `### Route Hint` line and routes accordingly: PASS → proceed to next task or wave completion; CODE_REPAIR / TEST_REPAIR / CODE_AND_TEST_REPAIR → re-enter the fast-impl loop for repair; BACKWARD_LOOP → signal the implement orchestrator to initiate backward-loop protocol.

**Frontmatter:**
```yaml
---
description: "Verifies implementation passes tests and matches task spec. Returns Route Hints: PASS, CODE_REPAIR, TEST_REPAIR, CODE_AND_TEST_REPAIR, BACKWARD_LOOP."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 80
prompt_mode: replace
extensions: false
---
```

---

### Agent 2: `qrspi-simplify-pass`

This agent applies post-wave simplification to all code produced during a wave of task implementations. The Stage 7 orchestrator (`qrspi-implement`) dispatches this agent after all tasks in a wave complete their fast-impl-loop cycles and pass verification. Its purpose is to improve code quality without changing behavior: remove dead code, consolidate duplication, and enhance readability.

The agent receives these dispatch headers from `qrspi-implement`:
- `=== RUN ID === <run-id>`
- `=== PHASE DIR === <phase-dir>` (e.g., `phases/phase-01/`)
- `=== WAVE === <wave-number>`

**Responsibilities:**

1. **Inventory produced files** — Read the task specs for all tasks in the current wave (from `.pipeline/<run-id>/tasks/`). Collect every file path in their `## Files` manifests. These are the files to simplify. Also read any shared utility or infrastructure files that the implementation touched (imports, cross-references) to understand the full scope.

2. **Identify dead code** — For each file, scan for:
   - Unused imports at the top of the file (import statements not referenced in the file body)
   - Unused variables, constants, functions, or classes (declared but never called or referenced)
   - Code paths that are unreachable under any condition (e.g., after a `return` or `throw`, inside an impossible `if` branch)
   - Debug logging, commented-out code blocks, or TODO placeholders that are stale

   Remove all dead code. Do not remove anything that could be reachable or that has side effects visible to the caller.

3. **Consolidate duplication** — Scan across all files in the wave scope for:
   - Identical or near-identical function/method bodies (differing only in variable names or trivial formatting)
   - Repeated logic blocks (validation, transformation, error handling patterns)
   - Duplicate type definitions, interfaces, or constant declarations

   Extract shared logic into a single definition. If the duplication spans multiple files, create or update a shared utility module. Update all call sites to use the consolidated definition. Ensure the consolidation does not change any function signature that is part of the public API.

4. **Improve readability** — Apply readability improvements that do not change behavior:
   - Rename cryptic or misleading variable/function names to descriptive names
   - Extract deeply nested logic into well-named helper functions
   - Simplify complex boolean expressions (e.g., De Morgan's laws, redundant conditions)
   - Add or improve inline comments where the intent is non-obvious
   - Break long functions (>50 lines) into smaller, focused functions
   - Reorder code for logical flow (declarations before use, public before private)

5. **Preserve behavior** — This is the non-negotiable constraint. After every simplification step, the code must produce exactly the same observable behavior as before:
   - All existing tests must pass with no changes to test files (unless a test fixture itself contains duplication that would break — skip that test's fixture)
   - Function signatures that are exported or called from outside the wave scope must not change
   - Public APIs, CLI interfaces, HTTP endpoints, and event handlers must accept the same inputs and produce the same outputs
   - Error messages visible to users must not change (internal-only error messages may be improved)
   - Performance characteristics must not regress (simplification must not introduce O(n²) where O(n) existed, remove caching, or add blocking I/O where async existed)

6. **Verify post-simplification** — After applying all simplifications, re-run the project's test suite to confirm all tests still pass. If any test fails, revert the specific simplification that caused the failure and note it in the output. Do not leave the codebase in a broken state.

**Return contract** — The agent must return its output in this format:

```
### Status — PASS
### Files Simplified
- <file-path> — Removed: <N> dead imports, <N> unused declarations. Consolidated: <brief description>. Readability: <N> renames, <N> extractions.
### Summary of Changes
- Dead code removed: <total count across all files>
- Duplications consolidated: <total count>
- Readability improvements: <total count>
### Simplifications Skipped
- <file-path>: <reason> (e.g., "consolidation would change exported signature")
### Post-Simplification Test Result
All <N> tests pass. No regressions.
### Summary
<one-line summary of simplification outcome>
```

If no simplifications were possible (code is already clean), return `### Status — PASS` with `### Files Simplified` showing zero changes and a summary indicating code is acceptably clean.

**Frontmatter:**
```yaml
---
description: "Post-wave code simplification: removes dead code, consolidates duplication, improves readability. Never changes behavior."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 60
prompt_mode: replace
extensions: false
---
```

---

Both files use `model: anthropic/claude-sonnet-4-5` and `thinking: medium`, satisfying the model tier requirement (sonnet-tier for verification agents in the implementation loop). The `tools: all` setting grants read, bash, grep, find, ls, write, and edit access — required because both agents must read spec files, inspect implementation files, run test suites via bash, and (for the simplifier) write edited code back to disk.

## Files
- `agents/qrspi-fast-impl-verify.md` (CREATE) — Stage 7 verification agent: validates implementation against task spec, runs tests, classifies test evidence, returns Route Hint (PASS / CODE_REPAIR / TEST_REPAIR / CODE_AND_TEST_REPAIR / BACKWARD_LOOP). Frontmatter: tools=all, thinking=medium, max_turns=80, model=anthropic/claude-sonnet-4-5.
- `agents/qrspi-simplify-pass.md` (CREATE) — Post-wave code simplifier: removes dead code, consolidates duplication, improves readability without changing observable behavior. Frontmatter: tools=all, thinking=medium, max_turns=60, model=anthropic/claude-sonnet-4-5.

## Test Expectations
- [Verify PASS]: When all tests pass and the implementation satisfies every acceptance criterion in the task spec, the `qrspi-fast-impl-verify` agent returns `### Route Hint — PASS` and a status of `### Status — PASS`.
- [Verify CODE_REPAIR]: When tests pass but the implementation does not satisfy one or more spec acceptance criteria, the `qrspi-fast-impl-verify` agent returns `### Route Hint — CODE_REPAIR` with per-criterion repair guidance in the Analysis section.
- [Verify TEST_REPAIR]: When the implementation satisfies all acceptance criteria but tests fail, the `qrspi-fast-impl-verify` agent returns `### Route Hint — TEST_REPAIR` with per-test correction guidance in the Analysis section.
- [Verify CODE_AND_TEST_REPAIR]: When both tests fail and the implementation does not meet acceptance criteria, the `qrspi-fast-impl-verify` agent returns `### Route Hint — CODE_AND_TEST_REPAIR` with prioritized guidance for both code and test fixes.
- [Verify BACKWARD_LOOP]: When the gap between spec and implementation is structural or the task spec is fundamentally flawed, the `qrspi-fast-impl-verify` agent returns `### Route Hint — BACKWARD_LOOP` with a detailed analysis of why replanning is required.
- [Verify missing files]: When a file listed in the task spec's `## Files` manifest does not exist, the agent reports it as MISSING in `### Files Verified` and returns at minimum CODE_REPAIR.
- [Verify no tests exist]: When the project has no test runner or no tests relevant to the task, the agent returns `### Status — FAIL` with an explanation that verification cannot proceed without testable assertions.
- [Verify evidence classification]: When at least one test passes deterministically and maps to an acceptance criterion, the agent reports DETERMINISTIC evidence. When all tests are FLAKY, AMBIGUOUS, or REDUNDANT with no clear spec mapping, the agent treats this as a TEST_REPAIR condition.
- [Simplify dead code]: When the `qrspi-simplify-pass` agent reads implementation files containing unused imports, unreachable code paths, or stale TODOs, it removes them and the resulting files still pass all existing tests.
- [Simplify duplication]: When the `qrspi-simplify-pass` agent finds identical or near-identical logic blocks across files, it consolidates them into a shared definition, updates call sites, and the resulting files still pass all existing tests.
- [Simplify readability]: When the `qrspi-simplify-pass` agent finds cryptic names, deeply nested logic, or long functions, it applies renames and extractions that do not change observable behavior, and existing tests continue to pass.
- [Simplify preserves behavior]: When a potential simplification would change an exported function signature or alter observable behavior, the `qrspi-simplify-pass` agent skips it and reports the skipped change with a reason in `### Simplifications Skipped`.
- [Simplify preserves tests]: After applying all simplifications, the `qrspi-simplify-pass` agent re-runs the test suite. If any test fails post-simplification, the agent reverts the offending change and reports it as skipped.
- [Simplify no-op]: When the codebase is already clean with no dead code, duplication, or readability issues, the `qrspi-simplify-pass` agent returns `### Status — PASS` with `### Files Simplified` showing zero changes and a summary indicating no simplifications were needed.
- [Agent frontmatter]: Both agent `.md` files begin with valid YAML frontmatter (delimited by `---`) containing `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions` fields with the values specified above. The frontmatter is parseable by pi-subagents' agent type loader.
- [Agent prompt body]: Both agent `.md` files contain a system prompt body after the frontmatter that describes the agent's role, responsibilities, dispatch context (expected input headers), process steps, and return contract format.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
