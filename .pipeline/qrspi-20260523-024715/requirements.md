# Deepwork Extension for Pi — Implementation Plan

## Overview

A pi extension that automates the QRSPI deepwork pipeline (Goals → Questions → Research → Design → Structure → Plan → Implement → Accept-Test → Replan → Verify → Report) via subagents, initiated with a single `/deepwork` prompt.

## Architecture

```
User → /deepwork "task" → Extension injects orchestrator skill → Main pi agent becomes orchestrator
                                                                    │
                    ┌───────────────────────────────────────────────┘
                    ▼
   Orchestrator (main pi agent) uses Agent tool to dispatch stage orchestrators
                    │
     ┌──────────────┼──────────────┬─────────────────┐──── ... ────┐
     ▼              ▼              ▼                 ▼              ▼
  qrspi-goals   qrspi-questions  qrspi-research    ...     qrspi-report
  (subagent)    (subagent)       (subagent)               (subagent)
     │              │              │
     ▼              ▼              ▼
  qrspi-goals-  qrspi-question-  qrspi-codebase-
  synthesizer   generator        researcher ...
  (subagent)    (subagent)       (subagent)

Pipeline state flows through: .pipeline/qrspi-<run-id>/*.md files
```

### Design Decisions

| Concern | Decision |
|---|---|
| Orchestrator | Main pi agent becomes the orchestrator via injected skill |
| Stage orchestration | `Agent` tool (foreground) from `@tintinweb/pi-subagents` |
| Sub-subagent spawning | Custom `qrspi_dispatch` tool bypasses the Agent tool block |
| User interaction | Custom `qrspi_question` tool wrapping `ctx.ui` |
| System prompts | pi agent types in `.pi/agents/*.md` with YAML frontmatter |
| Pipeline state | Full file-based protocol: `.pipeline/qrspi-<run-id>/` |
| Tool permissions | Approximated via `tools` + `disallowed_tools` frontmatter |
| Telemetry | Simplified — orchestrator writes to `.pipeline/<run-id>/telemetry/` |

---

## Directory Structure

```
deepwork-pi/
├── package.json                          # Extension metadata + dependencies
├── src/
│   ├── index.ts                          # Extension entry: registers /deepwork command, tools, skill
│   ├── pipeline.ts                       # Run ID gen, .pipeline/ dir creation, git branch setup
│   └── shared-tools.ts                   # qrspi_dispatch + qrspi_question tools
├── agents/                               # ~55 agent types (.md files with YAML frontmatter)
│   ├── deepwork.md                       # Orchestrator agent type
│   ├── qrspi-goals.md                    # Stage 1: orchestrator
│   ├── qrspi-goals-synthesizer.md        # Stage 1: leaf
│   ├── qrspi-goals-reviewer.md           # Stage 1: leaf
│   ├── qrspi-questions.md                # Stage 2: orchestrator
│   ├── qrspi-question-generator.md       # Stage 2: leaf
│   ├── qrspi-question-leakage-reviewer.md# Stage 2: leaf
│   ├── qrspi-question-quality-reviewer.md# Stage 2: leaf
│   ├── qrspi-research.md                 # Stage 3: orchestrator
│   ├── qrspi-codebase-researcher.md      # Stage 3: leaf
│   ├── qrspi-web-researcher.md           # Stage 3: leaf
│   ├── qrspi-research-synthesizer.md     # Stage 3: leaf
│   ├── qrspi-research-reviewer.md        # Stage 3: leaf
│   ├── qrspi-design.md                   # Stage 4: orchestrator
│   ├── qrspi-design-synthesizer.md       # Stage 4: leaf
│   ├── qrspi-design-reviewer.md          # Stage 4: leaf
│   ├── qrspi-structure.md                # Stage 5: orchestrator
│   ├── qrspi-structure-mapper.md         # Stage 5: leaf
│   ├── qrspi-structure-reviewer.md       # Stage 5: leaf
│   ├── qrspi-plan.md                     # Stage 6: orchestrator
│   ├── qrspi-plan-writer.md              # Stage 6: leaf
│   ├── qrspi-task-spec-writer.md         # Stage 6: leaf
│   ├── qrspi-task-spec-reviewer.md       # Stage 6: leaf
│   ├── qrspi-plan-reviewer.md            # Stage 6: leaf
│   ├── qrspi-baseline-checker.md         # Stage 6: leaf
│   ├── qrspi-implement.md                # Stage 7: orchestrator
│   ├── qrspi-fast-impl-loop.md           # Stage 7: leaf
│   ├── qrspi-fast-impl-code.md           # Stage 7: leaf
│   ├── qrspi-fast-impl-test.md           # Stage 7: leaf
│   ├── qrspi-fast-impl-verify.md         # Stage 7: leaf
│   ├── qrspi-e2e-regression-checker.md   # Stage 7: leaf
│   ├── qrspi-integration-checker.md      # Stage 7: leaf
│   ├── qrspi-baseline-regression-checker.md # Stage 7: leaf
│   ├── qrspi-simplify-pass.md            # Stage 7: leaf
│   ├── qrspi-code-review.md              # Shared: code review orchestrator
│   ├── qrspi-review-code-quality.md      # Code review lens
│   ├── qrspi-review-security.md          # Code review lens
│   ├── qrspi-review-silent-failure.md    # Code review lens
│   ├── qrspi-review-test-coverage.md     # Code review lens
│   ├── qrspi-review-test-quality.md      # Code review lens
│   ├── qrspi-review-code-simplifier.md   # Code review lens
│   ├── qrspi-review-goal-traceability.md # Code review lens
│   ├── qrspi-accept.md                   # Stage 8: orchestrator
│   ├── qrspi-acceptance-tester.md        # Stage 8: leaf
│   ├── qrspi-coverage-planner.md         # Stage 8: leaf
│   ├── qrspi-review-accept-goal-traceability.md # Stage 8: leaf
│   ├── qrspi-review-accept-spec.md       # Stage 8: leaf
│   ├── qrspi-review-accept-code-quality.md # Stage 8: leaf
│   ├── qrspi-backward-loop-detector.md   # Stage 8: leaf
│   ├── qrspi-replan.md                   # Stage 8.5: orchestrator
│   ├── qrspi-replan-writer.md            # Stage 8.5: leaf
│   ├── qrspi-replan-reviewer.md          # Stage 8.5: leaf
│   ├── qrspi-verify.md                   # Stage 9: orchestrator
│   ├── qrspi-verifier.md                 # Stage 9: leaf
│   ├── qrspi-report.md                   # Stage 10: orchestrator
│   └── qrspi-reporter.md                 # Stage 10: leaf
└── skills/
    └── deepwork/
        └── SKILL.md                      # Orchestrator prompt (adapted from deepwork.md)
```

---

## Source: `src/index.ts` — Extension Entry Point

Registers:
- **`/deepwork "task description"`** — Starts a new pipeline run
- **`/deepwork-resume <run-id>`** — Resumes an existing pipeline run
- **`qrspi_dispatch` tool** — Wraps pi-subagents `AgentManager` for sub-subagent spawning
- **`qrspi_question` tool** — Presents user questions via `ctx.ui`
- **`deepwork` skill** — Injected orchestrator prompt via `resources_discover`

### `/deepwork` command flow

```
1. Validate task description (ask if empty/vague)
2. Generate run ID: qrspi-YYYYMMDD-HHMMSS
3. mkdir -p .pipeline/<run-id>/telemetry
4. git checkout -b qrspi/<run-id> main
5. Write initial state.md (YAML frontmatter)
6. Write empty events.jsonl
7. Inject deepwork skill (orchestrator prompt) into current session
8. Send kickoff message: "=== RUN ID === <run-id> === USER TASK === <task>"
9. Main agent begins executing the pipeline
```

### `/deepwork-resume <run-id>` command flow

```
1. Validate run ID exists
2. Read .pipeline/<run-id>/state.md
3. Inject deepwork skill
4. Send resume message: "Resume <run-id> from stage <next_stage>"
```

---

## Source: `src/pipeline.ts` — Pipeline Helpers

```typescript
// Pure helpers, no side effects
export function generateRunId(): string { ... }  // qrspi-YYYYMMDD-HHMMSS
export function getPipelineDir(runId: string): string { ... }  // .pipeline/<runId>
```

Utilities for:
- Run ID generation from timestamp
- Pipeline directory path construction
- Git branch name construction (`qrspi/<runId>`)
- State file templates (YAML frontmatter)
- Event templates (telemetry JSONL entries)

---

## Source: `src/shared-tools.ts` — Custom Tools

### `qrspi_dispatch` tool

Wraps pi-subagents `AgentManager` (accessed via `Symbol.for("pi-subagents:manager")`) so stage orchestrator subagents can spawn leaf subagents. The built-in `Agent` tool is blocked in subagents, but this custom tool bypasses that restriction.

```typescript
parameters: {
  subagent_type: string,     // Agent type name
  prompt: string,             // Task for the subagent
  description: string,        // 3-5 word summary
  model?: string,             // Optional model override
  thinking?: string,          // Optional thinking level
  max_turns?: number,         // Optional turn limit
  run_in_background?: boolean // Default: false (foreground)
}
```

Behaviour:
- Foreground mode: spawns via `AgentManager.spawnAndWait()`, returns result text
- Background mode: spawns via `AgentManager.spawn()`, returns agent ID
- Falls back gracefully if pi-subagents is not installed

### `qrspi_question` tool

Presents interactive questions to the user via `ctx.ui`.

```typescript
parameters: {
  header: string,              // Short label (max 30 chars)
  message: string,             // Full question text
  options: string[],           // Available choices
  type: "confirm" | "select"   // Question type
}
```

Behaviour:
- `confirm`: presents yes/no via `ctx.ui.confirm()`
- `select`: presents multiple choices via `ctx.ui.select()`
- Returns the user's selection as text

---

## Agent Type Configurations

### Conversion Rules (opencode → pi)

| opencode field | pi frontmatter | Notes |
|---|---|---|
| `description` | `description` | Direct mapping |
| `mode: subagent` | N/A | All pi agents are subagent-style |
| `hidden: true` | `enabled: false` in listing, but spawnable by orchestrator |
| `steps: N` | `max_turns: N` | Approximate turn limit |
| `temperature: 0.1` | N/A | pi handles temperature differently |
| `permission.edit: allow` | `tools: all` (write/edit included) | |
| `permission.edit: deny` | `tools: read, bash, grep, find, ls` | |
| `permission.bash: "*"` | `tools: read, bash, grep, find, ls, write, edit` | |
| `permission.bash: "grep *"` | `tools: read, bash, grep, find, ls` | |
| `permission.task: "qrspi-*"` | N/A | Uses `qrspi_dispatch` tool instead |
| `permission.webfetch: deny` | `extensions: false` | |
| `permission.question: allow` | N/A | Uses `qrspi_question` tool |
| `permission.todowrite: allow` | N/A | pi has built-in task tracking |

### System Prompt Body Adaptations

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

### Agent Type Categories and Configs

#### Stage Orchestrators (11 agents)

Read/write pipeline files, dispatch leaf subagents, handle review loops.

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-goals | all 7 | 80 | low |
| qrspi-questions | all 7 | 35 | low |
| qrspi-research | all 7 | 60 | low |
| qrspi-design | all 7 | 60 | low |
| qrspi-structure | all 7 | 40 | low |
| qrspi-plan | all 7 | 80 | low |
| qrspi-implement | all 7 | 150 | low |
| qrspi-accept | all 7 | 100 | low |
| qrspi-replan | all 7 | 60 | low |
| qrspi-verify | all 7 | 80 | low |
| qrspi-report | all 7 | 30 | low |

#### Synthesizers and Writers (6 agents)

Read inputs, produce structured output files.

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-goals-synthesizer | all 7 | 40 | low |
| qrspi-design-synthesizer | all 7 | 40 | low |
| qrspi-plan-writer | all 7 | 60 | low |
| qrspi-task-spec-writer | all 7 | 40 | low |
| qrspi-replan-writer | all 7 | 40 | low |
| qrspi-reporter | all 7 | 20 | low |

#### Reviewers (14 agents — read-only)

Read artifacts, produce review findings. Never modify source files.

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-goals-reviewer | read, bash, grep, find, ls | 20 | low |
| qrspi-question-leakage-reviewer | read, bash, grep, find, ls | 15 | low |
| qrspi-question-quality-reviewer | read, bash, grep, find, ls | 15 | low |
| qrspi-research-reviewer | read, bash, grep, find, ls | 20 | low |
| qrspi-design-reviewer | read, bash, grep, find, ls | 20 | low |
| qrspi-structure-reviewer | read, bash, grep, find, ls | 20 | low |
| qrspi-plan-reviewer | read, bash, grep, find, ls | 30 | low |
| qrspi-task-spec-reviewer | read, bash, grep, find, ls | 25 | low |
| qrspi-replan-reviewer | read, bash, grep, find, ls | 20 | low |
| qrspi-review-code-quality | read, bash, grep, find, ls | 15 | low |
| qrspi-review-security | read, bash, grep, find, ls | 15 | low |
| qrspi-review-silent-failure | read, bash, grep, find, ls | 15 | low |
| qrspi-review-accept-goal-traceability | read, bash, grep, find, ls | 15 | low |
| qrspi-review-accept-spec | read, bash, grep, find, ls | 15 | low |

#### Researcher and Question Agents (6 agents — read-only)

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-codebase-researcher | read, bash, grep, find, ls | 15 | low |
| qrspi-web-researcher | read, bash | 15 | low |
| qrspi-research-synthesizer | all 7 | 30 | low |
| qrspi-question-generator | all 7 | 30 | low |
| qrspi-structure-mapper | read, bash, grep, find, ls | 30 | low |
| qrspi-coverage-planner | all 7 | 25 | low |

#### Code Writers (3 agents)

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-fast-impl-code | all 7 | 50 | medium |
| qrspi-fast-impl-test | all 7 | 50 | medium |
| qrspi-acceptance-tester | all 7 | 50 | medium |

#### Code Review Agents (4 agents — read-only + may modify)

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-code-review | all 7 | 40 | low |
| qrspi-review-test-coverage | read, bash, grep, find, ls | 20 | low |
| qrspi-review-test-quality | read, bash, grep, find, ls | 20 | low |
| qrspi-review-code-simplifier | read, bash, grep, find, ls | 20 | low |

#### Loop and Verification Agents (5 agents)

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-fast-impl-loop | all 7 | 100 | medium |
| qrspi-fast-impl-verify | all 7 | 80 | medium |
| qrspi-simplify-pass | all 7 | 60 | medium |
| qrspi-verifier | all 7 | 80 | medium |

#### Checkers (4 agents — read-only)

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-baseline-checker | read, bash, grep, find, ls | 20 | low |
| qrspi-baseline-regression-checker | read, bash, grep, find, ls | 20 | low |
| qrspi-e2e-regression-checker | read, bash, grep, find, ls | 20 | low |
| qrspi-integration-checker | read, bash, grep, find, ls | 20 | low |

#### Detector (1 agent)

| Agent | tools | max_turns | thinking |
|---|---|---|---|
| qrspi-backward-loop-detector | read, bash, grep, find, ls | 20 | low |

### Agent Type File Template

```markdown
---
description: "Short description of what this agent does"
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
---

You are <agent-name>. ...

### Rules

- ...

### Process

1. ...
2. ...

### Output

\```
### Status — PASS

...
\```
```

---

## Source: `skills/deepwork/SKILL.md` — Orchestrator Prompt

Adapted from `/home/n3m6/.config/opencode/agents/deepwork.md` (927 lines).

### Key Adaptations

1. **Remove permission system** — Not applicable in pi. Use `Agent` tool and `bash` freely as the main agent.

2. **Replace `task` → `Agent`** — The orchestrator uses the `Agent` tool to dispatch stage orchestrator subagents. All stage orchestrators run in foreground (blocking) to maintain sequential pipeline flow.

3. **Replace `question` → `qrspi_question`** — Human gates and user prompts use the custom `qrspi_question` tool.

4. **Simplify telemetry** — Instead of the complex event emission system, the orchestrator:
   - Appends events to `.pipeline/<run-id>/telemetry/events.jsonl`
   - Regenerates `run-log.md` at stage boundaries
   - Generates `metrics-summary.md` at Stage 10 completion

5. **Keep git checkpoints** — Use `bash` for all git operations (same commands as original).

6. **Keep the file-based protocol** — All `.pipeline/qrspi-<run-id>/` directory structure, `state.md` format, and artifact files preserved.

7. **Adapt return contract parsing** — Stage subagents return structured text. The orchestrator reads this from the `Agent` tool's result output and parses `### Status`, `### Files Written`, `### Route`, `### Phase`, `### Backward Loop Request`, `### Summary`.

8. **Keep resume mode** — `/deepwork-resume` command reads `state.md` and continues from the next stage.

9. **Keep pre-flight** — Same steps: validate task, generate run ID, create directories, create git branch, write initial state.

10. **Keep the full pipeline** — All 10 stages, quick-fix route skips, backward loop protocol, error handling.

### Excluded Features (pi limitations)

- **`todowrite` progress checklist** — pi has its own task tracking. The orchestrator can optionally use pi's plan mode syntax.
- **Permission contract enforcement** (rule 11 allowed-list cross-check) — Simplified: the orchestrator trusts stage subagents to honor their contracts.
- **Protocol file reads** (`protocol/deepwork-resume-protocol.md`, etc.) — Not present. Resume logic is inlined in the orchestrator skill.

---

## Pipeline File Convention (Preserved from Original)

[Full directory tree listing of .pipeline/qrspi-<run-id>/ structure]

---

## Installation

```bash
# Prerequisites
pi install npm:@tintinweb/pi-subagents

# Install deepwork extension
cd deepwork-pi && npm install
# Symlink into pi's global extensions
ln -s "$(pwd)" ~/.pi/agent/extensions/deepwork-pi
# Symlink agent types into pi's global agents dir
ln -s "$(pwd)/agents" ~/.pi/agent/agents/qrspi
```

Or via pi packages:

```bash
pi install git:github.com/n3m6/deepwork-pi@main
```

## Usage

```
# Start a new pipeline run
pi /deepwork "Build a real-time chat application with WebSocket support"

# Resume an existing run
pi /deepwork-resume qrspi-20260515-143022
```

---

## Implementation Order

### Phase 1: Foundation (src/)

1. Create `package.json` with dependencies
2. Write `src/pipeline.ts` (pure helpers)
3. Write `src/shared-tools.ts` (qrspi_dispatch + qrspi_question)
4. Write `src/index.ts` (command registration + skill injection)
5. Create `skills/deepwork/SKILL.md` (orchestrator prompt)

### Phase 2: Agent Types (agents/)

6. Convert 11 stage orchestrators (qrspi-goals through qrspi-report)
7. Convert 6 synthesizers/writers
8. Convert 14 reviewers
9. Convert 6 researcher/question agents
10. Convert 5 code writer/test agents
11. Convert 4 code review agents
12. Convert 5 loop/verification agents
13. Convert 4 checkers
14. Convert 1 detector agent

### Phase 3: Integration & Testing

15. Install pi-subagents dependency
16. Test `/deepwork` command end-to-end
17. Test `/deepwork-resume` functionality
18. test quick-fix route
19. Test backward loop handling
20. Test error handling and abortion

### Phase 4: Polish

21. Package as pi package for distribution
22. Add README.md with installation and usage docs
23. Test with various models (haiku for reviewers, sonnet for orchestrators)

---

## Open Items

- **pi-subagents dependency** — Users must install `@tintinweb/pi-subagents` separately. Could bundle or auto-detect.
- **Model selection** — Agent configs default to the parent model. Could specify exact models per agent type.
- **Skill discovery** — The deepwork skill must be discoverable by pi's skill loader. The `resources_discover` event provides `skillPaths`.
- **Agent agent discovery** — The ~55 agent files must be discoverable by pi-subagents. They can be placed in `.pi/agents/` (project) or `~/.pi/agent/agents/` (global).

---

## Estimated Scope

| Component | Files | Lines |
|---|---|---|
| Extension TypeScript (src/) | 3 | ~500 |
| Orchestrator Skill (SKILL.md) | 1 | ~900 |
| Agent Types (agents/) | 56 | ~15,000 |
| Configuration (package.json) | 1 | ~30 |
| **Total** | **61** | **~16,430** |
