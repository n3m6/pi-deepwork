# Task 25: Model-tier verification (haiku reviewers, sonnet orchestrators)

## Metadata
- **Task:** 25
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 4b — Integration

## Dependencies
- **Task 24 (Package for distribution and install verification):** Requires the completed `agents/` directory containing all 55 agent type `.md` files with valid YAML frontmatter (`model`, `thinking`, `description`, `tools`, `max_turns`, `prompt_mode`, `extensions` fields). Also requires the finalized `src/shared-tools.ts` with the `qrspi_dispatch` tool implementation, which includes the graceful-fallback path when `Symbol.for("pi-subagents:manager")` is undefined.

## Traceability
- **Acceptance Criteria:** AC 7 (model tier assignment verified)
- **NFRs:** NFR: Compatibility (model tier verification)
- **Replan Gate Criteria:** Phase 4 replan gate (Model tiers verified)

## Source Traceability
- **Goals:** AC 7 — Extension works with multiple model tiers: haiku-tier models for reviewer and leaf agents and sonnet-tier models for orchestrator agents
- **Plan:** Task 25, Phase 4 — Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix)
- **Design:** Slice 4b — Integration (Resume, Quick-Fix Route, and Edge Cases)
- **Structure:** Slice 4b — `test/model-tier-verification.test.ts` (CREATE)

## Description
Write a programmatic validation test at `test/model-tier-verification.test.ts` that does two things:

### Part 1: Model-tier frontmatter validation across all 55 agent files
Parse the YAML frontmatter of every `.md` file in the `agents/` directory and verify that the `model` and `thinking` fields match the tier assignments documented in `DEEPWORK.md` and the agent type tables. The 55 agents fall into exactly three model-tier groups:

**SONNET-tier — `model: anthropic/claude-sonnet-4-5` (18 agents):**
1. All 11 stage orchestrators: `qrspi-goals`, `qrspi-questions`, `qrspi-research`, `qrspi-design`, `qrspi-structure`, `qrspi-plan`, `qrspi-implement`, `qrspi-accept`, `qrspi-replan`, `qrspi-verify`, `qrspi-report`. These have `thinking: low`.
2. All 3 code-writer agents with `thinking: medium`: `qrspi-fast-impl-code`, `qrspi-fast-impl-test`, `qrspi-acceptance-tester`.
3. All 4 loop/verification agents with `thinking: medium`: `qrspi-fast-impl-loop`, `qrspi-fast-impl-verify`, `qrspi-simplify-pass`, `qrspi-verifier`.

**HAIKU-tier — `model: anthropic/claude-haiku-4-5`, `thinking: low` (37 agents):**
All remaining agents. This includes every synthesizer, writer, reviewer, researcher, checker, detector, code-review orchestrator, and code-review lens agent:
- Synthesizers/Writers (6): `qrspi-goals-synthesizer`, `qrspi-design-synthesizer`, `qrspi-plan-writer`, `qrspi-task-spec-writer`, `qrspi-replan-writer`, `qrspi-reporter`
- Reviewers (14): `qrspi-goals-reviewer`, `qrspi-question-leakage-reviewer`, `qrspi-question-quality-reviewer`, `qrspi-research-reviewer`, `qrspi-design-reviewer`, `qrspi-structure-reviewer`, `qrspi-plan-reviewer`, `qrspi-task-spec-reviewer`, `qrspi-replan-reviewer`, `qrspi-review-code-quality`, `qrspi-review-security`, `qrspi-review-silent-failure`, `qrspi-review-accept-goal-traceability`, `qrspi-review-accept-spec`
- Researcher/Question agents (6): `qrspi-codebase-researcher`, `qrspi-web-researcher`, `qrspi-research-synthesizer`, `qrspi-question-generator`, `qrspi-structure-mapper`, `qrspi-coverage-planner`
- Code Review agents (4): `qrspi-code-review`, `qrspi-review-test-coverage`, `qrspi-review-test-quality`, `qrspi-review-code-simplifier`
- Checkers (4): `qrspi-baseline-checker`, `qrspi-baseline-regression-checker`, `qrspi-e2e-regression-checker`, `qrspi-integration-checker`
- Acceptance reviewers (2): `qrspi-review-accept-code-quality`, `qrspi-review-goal-traceability`
- Detector (1): `qrspi-backward-loop-detector`

The test must validate:
- Exactly 55 agent `.md` files are found in the `agents/` directory (no missing files, no extra files).
- Every file parses as valid YAML frontmatter with both `model` and `thinking` fields present.
- The 18 sonnet-tier agents listed above each have `model` set to `anthropic/claude-sonnet-4-5`.
- The 37 haiku-tier agents listed above each have `model` set to `anthropic/claude-haiku-4-5`.
- The `thinking` field for all sonnet-tier agents except stage orchestrators is `"medium"`; the 11 stage orchestrators have `thinking: low`.
- The `thinking` field for all haiku-tier agents is `"low"`.
- No agent uses an unrecognized model string, a missing model field, or an unexpected `thinking` value.

### Part 2: qrspi_dispatch graceful fallback test
Verify that the `qrspi_dispatch` tool implementation (in `src/shared-tools.ts`) handles the absence of `@tintinweb/pi-subagents` gracefully. When `Symbol.for("pi-subagents:manager")` evaluates to `undefined` (simulating the package not being installed), `qrspi_dispatch` must return a result containing a human-readable error message that clearly indicates `@tintinweb/pi-subagents` is a required prerequisite. The tool must not throw an uncaught error, crash, or produce a misleading success result.

The fallback test should:
- Import or invoke the `qrspi_dispatch` tool execution path in a context where the manager symbol is absent.
- Confirm the returned content includes text indicating the missing prerequisite (e.g., containing the string `pi-subagents`).
- Confirm no exception propagates out of the tool call.

## Files
- `test/model-tier-verification.test.ts` (CREATE) — Programmatic validation: parse YAML frontmatter from all 55 `agents/*.md` files, verify `model` field matches expected tier per agent category, verify `thinking` field matches design spec (low for reviewers and stage orchestrators, medium for code writers and loop/verification agents), and test `qrspi_dispatch` graceful-fallback when `@tintinweb/pi-subagents` is absent.

## Test Expectations
- **Total agent count**: When the test discovers all agent `.md` files in `agents/`, exactly 55 files are found.
- **Valid frontmatter**: When each `agents/*.md` file is read and its YAML frontmatter parsed, the `model` and `thinking` fields are present and hold string values.
- **Sonnet orchestrators**: When the test checks each of the 11 stage orchestrator agent files (`qrspi-goals`, `qrspi-questions`, `qrspi-research`, `qrspi-design`, `qrspi-structure`, `qrspi-plan`, `qrspi-implement`, `qrspi-accept`, `qrspi-replan`, `qrspi-verify`, `qrspi-report`), the `model` field is `anthropic/claude-sonnet-4-5` and `thinking` is `low`.
- **Sonnet code writers**: When the test checks `qrspi-fast-impl-code`, `qrspi-fast-impl-test`, and `qrspi-acceptance-tester`, the `model` field is `anthropic/claude-sonnet-4-5` and `thinking` is `medium`.
- **Sonnet loop/verification agents**: When the test checks `qrspi-fast-impl-loop`, `qrspi-fast-impl-verify`, `qrspi-simplify-pass`, and `qrspi-verifier`, the `model` field is `anthropic/claude-sonnet-4-5` and `thinking` is `medium`.
- **Haiku reviewers, synthesizers, researchers, checkers**: When the test checks any of the remaining 37 agent files, the `model` field is `anthropic/claude-haiku-4-5` and `thinking` is `low`.
- **No unknown models**: When every agent file has been checked, no agent has a `model` value other than `anthropic/claude-sonnet-4-5` or `anthropic/claude-haiku-4-5`.
- **No unknown thinking levels**: When every agent file has been checked, no agent has a `thinking` value other than `low` or `medium`.
- **qrspi_dispatch fallback message**: When `qrspi_dispatch` is invoked in an environment where `Symbol.for("pi-subagents:manager")` is `undefined`, the returned result contains a message string that includes `pi-subagents` (or the full package name `@tintinweb/pi-subagents`) and no exception is thrown.
- **qrspi_dispatch fallback no crash**: When `qrspi_dispatch` is invoked without the pi-subagents package installed, the call completes normally and does not propagate an unhandled error.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
