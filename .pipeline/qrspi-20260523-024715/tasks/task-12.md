# Task 12: Stage 5 agent types (Structure)

## Metadata
- **Task:** 12
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 2d — Structure

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC-6 (Stage 5 agent types produce prescribed artifacts), AC-7 (model tier frontmatter correctly applied — sonnet for orchestrator and mapper, haiku for reviewer)
- **NFRs:** NFR: Compatibility — model tiers (sonnet-tier for orchestrator `qrspi-structure` and mapper `qrspi-structure-mapper`; haiku-tier for reviewer `qrspi-structure-reviewer`)
- **Replan Gate Criteria:** Phase 2 replan gate — Structure agents complete (three agent type `.md` files converted from opencode sources with correct YAML frontmatter per the conversion tables, structurally valid, and dispatch contracts preserved)

## Source Traceability
- **Goals:** AC-6 (Stage 5 agent types), AC-7 (model tier frontmatter)
- **Plan:** Task 12, Phase 2 — Planning Pipeline (Stage 5 agent types)
- **Design:** Slice 2d — Structure
- **Structure:** Slice 2d — `agents/qrspi-structure.md`, `agents/qrspi-structure-mapper.md`, `agents/qrspi-structure-reviewer.md`

## Description

Convert the three Stage 5 Structure agent types from their opencode counterparts at `/home/n3m6/.config/opencode/agents/` into pi agent type `.md` files with YAML frontmatter. Stage 5 produces `structure.md` — a file-level contract mapping the design's vertical slices to concrete file paths, typed interfaces, and a Mermaid architectural diagram.

### Stage 5 pipeline role

The `qrspi-structure` orchestrator reads the pipeline artifacts produced by prior stages (`goals.md`, `requirements.md`, `research/summary.md`, `design.md`), dispatches `qrspi-structure-mapper` to produce a `structure.md` artifact, then dispatches `qrspi-structure-reviewer` in a review loop (up to 5 rounds). A round-5 reviewer FAIL produces an `unclean-cap` terminal state; the human gate still presents but with the unresolved concerns documented. The orchestrator also holds a human gate via `qrspi_question` — the user may approve or provide feedback that triggers a re-mapping cycle. On approval the orchestrator returns `### Status — PASS`.

The `qrspi-structure-mapper` inspects the codebase with read-only tools, maps every design slice to files with CREATE/MODIFY actions, defines typed interfaces for component boundaries, documents cross-slice dependencies, and produces a Mermaid diagram. It never modifies project files. It must honor feedback from the reviewer or user when present.

The `qrspi-structure-reviewer` independently evaluates `structure.md` against all upstream artifacts and the codebase. It verifies file paths exist (MODIFY) or do not already exist (CREATE), checks interface completeness and compatibility with existing conventions, and validates diagram quality. It returns a structured PASS/FAIL verdict with a per-area findings table and concrete fix guidance.

### Conversion rules applied to all three files

Use the opencode → pi conversion tables from `requirements.md`:

| opencode field | pi frontmatter | Applied value |
|---|---|---|
| `permission.edit: allow` | `tools: all` | For `qrspi-structure` only |
| `permission.edit: deny` | `tools: read, bash, grep, find, ls` | For `qrspi-structure-mapper` and `qrspi-structure-reviewer` |
| `steps: N` | `max_turns: N` | See per-agent values below |
| `hidden: true` | N/A | Omit; pi-subagents does not use a hidden field |
| `temperature: 0.1` | N/A | Omit; pi handles temperature differently |
| `mode: subagent` | N/A | Omit; all pi agents are subagent-style |
| `permission.task` | N/A | Use `qrspi_dispatch` tool calls in the system prompt body |
| `permission.question` | N/A | Use `qrspi_question` tool calls in the system prompt body |
| `permission.webfetch` | `extensions: false` | All three agents deny webfetch |

For system prompt body adaptations:

| opencode pattern | pi equivalent |
|---|---|
| `Invoke qrspi-structure-mapper as a subagent:` | `Use the qrspi_dispatch tool with subagent_type: "qrspi-structure-mapper"` |
| `Dispatch qrspi-structure-reviewer as a subagent:` | `Use the qrspi_dispatch tool with subagent_type: "qrspi-structure-reviewer"` |
| `cat .pipeline/<run-id>/...` | `Read .pipeline/<run-id>/...` (use the Read tool) |
| `mkdir -p .pipeline/<run-id>/...` | `bash: mkdir -p .pipeline/<run-id>/...` |
| `date -u +%Y-%m-%dT%H:%M:%SZ` | `bash: date -u +%Y-%m-%dT%H:%M:%SZ` |
| `question` (tool reference) | `qrspi_question` (tool) |
| `Run find, ls, grep, and cat` | `Use the find, ls, grep, and Read tools` |
| `Confirm MODIFY targets exist (ls/find)` | `Use the ls and find tools to confirm MODIFY targets exist` |
| `cat .pipeline/<run-id>/feedback/structure-round-*.md` | `Read .pipeline/<run-id>/feedback/structure-round-*.md` |

## Files

### `agents/qrspi-structure.md` (CREATE) — Stage 5 Structure orchestrator

YAML frontmatter:

```yaml
---
description: "Stage 5 orchestrator — dispatches the structure mapper, runs automated review rounds, and holds a human gate for approval. Writes structure.md and review artifacts."
tools: all
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 40
prompt_mode: replace
extensions: false
---
```

System prompt body: Adapt from `/home/n3m6/.config/opencode/agents/qrspi-structure.md` (lines 21–163). Preserve the complete workflow including:

- **CRITICAL RULES section**: Retain "FORBIDDEN FROM WRITING CODE" (only write inside `.pipeline/qrspi-<run-id>/`), "INVOKE SUBAGENTS DIRECTLY" (adapt: "Use the qrspi_dispatch tool to invoke leaf subagents. Never describe a handoff in plain text — invoke it."), "STOP AFTER SUBAGENT DISPATCH" (end your turn after each qrspi_dispatch call and wait for the response).
- **Input section**: Extract run ID from the prompt; construct pipeline paths as `.pipeline/<run-id>/`.
- **Step A — Read Inputs**: Read `goals.md`, `requirements.md`, `research/summary.md`, and `design.md` from `.pipeline/<run-id>/` using the Read tool.
- **Step B — Dispatch Structure Mapper**: Dispatch via `qrspi_dispatch` with `subagent_type: "qrspi-structure-mapper"`, providing `=== GOALS ===`, `=== REQUIREMENTS ===`, `=== RESEARCH SUMMARY ===`, `=== DESIGN ===` blocks containing the verbatim content of each upstream artifact. Write the subagent's result to `.pipeline/<run-id>/structure.md`.
- **Step C — Automated Review Loop**: Run up to 5 rounds. Use `bash: mkdir -p .pipeline/<run-id>/reviews`. Dispatch `qrspi-structure-reviewer` via `qrspi_dispatch` with `subagent_type: "qrspi-structure-reviewer"` providing `=== GOALS ===`, `=== REQUIREMENTS ===`, `=== RESEARCH SUMMARY ===`, `=== DESIGN ===`, `=== STRUCTURE ===` blocks. Write reviewer output to `.pipeline/<run-id>/reviews/structure-review-round-{NN}.md`. Apply the routing table: PASS → terminal state `clean`, proceed to human gate; FAIL + round < 5 → re-dispatch mapper with original inputs plus `=== REVIEW FEEDBACK ===`, overwrite `structure.md`, increment `review_round`; FAIL + round == 5 → terminal state `unclean-cap`, proceed to human gate.
- **Step D — Human Gate**: Present via `qrspi_question` tool with `type: "confirm"`. Capture `presented_at` and `responded_at` timestamps via `bash: date -u`. Maintain `gate_round_details` and `gate_wait_time_s` for telemetry. On approval, proceed to Return. On user feedback: write feedback to `.pipeline/<run-id>/feedback/structure-round-{NN}.md`, re-dispatch mapper with `=== FEEDBACK HISTORY ===`, overwrite `structure.md`, reset `review_round = 1`, return to Step C.
- **Return section**: Preserve the exact return contract format with `### Status — PASS`, `### Files Written`, `### Summary`, and `### Telemetry` (JSON line with `review_rounds`, `gate_status`, `gate_rounds`, `gate_wait_time_s`, `gate_round_details`). Include the FAIL branch with `### Status — FAIL`.

### `agents/qrspi-structure-mapper.md` (CREATE) — Structure mapper leaf agent

YAML frontmatter:

```yaml
---
description: "Maps design slices to specific files, components, interfaces, and diagrams while honoring preserved requirements. Tracks create vs. modify for each file. Read-only — never modifies project files."
tools: read, bash, grep, find, ls
model: anthropic/claude-sonnet-4-5
thinking: low
max_turns: 30
prompt_mode: replace
extensions: false
---
```

System prompt body: Adapt from `/home/n3m6/.config/opencode/agents/qrspi-structure-mapper.md` (lines 17–138). Preserve the complete workflow including:

- **Agent identity**: "You are the Structure Mapper. Produce `# Structure` — a file-level contract…"
- **Inputs section**: List all inputs: Goals, Requirements, Research Summary, Design, optional Review Feedback, optional Feedback History.
- **Procedure** (8 steps in order):
  1. **Inspect the codebase** — Use the `find`, `ls`, `grep`, and `Read` tools to map directory layout, naming conventions, existing module boundaries, and test file patterns.
  2. **Apply requirements** — Where the codebase is silent, use explicit tech stack choices from requirements.md to guide file placement and interface shapes.
  3. **Map every design slice to files** — For each vertical slice: list every file as MODIFY or CREATE, confirm MODIFY targets exist via `ls`/`find`, confirm CREATE targets do not already exist, place CREATE files under existing directories following project conventions. Note new required directories in Convention Notes. If a slice touches more than 5 files, either split it into sub-slices or add a one-sentence justification.
  4. **Define typed interfaces** — For each component boundary: write explicit function signatures (name, parameters, return type), type/class definitions, and API contracts. Signatures must be consistent with the project's language, type system, and existing naming/export conventions. Placeholders (`any`, `object`, `unknown`, `TBD`) are invalid unless the codebase already uses them and the artifact explains why. Include signatures and contracts only — no implementation bodies.
  5. **Document cross-slice dependencies** — Name the concrete shared modules, import boundaries, and data flows that connect slices. Phrases like "shared validation" without a named module or signature are invalid.
  6. **Produce a Mermaid diagram** — Show file/module layout, interface boundaries, CREATE vs. MODIFY touch points, and main request/data flow. Missing or isolated-nodes-only diagrams are invalid.
  7. **Incorporate feedback** — If Review Feedback or Feedback History is present in the prompt, address every objection explicitly. Do not carry forward unresolved items.
  8. **Uncertainty rule** — If a file path, convention, or interface cannot be verified from the codebase, state the uncertainty in Convention Notes and choose the lowest-risk option grounded in the nearest existing pattern.
- **Output Format section**: Preserve the exact output structure: `# Structure`, `## Project Layout`, `## File Map` (with per-slice tables — File, Action, Purpose columns), `#### Interfaces` (with code-fenced signatures per file), `## Cross-Slice Dependencies`, `## Architectural Diagram` (with Mermaid code block), `## Convention Notes`.
- **Invalid Outputs section**: Preserve all 7 invalidity checks — no missing design-slice file-map sections, no directories/placeholders in file-map entries, no nonexistent MODIFY paths, no pre-existing CREATE paths, no placeholder types or omitted signatures, no unnamed cross-slice dependencies, no absent or isolated-nodes Mermaid, no unjustified 5+-file slices.
- **Example section**: Preserve the rate-limiter example showing correct output format.

### `agents/qrspi-structure-reviewer.md` (CREATE) — Structure reviewer leaf agent

YAML frontmatter:

```yaml
---
description: "Reviews generated structure.md independently for design alignment, file-map correctness, interface quality, and diagram completeness. Verifies file paths against the codebase. Read-only."
tools: read, bash, grep, find, ls
model: anthropic/claude-haiku-4-5
thinking: low
max_turns: 20
prompt_mode: replace
extensions: false
---
```

System prompt body: Adapt from `/home/n3m6/.config/opencode/agents/qrspi-structure-reviewer.md` (lines 17–70). Preserve the complete workflow including:

- **Agent identity**: "You are the Structure Reviewer. Review `structure.md` against the provided goals, requirements, research summary, and design. Verify file paths and conventions against the codebase using read-only inspection tools (`find`, `ls`, `grep`, `Read`). Return a structured PASS/FAIL verdict with concrete fix guidance. Do not rewrite the artifact, invent new requirements, or ask the user questions."
- **Input section**: Receive goals.md, requirements.md, research/summary.md, design.md, structure.md.
- **Review Checklist** (9 areas, each with PASS/FAIL criteria):
  - **Design alignment**: Every vertical slice and major component boundary in the design has a corresponding file-map section.
  - **Requirements alignment**: Explicit tech specs, named dependencies, integration points, and file-organization constraints from requirements are honored unless the codebase contradicts them.
  - **File action correctness**: MODIFY paths exist in the codebase; CREATE paths do not already exist; CREATE directories exist or the artifact explicitly notes a new directory is required.
  - **Interface completeness**: Every cross-component boundary has explicit function, class, type, or API signatures — not vague descriptions.
  - **Interface compatibility**: Signatures, names, and types are consistent with the existing codebase's language, module patterns, and naming conventions.
  - **Convention adherence**: File naming, placement, and module organization follow the established project structure, or the artifact notes when no convention exists.
  - **Cross-slice dependency clarity**: Shared interfaces, import relationships, and data-flow dependencies between slices are named explicitly — not implied.
  - **Diagram quality**: A Mermaid diagram is present and shows real file/module relationships, interface boundaries, and data flow — not isolated boxes.
  - **Granularity**: File-map entries name specific files, not directories or vague placeholders. Any slice touching more than 5 files must justify the breadth or decompose it further.
- **Output Format section**: Preserve the exact return structure: `### Status — PASS` or `### Status — FAIL`, `### Review Findings` (table with Area, Status, Notes columns), `### Fix Guidance` (numbered list of specific corrections for the mapper), `### Summary` (one-line verdict).
- **Rules section**: Preserve all 6 rules — PASS only if every area passes, FAIL if any area fails, write "None." under Fix Guidance if all pass, fix guidance tells the mapper what to correct (do not introduce new goals/slices/files/abstractions), vague file-map entries fail Granularity and File action correctness, placeholder types fail Interface completeness.

## Test Expectations
- [Agent frontmatter validity — orchestrator]: The `qrspi-structure.md` file has YAML frontmatter with all 7 required fields (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`). `tools` is `all`. `model` is `anthropic/claude-sonnet-4-5`. `thinking` is `low`. `max_turns` is `40`.
- [Agent frontmatter validity — mapper]: The `qrspi-structure-mapper.md` file has YAML frontmatter with all 7 required fields. `tools` is `read, bash, grep, find, ls`. `model` is `anthropic/claude-sonnet-4-5`. `thinking` is `low`. `max_turns` is `30`.
- [Agent frontmatter validity — reviewer]: The `qrspi-structure-reviewer.md` file has YAML frontmatter with all 7 required fields. `tools` is `read, bash, grep, find, ls`. `model` is `anthropic/claude-haiku-4-5`. `thinking` is `low`. `max_turns` is `20`.
- [Orchestrator system prompt structure]: The system prompt body in `qrspi-structure.md` contains all four named steps (Step A — Read Inputs, Step B — Dispatch Structure Mapper, Step C — Automated Review Loop, Step D — Human Gate) and a Return section with both PASS and FAIL branches.
- [Mapper system prompt structure]: The system prompt body in `qrspi-structure-mapper.md` contains an Inputs section, an ordered Procedure with all 8 steps (codebase inspection, requirements application, file mapping, interface definition, cross-slice dependencies, Mermaid diagram, feedback incorporation, uncertainty rule), an Output Format section with the exact `# Structure` template, and an Invalid Outputs section with all 7 checks.
- [Reviewer system prompt structure]: The system prompt body in `qrspi-structure-reviewer.md` contains an Input section, a Review Checklist with all 9 areas (Design alignment through Granularity), an Output Format section with the `### Status`, `### Review Findings` table, `### Fix Guidance`, and `### Summary` structure, and a Rules section with all 6 constraints.
- [Dispatch contract preservation — orchestrator]: The orchestrator prompt references `qrspi_dispatch` tool with `subagent_type: "qrspi-structure-mapper"` and `subagent_type: "qrspi-structure-reviewer"` — not the `Agent` tool or opencode `task` mechanism.
- [Dispatch contract preservation — human gate]: The orchestrator prompt references `qrspi_question` tool for the human gate — not the opencode `question` tool.
- [Tool reference adaptation — mapper]: The mapper prompt body instructs the agent to use `find`, `ls`, `grep`, and `Read` tools for codebase inspection — not `cat` or `bash find`.
- [Tool reference adaptation — reviewer]: The reviewer prompt body instructs the agent to use `find`, `ls`, `grep`, and `Read` tools for codebase verification — not `cat`.
- [Model tier assignment]: The orchestrator and mapper use sonnet-tier models (`anthropic/claude-sonnet-4-5`); the reviewer uses a haiku-tier model (`anthropic/claude-haiku-4-5`). This matches the constraint that orchesrator/synthesizer agents use sonnet-tier while read-only reviewer agents use haiku-tier.
- [No opencode permission artifacts]: None of the three files contain opencode-only frontmatter fields: `mode`, `hidden`, `temperature`, `steps`, or `permission`.
- [No placeholder content]: None of the three files contain placeholder language such as "TBD", "TODO", "details omitted", or "same as above".
- [Open source files must exist for completeness]: The source files at `qrspi-structure.md:21-163`, `qrspi-structure-mapper.md:17-138`, and `qrspi-structure-reviewer.md:17-70` under `/home/n3m6/.config/opencode/agents/` are available on disk and contain the content to port. If any opencode source file is missing or truncated, report a FAIL.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
