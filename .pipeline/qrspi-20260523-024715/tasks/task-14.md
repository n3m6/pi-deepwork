# Task 14: Stage 7 orchestrator and fast-impl agents

## Metadata
- **Task:** 14
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3a — Implement

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 7 core agent types), AC 7 (model tier frontmatter)
- **NFRs:** NFR: Compatibility (model tier)
- **Replan Gate Criteria:** Phase 3 replan gate (Implement agents complete)

## Source Traceability
- **Goals:** AC 6 (all 10 stages produce prescribed artifacts), AC 7 (works with multiple model tiers — haiku-tier for leaf agents, sonnet-tier for orchestrators)
- **Plan:** Task 14, Phase 3 — Implementation Loop
- **Design:** Slice 3a — Fast Implementation Loop (Stage 7 Core)
- **Structure:** Slice 3a — Fast Implementation Loop (Stage 7 Core) — `agents/qrspi-implement.md`, `agents/qrspi-fast-impl-loop.md`, `agents/qrspi-fast-impl-code.md`, `agents/qrspi-fast-impl-test.md`

## Description

Create four Stage 7 agent type `.md` files that form the core implementation loop of the QRSPI deepwork pipeline: the stage orchestrator, the per-task inner-loop driver, the code-writing leaf agent, and the test-writing leaf agent. These agents are ported from their opencode equivalents using the conversion tables documented in `requirements.md`. Every agent file follows the pi agent type convention: YAML frontmatter with `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions` fields, followed by a system prompt body that preserves the original agent's dispatch contracts, invariants, and return format.

### Conversion Rules (opencode → pi)

Apply these conversions to every system prompt body in this task:

| opencode pattern | pi equivalent |
|---|---|
| `Invoke <agent> as a subagent:` | `Use the qrspi_dispatch tool with subagent_type: "<agent>"` |
| `cat .pipeline/...` | `Read .pipeline/...` (read tool) |
| `mkdir -p .pipeline/...` | `bash: mkdir -p .pipeline/...` |
| `date -u +...` | `bash: date -u +...` |
| `question` (tool) | `qrspi_question` (tool) |
| `todowrite` | Available in pi (keep references) |
| `Run ID: qrspi-<timestamp>` | Same — pass verbatim in dispatch prompt |
| `=== RUN ID ===` headers | Same — pass verbatim in dispatch prompt |
| `### Status — PASS/FAIL` returns | Same — parsed from subagent output |
| Stop after subagent dispatch | Same — foreground agents return results inline |

Remove from system prompt bodies: opencode permission system references (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `permission.allowed_paths`, rule 11 allowed-list cross-check logic). Tool access is determined by the `tools` frontmatter field only. Replace any `task` tool invocation pattern with `qrspi_dispatch` tool usage following the mapping above. Keep all pipeline logic, dispatch sequencing, invariant checks, return contract parsing, and gate protocols intact.

### Agent 1: `agents/qrspi-implement.md` — Stage 7 Orchestrator

**Role**: The Stage 7 orchestrator subagent. It reads `plan.md`, `phase-manifest.md`, and per-task spec files (`.pipeline/<run-id>/tasks/task-NN.md`), then drives implementation for each task within the current phase. It is dispatched by the main orchestrator (deepwork skill) via the `Agent` tool with headers containing `=== RUN ID ===`, `=== ROUTE ===`, `=== CURRENT PHASE ===`, and `=== PHASE DIR ===`. For quick-fix runs, the phase directory is hardcoded to `phases/phase-01`. In verify-fix mode (Stage 9 auto-fix), additional headers `=== MODE === verify-fix` and `=== VERIFY FAILURES ===` are provided.

**Responsibilities**:
1. Parse the dispatch headers to extract run ID, route, current phase number, and phase directory.
2. Read `plan.md`, `phase-manifest.md`, and all task specs for the current phase.
3. Process tasks in waves as defined by `plan.md`'s wave analysis.
4. For each task, dispatch `qrspi-fast-impl-loop` via `qrspi_dispatch` with the task spec content and the run ID. Each task runs in a git worktree (created via `bash: git worktree add`) to isolate per-task changes; after task completion, squash-merge the worktree back onto the pipeline branch and remove the worktree.
5. After all tasks in a wave complete, dispatch the checker agents (`qrspi-e2e-regression-checker`, `qrspi-integration-checker`, `qrspi-baseline-regression-checker`) via `qrspi_dispatch` to validate the wave's changes.
6. After all waves complete for the phase, dispatch `qrspi-simplify-pass` via `qrspi_dispatch` to remove dead code, consolidate duplication, and improve readability.
7. Handle verify-fix mode: when `=== MODE === verify-fix` is present, re-dispatch only the failing tasks with repair guidance from `=== VERIFY FAILURES ===`. This mode is capped at two attempts per task; if the second attempt fails, return `### Backward Loop Request` in the return contract.
8. Write implementation files to the phase directory (`phases/phase-NN/`).
9. Return a structured contract containing `### Status`, `### Files Written`, `### Summary`, and optionally `### Backward Loop Request` and `### Telemetry` (single-line JSON).

**YAML Frontmatter**:
```yaml
---
description: "Stage 7 orchestrator — drives per-task implementation, dispatches fast-impl loop, checkers, code review, and simplify pass"
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 150
prompt_mode: replace
extensions: false
---
```

### Agent 2: `agents/qrspi-fast-impl-loop.md` — Fast Implementation Inner Loop

**Role**: The per-task code-first inner loop agent. It is dispatched by `qrspi-implement` (or `qrspi-replan` in replan mode) via `qrspi_dispatch` for a single task. It sequences three leaf agents — `qrspi-fast-impl-code` (write implementation), `qrspi-fast-impl-test` (write tests), and `qrspi-fast-impl-verify` (verify against task spec) — in a defined cycle, and enforces 11 hard invariants that constrain the implementation process.

**11 Invariants** (preserved verbatim from the opencode source):
1. ONE TASK ONLY — never implement more than one task per loop invocation.
2. MAX 8 OUTER CYCLES — if the code → test → verify cycle reaches 8 iterations without a PASS, stop and return `### Route Hint — BACKWARD_LOOP`.
3. STALL DETECTION — if the verify result does not change between two consecutive cycles (same route hint), stop and return `### Route Hint — BACKWARD_LOOP`.
4. READ THE TASK SPEC FIRST — always read the full task spec before beginning implementation.
5. READ EXISTING CODE — examine related source files before writing or modifying code.
6. NEVER SKIP TESTS — the test agent must be dispatched in every cycle; do not skip test writing.
7. HONOR THE ROUTE HINT — after verify, follow the exact route hint returned (PASS → stop, CODE_REPAIR → re-dispatch code, TEST_REPAIR → re-dispatch test, CODE_AND_TEST_REPAIR → re-dispatch both, BACKWARD_LOOP → return to caller).
8. PRESERVE EXISTING PASSING TESTS — new code must not break tests that were passing before this task.
9. INCREMENTAL COMMITS — commit after each successful code+test+verify cycle within the worktree with a message: `qrspi: task <NN> cycle <N> <status>`.
10. CLEAN BUILD — verify that the code compiles or the project builds without errors before dispatching the test agent.
11. TASK ISOLATION — changes are scoped to files listed in the task spec's `## Files` section; no out-of-scope refactoring.

**Responsibilities**:
1. Receive the task spec content and run ID from `qrspi-implement` via the dispatch prompt.
2. Read the task spec to identify the target files, acceptance criteria, and test expectations.
3. Cycle through `qrspi-fast-impl-code` → `qrspi-fast-impl-test` → `qrspi-fast-impl-verify` using `qrspi_dispatch`:
   - Dispatch `qrspi-fast-impl-code` with the task spec and a context label: `fresh` (first attempt), `code-repair` (fixing code after verify FAIL), or `simplify` (post-wave simplification).
   - After code completes, dispatch `qrspi-fast-impl-test` with the task spec and the code changes.
   - After tests complete, dispatch `qrspi-fast-impl-verify` with the task spec, the implementation files, and test results.
   - Parse verify's `### Route Hint` and follow the appropriate path.
4. Enforce iteration budgets: `fresh` context allows up to 3 cycles; `code-repair` context allows up to 2 cycles; `simplify` context allows up to 2 cycles.
5. On `### Route Hint — PASS`, return a structured contract to `qrspi-implement` with `### Status — PASS`, `### Files Written`, `### Test Evidence Class`, and `### Summary`.
6. On `### Route Hint — BACKWARD_LOOP`, return `### Status — FAIL` with `### Route Hint — BACKWARD_LOOP` and a detailed summary of why the loop could not converge.
7. Never exceed the cycle cap or violate stall detection.

**YAML Frontmatter**:
```yaml
---
description: "Per-task fast-impl inner loop — sequences code → test → verify with 11 invariants and cycle caps"
tools: all
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 100
prompt_mode: replace
extensions: false
---
```

### Agent 3: `agents/qrspi-fast-impl-code.md` — Code Writer

**Role**: A leaf agent that writes implementation code for a single task. It is dispatched by `qrspi-fast-impl-loop` via `qrspi_dispatch` and receives the task spec along with a context label (`fresh`, `code-repair`, or `simplify`). It produces the implementation files listed in the task spec's `## Files` section and writes them to the filesystem.

**Iteration Budgets** (preserved from the opencode source):
- `fresh` context: up to 3 attempts before returning FAIL to the caller.
- `code-repair` context: up to 2 attempts before returning FAIL.
- `simplify` context: up to 2 attempts before returning FAIL.

**Responsibilities**:
1. Read the full task spec provided in the dispatch prompt.
2. Read any existing source files referenced by the task spec to understand current code structure.
3. Write the implementation code for each file listed in `## Files` (MODIFY and CREATE entries).
4. Ensure the implementation satisfies every test expectation listed in the task spec's `## Test Expectations` section.
5. After writing, verify the implementation compiles or builds cleanly (run the project's build command via `bash`).
6. Return a structured contract: `### Status — PASS/FAIL`, `### Files Written` (list of modified/created files), and `### Summary`.
7. On FAIL, describe what prevented a clean implementation and suggest next steps.
8. Never modify files outside the `## Files` scope of the task spec.
9. Do not write tests — tests are the responsibility of `qrspi-fast-impl-test`.

**YAML Frontmatter**:
```yaml
---
description: "Code writer — produces implementation files from task specs with iteration budget enforcement"
tools: all
model: anthropic/claude-sonnet-4-5
thinking: medium
max_turns: 50
prompt_mode: replace
extensions: false
---
```

### Agent 4: `agents/qrspi-fast-impl-test.md` — Test Writer

**Role**: A leaf agent that writes tests for code implemented by `qrspi-fast-impl-code`. It is dispatched by `qrspi-fast-impl-loop` via `qrspi_dispatch` and receives the task spec along with the list of files changed by the code writer. It produces test files and classifies test evidence into one of five categories.

**Evidence Classification** (preserved from the opencode source):
- `DETERMINISTIC` — the test passes consistently across multiple runs; deterministic inputs, no timing dependencies.
- `FLAKY` — the test sometimes passes and sometimes fails; may depend on timing, ordering, or external state.
- `HARNESS_NOISY` — the test runner or harness produces warnings or errors unrelated to the test logic (e.g., deprecation warnings, environment issues).
- `AMBIGUOUS` — the test result is unclear; the assertion is vague, the output is not parseable, or the expected behavior is underspecified.
- `REDUNDANT` — the test duplicates existing test coverage without adding new behavioral validation.

**Responsibilities**:
1. Read the task spec and the list of changed files from the code writer.
2. Read existing test files in the project to understand the test framework, conventions, and existing coverage.
3. Write tests for every behavior described in the task spec's `## Test Expectations` section.
4. Run the tests via `bash` to verify they execute and produce results.
5. Classify each test's evidence using one of the five categories above.
6. Report any test that cannot be made to pass deterministically, with the evidence classification and a reason.
7. Return a structured contract: `### Status — PASS/FAIL`, `### Files Written`, `### Test Evidence Class` (e.g., `DETERMINISTIC`, `FLAKY`), and `### Summary`.
8. On FAIL, describe which test expectations could not be satisfied and why.
9. Never modify implementation code — test files only.

**YAML Frontmatter**:
```yaml
---
description: "Test writer — produces tests from task specs with evidence classification"
tools: all
model: anthropic/claude-haiku-4-5
thinking: medium
max_turns: 50
prompt_mode: replace
extensions: false
---
```

## Files
- `agents/qrspi-implement.md` (CREATE) — Stage 7 orchestrator subagent: drives per-task implementation, dispatches fast-impl loop, checkers, code review, and simplify pass. Uses git worktrees per task, handles verify-fix mode, returns structured contract with optional backward loop request. Frontmatter: tools all, max_turns 150, thinking low, model anthropic/claude-sonnet-4-5.
- `agents/qrspi-fast-impl-loop.md` (CREATE) — Per-task inner-loop orchestrator: sequences qrspi-fast-impl-code → qrspi-fast-impl-test → qrspi-fast-impl-verify with 11 invariants (ONE TASK ONLY, MAX 8 OUTER CYCLES, STALL DETECTION, etc.), enforces iteration budgets per context, routes post-verify failures via Route Hint. Frontmatter: tools all, max_turns 100, thinking medium, model anthropic/claude-sonnet-4-5.
- `agents/qrspi-fast-impl-code.md` (CREATE) — Code-writing leaf agent: produces implementation files from task specs, enforces iteration budget (fresh=3, code-repair=2, simplify=2), verifies build succeeds before returning. Frontmatter: tools all, max_turns 50, thinking medium, model anthropic/claude-sonnet-4-5.
- `agents/qrspi-fast-impl-test.md` (CREATE) — Test-writing leaf agent: produces test files from task specs, classifies test evidence as DETERMINISTIC, FLAKY, HARNESS_NOISY, AMBIGUOUS, or REDUNDANT. Frontmatter: tools all, max_turns 50, thinking medium, model anthropic/claude-haiku-4-5.

## Test Expectations
- **Valid YAML frontmatter in all four agent files**: When each agent file is parsed by a YAML frontmatter parser, expect all required fields (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`) to be present with values matching the specification: `qrspi-implement` (tools all, model sonnet, thinking low, max_turns 150), `qrspi-fast-impl-loop` (tools all, model sonnet, thinking medium, max_turns 100), `qrspi-fast-impl-code` (tools all, model sonnet, thinking medium, max_turns 50), `qrspi-fast-impl-test` (tools all, model haiku, thinking medium, max_turns 50).
- **Model tier frontmatter reflects AC 7**: When inspecting the four agent files, expect `qrspi-implement` and `qrspi-fast-impl-loop` (orchestrators) to use `model: anthropic/claude-sonnet-4-5`, and `qrspi-fast-impl-test` (leaf agent) to use `model: anthropic/claude-haiku-4-5`. `qrspi-fast-impl-code` uses sonnet-tier reflecting its role as a code-writing agent (medium thinking).
- **qrspi-implement contains full workflow**: When reading `qrspi-implement.md`, expect the system prompt to describe reading `plan.md` + `phase-manifest.md` + task specs, dispatching `qrspi-fast-impl-loop` per task via `qrspi_dispatch`, creating git worktrees per task, dispatching checkers after wave completion, dispatching `qrspi-simplify-pass` after all waves, handling verify-fix mode, and returning a structured contract with `### Status`, `### Files Written`, `### Summary`, and optional `### Backward Loop Request`.
- **qrspi-fast-impl-loop contains all 11 invariants**: When reading `qrspi-fast-impl-loop.md`, expect the system prompt to enumerate exactly 11 invariants including ONE TASK ONLY, MAX 8 OUTER CYCLES, STALL DETECTION, HONOR THE ROUTE HINT, READ THE TASK SPEC FIRST, READ EXISTING CODE, NEVER SKIP TESTS, PRESERVE EXISTING PASSING TESTS, INCREMENTAL COMMITS, CLEAN BUILD, and TASK ISOLATION.
- **qrspi-fast-impl-loop dispatches in correct sequence**: When reading `qrspi-fast-impl-loop.md`, expect the system prompt to describe dispatching `qrspi-fast-impl-code` first, then `qrspi-fast-impl-test`, then `qrspi-fast-impl-verify`, using `qrspi_dispatch` for each leaf agent.
- **qrspi-fast-impl-code enforces iteration budgets**: When reading `qrspi-fast-impl-code.md`, expect the system prompt to define iteration caps: fresh context max 3 attempts, code-repair context max 2 attempts, simplify context max 2 attempts.
- **qrspi-fast-impl-test classifies evidence into five categories**: When reading `qrspi-fast-impl-test.md`, expect the system prompt to define and use all five evidence classifications: DETERMINISTIC, FLAKY, HARNESS_NOISY, AMBIGUOUS, and REDUNDANT.
- **No opencode permission artifacts**: When reading any of the four agent files, expect zero occurrences of opencode-specific permission fields (`permission.edit`, `permission.bash`, `permission.task`, `permission.webfetch`, `permission.question`, `permission.todowrite`, `permission.allowed_paths`, rule 11 allowed-list cross-check) in the system prompt body. The `task` tool pattern is replaced with `qrspi_dispatch` / `Agent` tool dispatch language.
- **All four agent files are structurally complete**: When each `.md` file is opened, expect a valid YAML frontmatter delimited by `---`, followed by a system prompt body containing at least 20 lines of agent-specific instructions, ending without extraneous content. No placeholder text (TBD, TODO, "details omitted") appears in the final system prompt body.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
