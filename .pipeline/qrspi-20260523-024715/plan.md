# Implementation Plan

## Overview
This plan implements the deepwork-pi extension, a pi extension that automates the QRSPI deepwork pipeline (Goals through Report, 10 stages, 55 specialized subagents) via pi's subagent architecture. The work is organized into four phases following the design's vertical slices: Phase 1 delivers the extension foundation plus Stage 1 (Goals) end-to-end, proving the extension loads, registers commands/tools, injects the orchestrator skill, and dispatches stage orchestrator subagents. Phase 2 converts all planning-stage agent types (Stages 2–6), Phase 3 converts the implementation-loop agent types (Stages 7–8.5), and Phase 4 delivers completion stages (9–10), integration testing, resume/quick-fix handling, and distribution packaging.

The orchestrator skill (`skills/deepwork/SKILL.md`) is ported from the 927-line opencode `deepwork.md` agent prompt in a single task during Phase 1 — it must be complete enough to cover all 10 stages, resume protocol, quick-fix route, backward loop protocol, and telemetry from the start. Later phases add tests and the remaining agent types it dispatches. All 55 agent type `.md` files are ported from their opencode equivalents using the conversion tables documented in `DEEPWORK.md`, following pi's YAML frontmatter convention (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`).

## Phase Summary
- **Phase 1:** Foundation + Goals (Stage 1) — Extension loads, `/deepwork` command registers, orchestrator skill injects, Stage 1 executes end-to-end producing `goals.md`, `config.md`, `requirements.md`, and review artifacts in `.pipeline/qrspi-<run-id>/`.
- **Phase 2:** Planning Pipeline (Stages 2–6) — All planning-stage agent types converted (18 agents spanning questions, research, design, structure, and plan stages). Review loops and synthesizer dispatch patterns preserved.
- **Phase 3:** Implementation Loop (Stages 7–8.5) — Implementation, code review, acceptance, and backward-loop agent types converted (27 agents). Covers fast-impl inner loop, checkers, review lenses, and replan.
- **Phase 4:** Completion + Edge Cases (Stages 9–10, Resume, Quick-Fix) — Final stage agents, integration tests for full pipeline E2E, resume, quick-fix, backward loop, error handling, README, distribution packaging, and model-tier verification.

## Task Order
| # | Task | Dependencies | Phase | Slice |
|---|------|-------------|-------|-------|
| 01 | Project scaffolding and package manifest | — | 1 | Foundation |
| 02 | TypeScript type definitions (`src/types/pi-extensions.ts`) | 01 | 1 | Foundation |
| 03 | Pipeline helper functions (`src/pipeline.ts`) | 02 | 1 | Foundation |
| 04 | Shared tool implementations (`src/shared-tools.ts`) | 03 | 1 | Foundation |
| 05 | Extension entry point (`src/index.ts`) | 04 | 1 | Foundation |
| 06 | Orchestrator skill (`skills/deepwork/SKILL.md`) | 01 | 1 | Foundation |
| 07 | Stage 1 agent types (Goals) | 01 | 1 | Slice 1 |
| 08 | Foundation and Stage 1 tests | 05, 06, 07 | 1 | Foundation |
| 09 | Stage 2 agent types (Questions) | — | 2 | Slice 2a |
| 10 | Stage 3 agent types (Research) | — | 2 | Slice 2b |
| 11 | Stage 4 agent types (Design) | — | 2 | Slice 2c |
| 12 | Stage 5 agent types (Structure) | — | 2 | Slice 2d |
| 13 | Stage 6 agent types (Plan) | — | 2 | Slice 2e |
| 14 | Stage 7 orchestrator and fast-impl agents | — | 3 | Slice 3a |
| 15 | Stage 7 verification and simplification agents | — | 3 | Slice 3a |
| 16 | Stage 7 checker agents | — | 3 | Slice 3b |
| 17 | Code review orchestrator and quality/security lenses | — | 3 | Slice 3c |
| 18 | Code review coverage, goal, and simplifier lenses | — | 3 | Slice 3c |
| 19 | Stage 8 acceptance agents | — | 3 | Slice 3d |
| 20 | Backward loop and replan agents | — | 3 | Slice 3e |
| 21 | Stage 9–10 agent types (Verify and Report) | — | 4 | Slice 4a |
| 22 | Integration tests (E2E pipeline, resume, quick-fix, backward loop, error handling) | 08, 13, 20, 21 | 4 | Slice 4b |
| 23 | README and installation documentation | 01 | 4 | Slice 4b |
| 24 | Package for distribution and install verification | 05, 23 | 4 | Slice 4b |
| 25 | Model-tier verification (haiku reviewers, sonnet orchestrators) | 24 | 4 | Slice 4b |

## Wave Analysis
- **Wave 1** (no dependencies): Task 01
- **Wave 2** (depends on Wave 1): Tasks 02, 06, 07
- **Wave 3** (depends on Task 02): Task 03
- **Wave 4** (depends on Task 03): Task 04
- **Wave 5** (depends on Task 04): Task 05
- **Wave 6** (depends on Tasks 05, 06, 07): Task 08
- **Wave 7** (Phase 2, no code dependencies — all proceed in parallel after Phase 1 gate): Tasks 09, 10, 11, 12, 13
- **Wave 8** (Phase 3, no code dependencies — all proceed in parallel after Phase 2 gate): Tasks 14, 15, 16, 17, 18, 19, 20
- **Wave 9** (Phase 4 entry, no code dependencies): Tasks 21, 23
- **Wave 10** (depends on Phase 3 agents + Phase 1 tests): Task 22
- **Wave 11** (depends on extension entry point and README): Task 24
- **Wave 12** (depends on packaging): Task 25

## Coverage Notes
- **AC 1** (`/deepwork` starts full 10-stage pipeline) → Tasks 05, 06, 22
- **AC 2** (`/deepwork-resume` resumes from state.md) → Tasks 05, 06, 22
- **AC 3** (Quick-fix route skips stages) → Tasks 06, 22
- **AC 4** (Backward loop triggers replan) → Tasks 06, 20, 22
- **AC 5** (Error handling and abortion → clean state) → Tasks 03, 04, 05, 06, 22
- **AC 6** (All 10 stages produce prescribed artifacts) → Tasks 06, 07, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22
- **AC 7** (Works with multiple model tiers) → Tasks 06, 07, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 25
- **AC 8** (Installable via npm symlink and `pi install git:`) → Tasks 01, 23, 24
- **NFR: Reliability** (clean state recovery on error/abort) → Tasks 03, 05, 06, 22
- **NFR: Compatibility** (multiple model tiers, graceful pi-subagents absence) → Tasks 04, 06, 25
- **NFR: Installability** (npm symlink + pi install) → Tasks 01, 24
- **NFR: Usability** (single `/deepwork "task"` prompt) → Task 06
- **NFR: Observability** (telemetry events, run-log, metrics) → Tasks 03, 06
- **NFR: Performance** (sequential foreground orchestrators) → Task 06
- **Replan gate: Phase 1** (Extension loads, Stage 1 E2E) → Tasks 01, 02, 03, 04, 05, 06, 07, 08
- **Replan gate: Phase 2** (All planning artifacts produced, review loops working) → Tasks 09, 10, 11, 12, 13
- **Replan gate: Phase 3** (Code artifacts, acceptance, backward loop trigger) → Tasks 14, 15, 16, 17, 18, 19, 20
- **Replan gate: Phase 4** (Full 10-stage completion, resume, quick-fix) → Tasks 21, 22, 23, 24, 25
- **Structure: `src/index.ts`** (MODIFY) → Task 05
- **Structure: `src/pipeline.ts`** (CREATE) → Task 03
- **Structure: `src/shared-tools.ts`** (CREATE) → Task 04
- **Structure: `src/types/pi-extensions.ts`** (CREATE) → Task 02
- **Structure: `skills/deepwork/SKILL.md`** (CREATE) → Task 06
- **Structure: `package.json`** (MODIFY) → Task 01
- **Structure: `tsconfig.json`** (MODIFY if needed) → Task 01
- **Structure: `test/index.test.ts`** (CREATE, replaces `test/index.test.js` DELETE) → Task 08
- **Structure: `test/shared-tools.test.ts`** (CREATE) → Task 08
- **Structure: `test/pipeline-helpers.test.ts`** (CREATE) → Task 08
- **Structure: `test/agents/qrspi-goals.test.ts`** (CREATE) → Task 08
- **Structure: `test/integration.test.ts`** (CREATE) → Task 22
- **Structure: `test/model-tier-verification.test.ts`** (CREATE) → Task 25
- **Structure: `agents/qrspi-*.md`** (CREATE × 55) → Tasks 07, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21
