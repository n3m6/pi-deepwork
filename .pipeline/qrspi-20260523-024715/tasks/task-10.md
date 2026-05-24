# Task 10: Stage 3 agent types (Research)

## Metadata
- **Task:** 10
- **Phase:** 2
- **Route:** full
- **Slice:** Slice 2b — Research

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (Stage 3 agent types), AC 7 (model tier frontmatter)
- **NFRs:** NFR: Compatibility (model tier)
- **Replan Gate Criteria:** Phase 2 replan gate (Research agents complete)

## Source Traceability
- **Goals:** AC-6 (All 10 stages produce their prescribed artifacts), AC-7 (Extension works with multiple model tiers)
- **Plan:** Task 10, Phase 2 — Planning Pipeline (Stages 2–6)
- **Design:** Slice 2b — Research
- **Structure:** Slice 2b — Research: `agents/qrspi-research.md`, `agents/qrspi-codebase-researcher.md`, `agents/qrspi-web-researcher.md`, `agents/qrspi-research-synthesizer.md`, `agents/qrspi-research-reviewer.md`

## Description

Convert the five Stage 3 agent type `.md` files from their opencode source equivalents into pi agent type files with YAML frontmatter. Stage 3 is the Research stage of the QRSPI deepwork pipeline. The orchestrator agent (`qrspi-research`) coordinates a goal-blind research workflow: it reads the questions artifact produced by Stage 2, dispatches per-question researcher leaf agents, synthesizes their findings, and runs a review pass before writing the final research summary.

Each agent type file uses pi's YAML frontmatter convention with the fields `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions`. The system prompt body below the frontmatter is adapted from the corresponding opencode agent prompt using the conversion rules documented in requirements.md:

- Replace opencode `task` dispatch with `qrspi_dispatch` tool calls using `subagent_type: "<agent>"`
- Replace opencode `question` tool references with `qrspi_question`
- Replace opencode `cat .pipeline/...` with `Read .pipeline/...` (using pi's `read` tool)
- Replace `mkdir -p` shell commands with `bash: mkdir -p ...`
- Keep `=== RUN ID ===` headers and `### Status — PASS/FAIL` return contracts verbatim
- Use `prompt_mode: replace` on all files (the default for pi agent types)
- Set `extensions: false` to disable extension loading in child agents

The source opencode agent prompts are at `/home/n3m6/.config/opencode/agents/`. Port the prompt body content faithfully, applying only the documented conversion rules above and the file-based protocol conventions. Do not invent new pipeline stages, change the dispatch flow, or alter the return contract format.

### Goal-Blind Constraint

The research stage enforces a critical constraint inherited from the opencode pipeline: **all research leaf agents and their synthesized output must be goal-blind**. This means research agents investigate facts only — they must not propose solutions, evaluate approaches, or make recommendations. The orchestrator's system prompt must insert the constraint *"Goal-blind. Facts only."* verbatim into every child research dispatch prompt. The research reviewer must verify that the final `summary.md` contains no solution recommendations.

### Agent Files to Create

**1. `agents/qrspi-research.md` — Stage 3 Orchestrator**

- **Role:** Reads the `questions.md` artifact produced by Stage 2, dispatches `qrspi-codebase-researcher` and `qrspi-web-researcher` per question via `qrspi_dispatch`, feeds their per-question findings into `qrspi-research-synthesizer`, dispatches `qrspi-research-reviewer` against the synthesized summary, and handles the review loop (re-dispatch synthesizer + reviewer if reviewer returns FAIL, up to a reasonable limit). Writes per-question research files (`research/q-NN.md`) and the unified `research/summary.md`.
- **Frontmatter:**
  - `description`: `"Stage 3 research orchestrator — dispatches per-question researchers (codebase + web), synthesizer, and reviewer. Goal-blind: research presents facts only, no solution recommendations."`
  - `tools`: `all`
  - `model`: `anthropic/claude-sonnet-4-5`
  - `thinking`: `low`
  - `max_turns`: `60`
  - `prompt_mode`: `replace`
  - `extensions`: `false`
- **Key behaviors in the system prompt body:**
  - **Input processing:** Read `questions.md` from `.pipeline/<run-id>/questions.md` to extract the research question inventory. Each question should have a question ID (e.g., `q-01`), the question text, and scope notes.
  - **Per-question research loop:** For each question, dispatch `qrspi-codebase-researcher` (explores the local repository for relevant facts) and `qrspi-web-researcher` (researches external documentation, APIs, or references) via `qrspi_dispatch`. Insert the goal-blind constraint verbatim into each dispatch prompt. Write intermediate findings to `.pipeline/<run-id>/research/q-NN.md`.
  - **Synthesis:** After all per-question research completes, dispatch `qrspi-research-synthesizer` via `qrspi_dispatch`, providing all `research/q-NN.md` file paths as input. The synthesizer produces a unified `research/summary.md`.
  - **Review loop:** Dispatch `qrspi-research-reviewer` via `qrspi_dispatch` against `research/summary.md`. If the reviewer returns `### Status — FAIL`, incorporate its fix guidance and re-dispatch the synthesizer with review findings, then re-dispatch the reviewer. Accept up to 3 review rounds; on persistent FAIL, return the last reviewer findings alongside the summary.
  - **Return contract:** Return a structured block containing `### Status — PASS` (or `FAIL`), `### Files Written` (listing per-question files and `summary.md`), and `### Summary` describing research coverage and any unresolved gaps.

**2. `agents/qrspi-codebase-researcher.md` — Codebase Researcher (Leaf)**

- **Role:** Investigates the local repository for facts relevant to a single research question. Reads source code, configuration files, documentation, and test suites. Returns findings as structured text — facts only, no recommendations. Goal-blind.
- **Frontmatter:**
  - `description`: `"Investigates the repository for facts relevant to a single research question. Goal-blind: reports facts only, no solution recommendations. Returns structured findings."`
  - `tools`: `read, bash, grep, find, ls`
  - `model`: `anthropic/claude-haiku-4-5`
  - `thinking`: `low`
  - `max_turns`: `15`
  - `prompt_mode`: `replace`
  - `extensions`: `false`
- **Key behaviors in the system prompt body:**
  - Accept a single question and the run ID as input (the orchestrator passes these in the dispatch prompt).
  - Use `grep`, `find`, `ls` to locate relevant files; use `read` to inspect file contents; use `bash` to run search commands or check build configurations.
  - Output a structured findings block: question ID, question text, facts discovered (categorized by file or module), and a confidence assessment.
  - Do not propose code changes, architectural decisions, or solution approaches. If asked to evaluate a solution, refuse and state the goal-blind constraint.

**3. `agents/qrspi-web-researcher.md` — Web Researcher (Leaf)**

- **Role:** Researches external sources (documentation, API references, community forums, package registries) for facts relevant to a single research question. Returns findings as structured text — facts only, no recommendations. Goal-blind.
- **Frontmatter:**
  - `description`: `"Researches external documentation and web sources for facts relevant to a single research question. Goal-blind: reports facts only, no solution recommendations. Returns structured findings."`
  - `tools`: `read, bash`
  - `model`: `anthropic/claude-haiku-4-5`
  - `thinking`: `low`
  - `max_turns`: `15`
  - `prompt_mode`: `replace`
  - `extensions`: `false`
- **Key behaviors in the system prompt body:**
  - Accept a single question and the run ID as input (the orchestrator passes these in the dispatch prompt).
  - Use `read` to fetch web documentation pages; use `bash` to run `curl` or similar commands if needed for API queries.
  - Output the same structured findings block as the codebase researcher: question ID, question text, facts discovered (with source URLs or references), and a confidence assessment.
  - Cite all external sources. Do not propose solutions or evaluate approaches.

**4. `agents/qrspi-research-synthesizer.md` — Research Synthesizer (Leaf)**

- **Role:** Reads all per-question research files (`research/q-NN.md`) and produces a unified `research/summary.md` that integrates findings, identifies conflicts or gaps, and maintains goal-blind neutrality. Does not rank solutions or recommend approaches.
- **Frontmatter:**
  - `description`: `"Synthesizes per-question research findings into a unified research summary. Goal-blind: integrates facts, identifies gaps and conflicts, no solution recommendations."`
  - `tools`: `all`
  - `model`: `anthropic/claude-sonnet-4-5`
  - `thinking`: `low`
  - `max_turns`: `30`
  - `prompt_mode`: `replace`
  - `extensions`: `false`
- **Key behaviors in the system prompt body:**
  - Accept the run ID and a list of `research/q-NN.md` file paths as input (the orchestrator passes these in the dispatch prompt).
  - Read each per-question file and integrate findings under thematic sections (e.g., "Codebase Architecture", "External Dependencies", "API Surface", "Constraints and Risks").
  - Flag contradictions between codebase and web research findings. Identify gaps where neither researcher found sufficient information (mark as "INSUFFICIENT_DATA").
  - Write the final output to `.pipeline/<run-id>/research/summary.md`. The file must contain an Overview section, a per-question findings table, an integrated analysis section, a gap/conflict index, and a section listing all sources.
  - Return `### Status — PASS` with the written file paths and a brief summary of coverage and gaps. On error, return `### Status — FAIL` with a description of what went wrong.

**5. `agents/qrspi-research-reviewer.md` — Research Reviewer (Leaf)**

- **Role:** Reviews the completed `research/summary.md` for completeness (all questions addressed), accuracy (facts verifiable against source files or web references), and goal-blind compliance (no solution recommendations or evaluative language). Read-only — does not modify the summary file.
- **Frontmatter:**
  - `description`: `"Reviews research summary for completeness, accuracy, and goal-blind compliance. Read-only. Returns PASS/FAIL with structured fix guidance."`
  - `tools`: `read, bash, grep, find, ls`
  - `model`: `anthropic/claude-haiku-4-5`
  - `thinking`: `low`
  - `max_turns`: `20`
  - `prompt_mode`: `replace`
  - `extensions`: `false`
- **Key behaviors in the system prompt body:**
  - Accept the run ID and the path to `research/summary.md` as input.
  - Read `research/summary.md` and cross-reference against `research/q-NN.md` files for accuracy and completeness.
  - Check for goal-blind violations: any phrase that evaluates, recommends, ranks, or suggests a preferred approach is a violation. Report each violation with the exact text and line reference.
  - Check that every question from the original inventory has findings or an explicit INSUFFICIENT_DATA marker.
  - Return `### Status — PASS` if the summary is complete, accurate, and goal-blind compliant. Return `### Status — FAIL` with specific, actionable fix guidance (question-by-question gaps, accuracy issues with file/source references, goal-blind violation text snippets). The FAIL return block must include a `### Fix Guidance` section that the orchestrator can feed back to the synthesizer.

### Model Tier Strategy

This task implements the model tier strategy specified in goals AC-7 and NFR: Compatibility:

- **Sonnet-tier (`anthropic/claude-sonnet-4-5`):** Used for the orchestrator (`qrspi-research`) and the synthesizer (`qrspi-research-synthesizer`). These agents coordinate complex multi-step workflows and produce structured long-form output, requiring the stronger model.
- **Haiku-tier (`anthropic/claude-haiku-4-5`):** Used for leaf agents that perform bounded, read-only tasks: `qrspi-codebase-researcher`, `qrspi-web-researcher`, and `qrspi-research-reviewer`. These agents search, read, and report facts within tight turn limits.

## Files
- `agents/qrspi-research.md` (CREATE) — Stage 3 research orchestrator. Coordinates per-question research dispatch via `qrspi_dispatch`, synthesis, and review. Writes `research/q-NN.md` and `research/summary.md`. Enforces goal-blind constraint on all child agents. Sonnet-tier model, all 7 tools, max 60 turns, low thinking.
- `agents/qrspi-codebase-researcher.md` (CREATE) — Codebase researcher leaf agent. Explores local repository for facts about a single research question using read and search tools. Goal-blind: facts only. Haiku-tier model, read, bash, grep, find, ls tools, max 15 turns, low thinking.
- `agents/qrspi-web-researcher.md` (CREATE) — Web researcher leaf agent. Researches external documentation and web sources for facts about a single research question. Goal-blind: facts only. Haiku-tier model, read/bash tools, max 15 turns, low thinking.
- `agents/qrspi-research-synthesizer.md` (CREATE) — Research synthesizer leaf agent. Reads per-question research files and produces a unified `research/summary.md` with integrated analysis, gap identification, and conflict resolution. Sonnet-tier model, all 7 tools, max 30 turns, low thinking.
- `agents/qrspi-research-reviewer.md` (CREATE) — Research reviewer leaf agent. Reviews `research/summary.md` for completeness, accuracy, and goal-blind compliance. Returns PASS/FAIL with structured fix guidance. Haiku-tier model, read/bash/grep/find/ls tools, max 20 turns, low thinking.

## Test Expectations
- **Agent file validity:** When each agent `.md` file is parsed for YAML frontmatter, the result contains all required fields (`description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, `extensions`) with no syntax errors or missing required keys.
- **Frontmatter model tiers:** When the `qrspi-research.md` and `qrspi-research-synthesizer.md` frontmatter is inspected, the `model` field is `anthropic/claude-sonnet-4-5`. When the `qrspi-codebase-researcher.md`, `qrspi-web-researcher.md`, and `qrspi-research-reviewer.md` frontmatter is inspected, the `model` field is `anthropic/claude-haiku-4-5`.
- **Frontmatter tool sets:** When the `qrspi-research.md` and `qrspi-research-synthesizer.md` frontmatter is inspected, `tools` is `all`. When `qrspi-codebase-researcher.md` and `qrspi-research-reviewer.md` frontmatter is inspected, `tools` is `read, bash, grep, find, ls`. When `qrspi-web-researcher.md` frontmatter is inspected, `tools` is `read, bash`.
- **Frontmatter turn limits:** When each agent file's frontmatter is inspected, `max_turns` matches the prescribed value: 60 for the orchestrator, 15 for codebase researcher and web researcher, 30 for synthesizer, and 20 for reviewer.
- **Goal-blind constraint present in orchestrator prompt:** When the system prompt body of `qrspi-research.md` is searched, the exact phrase "Goal-blind. Facts only." appears in context of child agent dispatch instructions — specifically at the point where it constructs prompts for `qrspi-codebase-researcher` and `qrspi-web-researcher`.
- **Goal-blind compliance checked by reviewer:** When the system prompt body of `qrspi-research-reviewer.md` is searched, it contains instructions to detect and report solution recommendations, evaluative language, ranking, or preferred approaches — and to report each violation with exact text and line reference.
- **Return contract in orchestrator prompt:** When the system prompt body of `qrspi-research.md` is searched, it contains instructions to return `### Status — PASS` or `### Status — FAIL`, `### Files Written`, and `### Summary` in the structured output block.
- **Return contract in reviewer prompt:** When the system prompt body of `qrspi-research-reviewer.md` is searched, it contains instructions to return `### Status — PASS` or `### Status — FAIL` with a `### Fix Guidance` section on FAIL.
- **Dispatch references use qrspi_dispatch:** When the system prompt body of `qrspi-research.md` is searched, all child agent dispatch instructions reference the `qrspi_dispatch` tool (not the opencode `task` tool) and specify the correct `subagent_type` for each leaf agent.
- **Read tool references for pipeline files:** When the system prompt body of any of the five agent files references reading a `.pipeline/` artifact, it uses pi's `read` tool convention (e.g., "Read `.pipeline/<run-id>/questions.md`") rather than opencode's `cat` command.
- **Synthesizer output target:** When the system prompt body of `qrspi-research-synthesizer.md` is searched, it specifies writing output to `.pipeline/<run-id>/research/summary.md` and the expected sections include an Overview, a per-question findings table, an integrated analysis section, a gap/conflict index, and a sources listing.
- **prompt_mode and extensions:** When any of the five agent file frontmatter sections is inspected, `prompt_mode` is `replace` and `extensions` is `false`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
