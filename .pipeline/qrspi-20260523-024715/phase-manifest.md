---
total_phases: 4
---

## Phase 1 — Foundation + Goals (Stage 1) ✅ COMPLETED
- **Tasks:** 01, 02, 03, 04, 05, 06, 07, 08
- **Acceptance Criteria:** AC 1 (partial — Stage 1 E2E), AC 5 (partial — pipeline helpers and shared tools), AC 6 (Stage 1 artifacts), AC 8 (partial — package manifest)
- **Replan Gate Outcome:** PASS. Extension installs, `/deepwork` command is registered, orchestrator skill injects. Stage-1 scaffolding executes: `.pipeline/qrspi-<run-id>/` directory created with valid `state.md` (all 10 fields), `telemetry/events.jsonl`, git branch `qrspi/<run-id>`. Git-unavailable fallback works. Runtime artifacts (goals.md, config.md, requirements.md, review artifacts) deferred to Phase 4 integration testing.
- **Evidence:** 370 DETERMINISTIC tests, 8/8 CLEAN reviews, integration PASS, acceptance 4/4.
- **Established Conventions:** Explicit tool lists in frontmatter (orchestrators include `qrspi_dispatch, qrspi_question`); synthesizers use `read, bash, grep, find, ls, write, edit`; reviewers use `read, bash, grep, find, ls`; all agents use `prompt_mode: replace`, `extensions: false`.

## Phase 2 — Planning Pipeline (Stages 2–6)
- **Tasks:** 09, 10, 11, 12, 13
- **Acceptance Criteria:** AC 6 (Stages 2–6 agent types completed), AC 7 (partial — model tier frontmatter applied)
- **Replan Gate:** All 18 planning-stage agent type `.md` files (Stages 2–6) are converted from opencode sources with correct YAML frontmatter per the conversion tables. Each agent file is structurally valid (frontmatter parseable, system prompt body present, dispatch contracts preserved). Review loop logic and synthesizer dispatch patterns are intact. Tool lists use explicit enumeration consistent with Phase 1 convention (no `tools: all`). Orchestrator agents include `qrspi_dispatch` and `qrspi_question` in their `tools` field when they dispatch subagents or run human gates.

## Phase 3 — Implementation Loop (Stages 7–8.5)
- **Tasks:** 14, 15, 16, 17, 18, 19, 20
- **Acceptance Criteria:** AC 4 (partial — replan agent types), AC 6 (Stages 7–8.5 agent types completed), AC 7 (partial — model tier frontmatter applied)
- **Replan Gate:** All 27 implementation-loop agent type `.md` files are converted. Fast-impl inner loop agents (code → test → verify → simplify) are correctly configured. Code review orchestrator plus 7 review lenses are in place. Acceptance testing agents (accept, tester, coverage planner, 3 accept-review lenses) are converted. Backward loop detector, replan orchestrator, replan writer, and replan reviewer agents are in place. Tool lists follow Phase 1 explicit enumeration convention.

## Phase 4 — Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix)
- **Tasks:** 21, 22, 23, 24, 25
- **Acceptance Criteria:** AC 1 (full pipeline E2E), AC 2 (resume), AC 3 (quick-fix), AC 4 (backward loop), AC 5 (error handling), AC 6 (all 10 stages), AC 7 (model tiers), AC 8 (installability)
- **Replan Gate:** Integration tests pass: full 10-stage pipeline produces all prescribed artifacts; `/deepwork-resume` recovers from each stage boundary; quick-fix route completes in fewer stages; backward loop triggers replan and pipeline revisits Plan stage; error and abort scenarios leave clean state. README documents both install methods. Package verifies via `npm link` into `~/.pi/agent/extensions/`. Model-tier verification confirms haiku-tier agents run as reviewers/leaf agents and sonnet-tier agents run as orchestrators/synthesizers.
