# QRSPI Agent Inventory

This inventory tracks the deterministic TypeScript migration. Orchestration logic was moved from markdown agents into `src/application/stage/`; the 36 markdown leaf prompts in `agents/` remain as prompt payloads dispatched by the runtime.

- `Delete` means the agent carried orchestration logic (`tools: subagent`) that is now implemented in TypeScript.
- `Keep` means the file remains a markdown prompt payload dispatched by the runtime.
- The old `general-purpose` worker was never bundled in this repo, so it is not listed here. Its role is now a plain pi coding session dispatched through the `Dispatcher` port.

| Agent | Stage / Area | Current Role | Cutover | Replacement |
| --- | --- | --- | --- | --- |
| `qrspi-accept` | Stage 7 | Stage orchestrator | Delete | `src/application/stage/accept.ts` |
| `qrspi-acceptance-tester` | Stage 7 | Acceptance sub-orchestrator | Delete | `src/application/stage/acceptance-tester.ts` |
| `qrspi-backward-loop-detector` | Stage 7 | Backward-loop classifier leaf | Keep | Markdown prompt |
| `qrspi-baseline-checker` | Stage 5 | Baseline leaf checker | Keep | Markdown prompt |
| `qrspi-baseline-regression-checker` | Stage 6 | Baseline regression orchestrator | Delete | `src/application/stage/baseline-regression.ts` |
| `qrspi-code-review` | Stage 6 | Review fanout sub-orchestrator | Delete | `src/application/stage/code-review.ts` |
| `qrspi-codebase-researcher` | Stage 2 | Codebase research leaf | Keep | Markdown prompt |
| `qrspi-coverage-planner` | Stage 7 | Coverage planning leaf | Keep | Markdown prompt |
| `qrspi-design` | Stage 3 | Stage orchestrator | Delete | `src/application/stage/design.ts` |
| `qrspi-design-reviewer` | Stage 3 | Design review leaf | Keep | Markdown prompt |
| `qrspi-design-synthesizer` | Stage 3 | Design synthesis leaf | Keep | Markdown prompt |
| `qrspi-e2e-regression-checker` | Stage 6 | E2E regression orchestrator | Delete | `src/application/stage/e2e-regression.ts` |
| `qrspi-fast-impl-code` | Stage 6 | TDD inner-loop orchestrator | Delete | `src/application/stage/fast-impl-code.ts` |
| `qrspi-fast-impl-loop` | Stage 6 | TDD inner-loop orchestrator | Delete | `src/application/stage/fast-impl-loop.ts` |
| `qrspi-fast-impl-test` | Stage 6 | TDD inner-loop orchestrator | Delete | `src/application/stage/fast-impl-test.ts` |
| `qrspi-fast-impl-verify` | Stage 6 | TDD inner-loop orchestrator | Delete | `src/application/stage/fast-impl-verify.ts` |
| `qrspi-goals` | Stage 1 | Stage orchestrator | Delete | `src/application/stage/goals.ts` |
| `qrspi-goals-interviewer` | Stage 1 | Adaptive interview leaf (new, not a reintroduced orchestrator) | Keep | Markdown prompt |
| `qrspi-goals-reviewer` | Stage 1 | Goals review leaf | Keep | Markdown prompt |
| `qrspi-goals-synthesizer` | Stage 1 | Goals synthesis leaf | Keep | Markdown prompt |
| `qrspi-implement` | Stage 6 | Stage orchestrator | Delete | `src/application/stage/implement.ts` |
| `qrspi-integration-checker` | Stage 6 | Integration check leaf | Keep | Markdown prompt |
| `qrspi-plan` | Stage 5 | Stage orchestrator | Delete | `src/application/stage/plan.ts` |
| `qrspi-plan-reviewer` | Stage 5 | Plan review leaf | Keep | Markdown prompt |
| `qrspi-plan-writer` | Stage 5 | Plan writing leaf | Keep | Markdown prompt |
| `qrspi-question-generator` | Stage 2 | Question generation leaf | Keep | Markdown prompt |
| `qrspi-question-leakage-reviewer` | Stage 2 | Question leakage review leaf | Keep | Markdown prompt |
| `qrspi-question-quality-reviewer` | Stage 2 | Question quality review leaf | Keep | Markdown prompt |
| `qrspi-questions` | Stage 2 | Question-batch orchestrator | Delete | `src/application/stage/questions.ts` |
| `qrspi-report` | Stage 10 | Stage orchestrator | Delete | `src/application/stage/report.ts` |
| `qrspi-replan` | Stage 8 | Stage orchestrator | Delete | `src/application/stage/replan.ts` |
| `qrspi-replan-reviewer` | Stage 8 | Replan review leaf | Keep | Markdown prompt |
| `qrspi-replan-writer` | Stage 8 | Replan writing leaf | Keep | Markdown prompt |
| `qrspi-reporter` | Stage 10 | Final report leaf | Keep | Markdown prompt |
| `qrspi-research` | Stage 2 | Stage orchestrator | Delete | `src/application/stage/research.ts` |
| `qrspi-research-pass` | Stage 2 | Research-pass orchestrator | Delete | `src/application/stage/research-pass.ts` |
| `qrspi-research-reviewer` | Stage 2 | Research review leaf | Keep | Markdown prompt |
| `qrspi-research-synthesizer` | Stage 2 | Research synthesis leaf | Keep | Markdown prompt |
| `qrspi-review-accept-code-quality` | Stage 7 | Acceptance review leaf | Keep | Markdown prompt |
| `qrspi-review-accept-goal-traceability` | Stage 7 | Acceptance review leaf | Keep | Markdown prompt |
| `qrspi-review-accept-spec` | Stage 7 | Acceptance review leaf | Keep | Markdown prompt |
| `qrspi-review-code-quality` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-review-code-simplifier` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-review-goal-traceability` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-review-security` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-review-silent-failure` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-review-test-coverage` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-review-test-quality` | Stage 6 | Code review leaf | Keep | Markdown prompt |
| `qrspi-structure` | Stage 4 | Stage orchestrator | Delete | `src/application/stage/structure.ts` |
| `qrspi-structure-mapper` | Stage 4 | Structure mapping leaf | Keep | Markdown prompt |
| `qrspi-structure-reviewer` | Stage 4 | Structure review leaf | Keep | Markdown prompt |
| `qrspi-task-spec-reviewer` | Stage 5 | Task-spec review leaf | Keep | Markdown prompt |
| `qrspi-task-spec-writer` | Stage 5 | Task-spec writing leaf | Keep | Markdown prompt |
| `qrspi-verifier` | Stage 9 | Verification leaf | Keep | Markdown prompt |
| `qrspi-verify` | Stage 9 | Stage orchestrator | Delete | `src/application/stage/verify.ts` |
| `qrspi-web-researcher` | Stage 2 | Web research leaf | Keep | Markdown prompt |

Totals:

- Delete: 20
- Keep: 36
