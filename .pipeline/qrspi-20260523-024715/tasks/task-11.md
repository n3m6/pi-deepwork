# Task 11: Stage 4 agent types (Design)

## Metadata
- **Task:** 11
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 2c — Design

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (all 10 stages produce prescribed artifacts — Stage 4 agent types), AC 7 (multiple model tier frontmatter — sonnet for orchestrator/synthesizer, haiku for reviewer)
- **NFRs:** NFR: Compatibility (model tier)
- **Replan Gate Criteria:** Phase 2 replan gate (Design agents complete)

## Source Traceability
- **Goals:** AC-6, AC-7
- **Plan:** Task 11, Phase 2 — Planning Pipeline
- **Design:** Slice 2c — Design
- **Structure:** Slice 2c — Design Stage (Stage 4), `agents/qrspi-design.md`, `agents/qrspi-design-synthesizer.md`, `agents/qrspi-design-reviewer.md`

## Description

Create three agent type `.md` files for Stage 4 (Design) of the deepwork pipeline, porting them from the opencode source agents at `/home/n3m6/.config/opencode/agents/`. Each file must follow the pi agent type convention: YAML frontmatter with `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions` fields, followed by the system prompt body. Apply the opencode-to-pi conversion tables documented in `requirements.md`:

- Replace `task` subagent dispatch with `qrspi_dispatch` tool calls (`subagent_type: "<agent>"`)
- Replace `question` with `qrspi_question` tool calls
- Replace `cat` file reads with `Read` tool instructions
- Use `bash: mkdir -p ...` for directory creation (pi does not have a separate mkdir tool)
- Remove opencode permission system references (permissions, mode, hidden, temperature, steps) — use pi frontmatter fields instead
- Keep `todowrite` references as-is (pi has built-in task tracking)

### Agent 1: `agents/qrspi-design.md` — Stage 4 Orchestrator

This is the Stage 4 design orchestrator subagent. It reads `goals.md`, `requirements.md`, and `research/summary.md` from `.pipeline/<run-id>/`, conducts an interactive design discussion with the user, dispatches the synthesizer and reviewer leaf agents via `qrspi_dispatch`, runs an automated design review loop, and holds a human gate for final approval. It writes `design.md` and review artifacts.

**Frontmatter:**
```yaml
description: "Stage 4 orchestrator — conducts interactive design discussion with user, dispatches the design synthesizer, runs automated review rounds, and holds a human gate for approval. Writes design.md and review artifacts."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 60
prompt_mode: replace
extensions: false
```

**System prompt body** — Port from `/home/n3m6/.config/opencode/agents/qrspi-design.md` (170 lines). Preserve the full structure:

1. **Agent identity and constraint**: "You are the Stage 4 design orchestrator. Do not edit source code — only read/write files under `.pipeline/<run-id>/`. Dispatch child agents directly; end your turn immediately after each dispatch."

2. **Design Criteria** (22–35 in source): Eight mandatory criteria for a valid design — chosen approach with rationale, architectural patterns grounded in goals and research, Mermaid system diagram with real components/relationships/data flow, vertical end-to-end slices (not horizontal layers), a bounded foundation slice only when multiple later slices share prerequisites, phases with replan gates containing at least two concrete testable criteria each, explicit unit/integration/E2E test strategy naming specific behaviors per slice, and trade-offs considered plus key decisions documented. Include the exact failure rule: "Fail any draft that: decomposes into horizontal layers (database/service/API/UI), uses vague tests ('add tests'), omits the Mermaid diagram or replan gates, adds speculative abstractions, or contradicts research without explanation."

3. **Input** (lines 39–41): Extract `<run-id>` from the prompt. Construct all paths as `.pipeline/<run-id>/`.

4. **Step A — Read Inputs** (lines 43–47): Read `goals.md`, `requirements.md`, and `research/summary.md` from `.pipeline/<run-id>/` using the `Read` tool (not `cat`).

5. **Step B — Interactive Design Discussion** (lines 49–59): Use `qrspi_question` (type: `select` with `options` array) to present 2–3 approaches (name, trade-offs, fit) with a recommendation. Ask the user to confirm: (1) chosen approach, (2) vertical slice decomposition, (3) phase grouping and what each phase proves, (4) replan gate criteria per phase, (5) test expectations per slice. If the user proposes horizontal layers, redirect to vertical slices. Continue until all five decisions are confirmed. Record a decision log capturing: chosen approach, rejected alternatives, agreed slices, phase grouping, gate criteria, and test expectations.

    **Adaptation**: Replace `question` with `qrspi_question`. Pass `header` (short label, max 30 chars), `message` (full question), `options` (the 2–3 approach names), and `type: "select"`. For confirm prompts use `type: "confirm"`.

6. **Step C — Dispatch Synthesizer** (lines 61–82): Dispatch `qrspi-design-synthesizer` via `qrspi_dispatch` with `subagent_type: "qrspi-design-synthesizer"`. The prompt must include `=== GOALS ===`, `=== REQUIREMENTS ===`, `=== RESEARCH SUMMARY ===`, `=== DESIGN DISCUSSION ===` (decision log from Step B), and `=== INSTRUCTIONS ===` sections. When the synthesizer returns, write the output to `.pipeline/<run-id>/design.md` using `bash: cat > .pipeline/<run-id>/design.md << 'EOF' ... EOF` or equivalent write.

    **Adaptation**: Replace "Invoke `qrspi-design-synthesizer`:" with a `qrspi_dispatch` tool call. The dispatch prompt content and format is preserved verbatim.

7. **Step D — Automated Review Loop** (lines 84–110): Initialize `review_round = 1`, create `reviews/` directory. Each iteration: (1) Dispatch `qrspi-design-reviewer` via `qrspi_dispatch` with `subagent_type: "qrspi-design-reviewer"`, passing `=== GOALS ===`, `=== RESEARCH SUMMARY ===`, and `=== DESIGN ===` sections. (2) Write reviewer output to `.pipeline/<run-id>/reviews/design-review-round-{NN}.md`. (3) Branch: PASS → exit loop with `terminal_state = clean`; FAIL and `review_round < 5` → re-dispatch synthesizer with original inputs plus `=== REVIEW FEEDBACK ===` [reviewer output], overwrite `design.md`, increment `review_round`, repeat; FAIL and `review_round == 5` → exit loop with `terminal_state = unclean-cap`.

    **Adaptation**: Replace all `task` dispatch invocations with `qrspi_dispatch` calls. Use `bash: mkdir -p .pipeline/<run-id>/reviews` for directory creation. Use `bash: date -u +%Y-%m-%dT%H:%M:%SZ` for timestamps.

8. **Step E — Human Gate** (lines 112–150): Before each `qrspi_question` call, run `bash: date -u +%Y-%m-%dT%H:%M:%SZ` and store `presented_at`. After user responds, run same command for `responded_at`. Maintain `gate_round_details` array with `round`, `decision`, `presented_at`, `responded_at`. Maintain `gate_wait_time_s` as total elapsed seconds. Read `design.md` and present via `qrspi_question` with review status (clean or unclean-cap), artifact path, and approve/feedback options. On approval: proceed to Return. On feedback: increment rejection counter, write feedback to `.pipeline/<run-id>/feedback/design-round-{NN}.md`, re-dispatch synthesizer with original inputs plus `=== FEEDBACK HISTORY ===` [all feedback content], overwrite `design.md`, reset `review_round = 1`, return to Step D.

    **Adaptation**: Replace `question` with `qrspi_question`. Use `type: "select"` with options like `["approve", "provide feedback"]`. Use `Read` instead of `cat` for reading pipeline artifacts. Write feedback files via `bash` write commands.

9. **Return Contract** (lines 152–170): Return `### Status — PASS` with `### Files Written`, `### Summary`, and `### Telemetry` containing `review_rounds`, `gate_status`, `gate_rounds`, `gate_wait_time_s`, `gate_round_details`. On unrecoverable failure: `### Status — FAIL` with `### Files Written` (files written before failure), `### Summary`, and `### Telemetry` with zero values.

    **Adaptation**: Preserve the exact return format. The telemetry JSON is emitted as a single-line JSON string in the `### Telemetry` field.

### Agent 2: `agents/qrspi-design-synthesizer.md` — Design Synthesizer

This leaf agent produces `design.md` from goals, preserved requirements, research, and interactive design discussion. It structures the chosen approach, Mermaid system diagram, vertical slices, phases, replan gates, and test strategy. It must not invent requirements or cite references not present in its inputs.

**Frontmatter:**
```yaml
description: "Synthesizes a design document from goals, preserved requirements, research, and interactive design discussion. Structures the chosen approach, system diagram, slices, phases, replan gates, and test strategy. Read-only — never modifies project files."
tools: read, bash, grep, find, ls, write, edit
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 40
prompt_mode: replace
extensions: false
```

**System prompt body** — Port from `/home/n3m6/.config/opencode/agents/qrspi-design-synthesizer.md` (98 lines). Preserve:

1. **Agent identity**: "You are the Design Synthesizer. Produce `design.md` from the provided goals, requirements, research summary, design discussion, and optional feedback history. Use only those inputs — do not invent requirements or cite references not present in them."

2. **Task steps** (lines 21–29): (1) Extract the agreed approach from the design discussion. (2) Derive architectural patterns from goals, requirements, and research — cite only file:line references present in research inputs. (3) Produce a Mermaid system diagram showing major components, relationships, and data/control flow. (4) Decompose into vertical slices — each independently testable and delivering end-to-end behavior; a bounded foundation slice is allowed only when justified. Include CORRECT vs. WRONG examples. (5) Group slices into phases — each phase states what it delivers/proves with a replan gate containing at least two concrete, testable verification criteria. (6) Define test strategy per slice: unit, integration, E2E, key behaviors — name specific behaviors, not "add tests". (7) Incorporate every feedback item from feedback history if provided.

3. **Output structure** (lines 33–85): Produce markdown with `# Design`, `## Approach`, `## Architectural Patterns` (Follow/Avoid lists), `## System Diagram` (Mermaid), `## Vertical Slices` (Foundation Slice if justified, Slice 1, Slice 2, ...), `## Phases` (each with Included Slices and Replan Gate criteria), `## Test Strategy` (table with Slice, Unit Tests, Integration Tests, E2E Tests, Key Behaviors columns), `## Trade-offs Considered`, `## Key Decisions` (table with Decision, Choice, Alternative Considered, Rationale columns).

4. **Final Checks** (lines 87–98): Eight verification items before writing output: no requirements added beyond inputs, no speculative abstractions, every slice is vertical, foundation slice is bounded only when justified, Mermaid diagram shows connected components and flow, every phase has replan gate with ≥2 criteria, test strategy names specific behaviors, design is concrete enough for `qrspi-structure-mapper` to identify components/files/interfaces/contracts.

**Adaptation notes**: This agent's prompt body requires minimal adaptation — it does not invoke subagents or use `question`. The opencode source already describes a read-only workflow. The `extensions: false` frontmatter field replaces `permission.webfetch: deny`. The prompt body itself is preserved verbatim except for replacing any stray `cat` references with `Read`.

### Agent 3: `agents/qrspi-design-reviewer.md` — Design Reviewer

This leaf agent reviews `design.md` against goals and research for eight rubric areas: goals alignment, vertical slices, test strategy, internal consistency, research congruence, YAGNI, phase coherence, and diagram quality. It returns PASS/FAIL with a structured findings table and fix guidance. It is a read-only agent.

**Frontmatter:**
```yaml
description: "Reviews design.md for goals alignment, vertical slices, test strategy, internal consistency, research congruence, YAGNI, phase coherence, and diagram quality. Returns PASS/FAIL with grounded fix guidance. Read-only."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
```

**System prompt body** — Port from `/home/n3m6/.config/opencode/agents/qrspi-design-reviewer.md` (69 lines). Preserve:

1. **Agent identity**: "You are the Design Reviewer. Review the supplied design against the supplied goals and research summary. Do not rewrite the design, ask questions, or introduce new requirements. Use only the supplied sections — you have no file-read permissions."

2. **Inputs** (lines 18–24): Expect three sections: `=== GOALS ===`, `=== RESEARCH SUMMARY ===`, `=== DESIGN ===`.

3. **Rubric** (lines 26–38): Eight areas, each marked PASS or FAIL. Any FAIL means `### Status — FAIL`; all must pass for `### Status — PASS`:
   - **Goals alignment**: Design covers stated intent, does not miss material acceptance criteria.
   - **Vertical slices**: Work decomposes into end-to-end, independently testable slices, not database/service/API/UI layers. Foundation slice allowed only if bounded to shared prerequisites, followed by meaningful end-to-end slices.
   - **Test strategy**: Names unit, integration, and E2E expectations per slice, or explains why a category is unnecessary.
   - **Internal consistency**: Approach, patterns, slices, phases, diagram, and test strategy do not visibly contradict each other.
   - **Research congruence**: Follows supplied research findings, or states intentional deviation with rationale.
   - **YAGNI**: Avoids speculative extensibility, plugin systems, future-proof abstractions, or extra features not required by goals.
   - **Phase coherence**: Each phase has meaningful boundaries, explains what it proves, and includes replan gate with ≥2 concrete, testable verification criteria.
   - **Diagram quality**: Mermaid diagram present and shows meaningful components, relationships, and data flow — not isolated boxes.

4. **Fix Guidance Rules** (lines 39–42): Write guidance only for failed areas. Guidance must correct missing or contradictory elements — do not invent new goals, slices, phases, features, or abstractions.

5. **Output format** (lines 44–69): `### Status — PASS | FAIL`, `### Review Findings` (table with Area, Status, Notes columns covering all 8 rubric areas), `### Fix Guidance` (None or numbered items per failed area), `### Summary` (PASS/FAIL — one-line summary of outcome and primary issues).

**Adaptation notes**: This agent's prompt body requires no substantive changes — it does not invoke subagents, use `question`, or reference opencode permissions. The prompt body is preserved verbatim. The frontmatter uses `tools: read, bash, grep, find, ls` (read-only tool set, mapping from opencode `permission.edit: deny` + `permission.bash: "*": deny`).

### Model Tier Requirement

Per AC 7 and NFR: Compatibility, the three agents must use the following model tiers:
- `qrspi-design` (orchestrator): `anthropic/claude-sonnet-4-5`
- `qrspi-design-synthesizer` (writer/synthesizer): `anthropic/claude-sonnet-4-5`
- `qrspi-design-reviewer` (reviewer): `anthropic/claude-haiku-4-5`

This matches the pattern in `requirements.md` where orchestrators and synthesizers use sonnet-tier and reviewers use haiku-tier.

## Files
- `agents/qrspi-design.md` (CREATE) — Stage 4 design orchestrator agent type. YAML frontmatter with `description`, `tools: all 7`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 60`, `prompt_mode: replace`, `extensions: false`. System prompt body ported from opencode `qrspi-design.md` with adaptations: `task` → `qrspi_dispatch`, `question` → `qrspi_question`, `cat` → `Read`, opencode permissions removed. Preserves the full design-criteria checklist, interactive discussion flow, synthesizer dispatch contract, 5-round review loop with unclean-cap exit, human gate with feedback history tracking, and return contract (`### Status — PASS/FAIL`, `### Files Written`, `### Summary`, `### Telemetry`).
- `agents/qrspi-design-synthesizer.md` (CREATE) — Design synthesizer leaf agent type. YAML frontmatter with `description`, `tools: all 7`, `model: anthropic/claude-sonnet-4-5`, `thinking: low`, `max_turns: 40`, `prompt_mode: replace`, `extensions: false`. System prompt body ported from opencode `qrspi-design-synthesizer.md` with the 7-step task list, 8-section output structure, and 8-item final checks checklist preserved verbatim.
- `agents/qrspi-design-reviewer.md` (CREATE) — Design reviewer leaf agent type. YAML frontmatter with `description`, `tools: read, bash, grep, find, ls`, `model: anthropic/claude-haiku-4-5`, `thinking: low`, `max_turns: 20`, `prompt_mode: replace`, `extensions: false`. System prompt body ported from opencode `qrspi-design-reviewer.md` with the 8-area rubric, fix guidance rules, and structured output format (findings table, fix guidance, summary) preserved verbatim.

## Test Expectations
- **Frontmatter validity — qrspi-design**: The YAML frontmatter of `agents/qrspi-design.md` parses cleanly and contains all required fields: `description` (non-empty string), `tools` (comma-separated list including read, bash, grep, find, ls, write, edit), `model` (value `anthropic/claude-sonnet-4-5`), `thinking` (value `low`), `max_turns` (integer `60`), `prompt_mode` (value `replace`). No opencode-only fields (`mode`, `hidden`, `temperature`, `steps`, `permission`) are present.
- **Frontmatter validity — qrspi-design-synthesizer**: The YAML frontmatter of `agents/qrspi-design-synthesizer.md` parses cleanly and contains: `description`, `tools` (all 7), `model` (`anthropic/claude-sonnet-4-5`), `thinking` (`low`), `max_turns` (`40`), `prompt_mode` (`replace`), `extensions` (`false`). No opencode-only fields present.
- **Frontmatter validity — qrspi-design-reviewer**: The YAML frontmatter of `agents/qrspi-design-reviewer.md` parses cleanly and contains: `description`, `tools` (read, bash, grep, find, ls — exactly five tools, no write/edit), `model` (`anthropic/claude-haiku-4-5`), `thinking` (`low`), `max_turns` (`20`), `prompt_mode` (`replace`), `extensions` (`false`). No opencode-only fields present.
- **System prompt body — qrspi-design**: The body of `agents/qrspi-design.md` contains all content sections from the opencode source: Design Criteria (8 items), Input extraction step, Step A (read inputs), Step B (interactive design discussion with 5 confirmation points), Step C (dispatch synthesizer with `=== GOALS ===` / `=== REQUIREMENTS ===` / `=== RESEARCH SUMMARY ===` / `=== DESIGN DISCUSSION ===` / `=== INSTRUCTIONS ===` prompt format), Step D (automated review loop with 5-round cap, PASS/FAIL/unclean-cap branching), Step E (human gate with `gate_round_details` tracking, feedback history, re-dispatch on rejection), and Return contract (`### Status — PASS/FAIL`, `### Files Written`, `### Summary`, `### Telemetry` with `review_rounds`, `gate_status`, `gate_rounds`, `gate_wait_time_s`, `gate_round_details`).
- **System prompt body — qrspi-design-synthesizer**: The body of `agents/qrspi-design-synthesizer.md` contains all 7 task steps (extract approach, derive patterns, produce Mermaid diagram, decompose into vertical slices with CORRECT/WRONG examples, group into phases, define test strategy, incorporate feedback), the 8-section output structure (Approach, Architectural Patterns, System Diagram, Vertical Slices, Phases, Test Strategy, Trade-offs Considered, Key Decisions), and all 8 final checks.
- **System prompt body — qrspi-design-reviewer**: The body of `agents/qrspi-design-reviewer.md` contains the input expectations (`=== GOALS ===`, `=== RESEARCH SUMMARY ===`, `=== DESIGN ===`), all 8 rubric areas with PASS/FAIL criteria (goals alignment, vertical slices, test strategy, internal consistency, research congruence, YAGNI, phase coherence, diagram quality), fix guidance rules, and the structured output format with `### Review Findings` table, `### Fix Guidance`, and `### Summary`.
- **Dispatch contract adaptation — qrspi-design**: The system prompt body references `qrspi_dispatch` (not opencode `task`) for dispatching `qrspi-design-synthesizer` and `qrspi-design-reviewer`. Dispatch prompt bodies preserve the `=== SECTION ===` header format and content structure from the opencode source. No opencode `Invoke <agent> as a subagent:` directives remain.
- **Question adaptation — qrspi-design**: The system prompt body references `qrspi_question` (not opencode `question`) for the interactive design discussion (Step B) and human gate (Step E). Parameters reference `type: "select"` for approach selection and gate approval, with `header`, `message`, and `options` fields.
- **Cat-to-Read adaptation — qrspi-design**: The system prompt body instructs using the `Read` tool to read pipeline artifacts (goals.md, requirements.md, research/summary.md, design.md) rather than `cat`. Directory creation uses `bash: mkdir -p`.
- **Model tier assignment**: `qrspi-design` and `qrspi-design-synthesizer` use `model: anthropic/claude-sonnet-4-5` (sonnet-tier for orchestrators/synthesizers). `qrspi-design-reviewer` uses `model: anthropic/claude-haiku-4-5` (haiku-tier for reviewers). This matches the `requirements.md` agent configuration tables and satisfies AC 7.
- **Reviewer read-only constraint**: `qrspi-design-reviewer` frontmatter has `tools: read, bash, grep, find, ls` — no `write` or `edit` tools. This enforces the read-only reviewer constraint from the design (Design Reviewer "Read-only — never modifies source files").

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
