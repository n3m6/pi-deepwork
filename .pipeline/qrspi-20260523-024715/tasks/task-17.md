# Task 17: Code review orchestrator and quality/security lenses

## Metadata
- **Task:** 17
- **Phase:** 3
- **Route:** full
- **Slice:** Slice 3c — Code Review

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 6 (code review agent types — all 10 stages produce their prescribed artifacts in the `.pipeline/qrspi-<run-id>/` directory tree following the file-based protocol convention), AC 7 (model tier frontmatter — works with multiple model tiers: haiku-tier for reviewer and leaf agents and sonnet-tier for orchestrator agents)
- **NFRs:** NFR: Compatibility (multiple model tiers — haiku-tier for review lens leaf agents, sonnet-tier for the code review orchestrator)
- **Replan Gate Criteria:** Phase 3 replan gate — Code review agents complete (code review orchestrator plus quality, security, and silent-failure review lens agent type `.md` files are converted from opencode sources with correct YAML frontmatter per the conversion tables, each structurally valid with parseable frontmatter and system prompt body present, dispatch contracts preserved, reviewer-selection logic and finding-synthesis patterns intact)

## Source Traceability
- **Goals:** AC 6, AC 7
- **Plan:** Task 17, Phase 3 — Implementation Loop (Stages 7–8.5)
- **Design:** Slice 3c — Code Review (part of Slice 3: Implementation Loop). The code review orchestrator is dispatched by `qrspi-implement` (Stage 7 orchestrator) after per-task implementation. It reads the task's changed files, selects which review lenses to dispatch based on regex-matching heuristics, fans out to the relevant lenses via `qrspi_dispatch`, collates findings into blocking vs advisory categories, and returns a structured review verdict.
- **Structure:** Slice 3c — Code Review System: `agents/qrspi-code-review.md` (CREATE — code review orchestrator), `agents/qrspi-review-code-quality.md` (CREATE — code quality review lens), `agents/qrspi-review-security.md` (CREATE — security review lens), `agents/qrspi-review-silent-failure.md` (CREATE — silent failure review lens)

## Description

Create four agent type `.md` files for the QRSPI per-task code review system. These agents form a dispatch unit: the code review orchestrator receives a task's changed files, applies regex-based heuristic rules to determine which review lenses are relevant, fans out to the selected lenses via `qrspi_dispatch`, collates their findings, and returns a verdict with blocking and advisory items. The three review lenses (`qrspi-review-code-quality`, `qrspi-review-security`, `qrspi-review-silent-failure`) are read-only agents that inspect changed files for a specific concern and return structured findings.

Each agent file follows the pi agent type convention: YAML frontmatter containing `description`, `tools`, `model`, `thinking`, `max_turns`, `prompt_mode`, and `extensions` fields, followed by a system prompt body adapted from the opencode source equivalents using the conversion tables documented in requirements.md.

### Conversion Rules Applied

The opencode → pi frontmatter mappings applied to these agents:

| opencode field | pi frontmatter | Value for these agents |
|---|---|---|
| `description` | `description` | Direct mapping — preserved from opencode |
| `mode: subagent` | N/A | All pi agents are subagent-style |
| `hidden: true` | `enabled: false` | All four agents are hidden from listing but spawnable |
| `steps: N` | `max_turns: N` | As specified per agent below |
| `temperature: 0.1` | N/A | pi handles temperature differently — omit |
| `permission.edit: allow` | `tools: read, bash, grep, find, ls, write, edit` | Orchestrator gets full write access |
| `permission.edit: deny` | `tools: read, bash, grep, find, ls` | Review lenses get read-only tools |
| `permission.bash: "grep *"` | `tools: read, bash, grep, find, ls` | Restricted bash for reviewers |
| `permission.task: "qrspi-*"` | N/A | Uses `qrspi_dispatch` tool instead |
| `permission.webfetch: deny` | `extensions: false` | No web fetch access |

System prompt body adaptations applied:
- `cat .pipeline/...` → `Read .pipeline/...` (read tool)
- `Invoke <agent> as a subagent:` → `Use the qrspi_dispatch tool with subagent_type: "<agent>"`
- `=== RUN ID ===` and `=== TASK ID ===` headers preserved verbatim in dispatch prompt context
- File read operations via the `read` and `bash` tools
- Review findings written by the orchestrator, not by individual lenses (lenses return structured output inline)
- Original opencode review lens bodies referenced include: "You are the QRSPI Code Quality Reviewer. Read-only. Review only this task's changed files." (code-quality), "Review one task's changed files for concrete security vulnerabilities. Read-only." (security), "You are the QRSPI Silent Failure Reviewer. Read-only." (silent-failure)

### Agent 1: `agents/qrspi-code-review.md` (Code Review Orchestrator)

**Role:** Per-task code review orchestrator — dispatched by `qrspi-implement` (Stage 7 orchestrator) after task implementation. Reads the task's changed files (listed in the task spec and detected via git diff or by following the provided file list), applies regex heuristics to select which review lenses to dispatch, fans out to the selected lenses via `qrspi_dispatch`, collates their findings, categorizes each finding as blocking (release-blocking bug or critical issue) or advisory (improvement or style note), and returns a structured verdict. This orchestrator is the single code review entry point for the implementation pipeline.

**Frontmatter:**
- `description`: "Code review orchestrator — reads changed files for a task, applies regex rules to select relevant review lenses, dispatches lenses via qrspi_dispatch, collates findings into blocking vs advisory categories, returns structured verdict."
- `tools`: `read, bash, grep, find, ls, write, edit`
- `model`: `anthropic/claude-sonnet-4-5`
- `thinking`: `low`
- `max_turns`: `40`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-code-review.md`):**

The orchestrator receives `=== RUN ID === <run-id>` and `=== TASK ID === <task-id>` from the caller (`qrspi-implement`) and follows this process:

1. **Read Task Context.** Read the task spec from `.pipeline/<run-id>/phases/phase-NN/tasks/task-NN.md` to identify the list of changed or created files (`## Files` section). Confirm which files actually exist and have been modified by reading each one.

2. **Apply Reviewer-Selection Heuristics.** Scan the changed files' contents against regex patterns to determine which review lenses to dispatch:
   - `SECURITY_RE` — Patterns matching authentication, authorization, cryptography, input sanitization, secrets handling, or injection-prone code (e.g., `eval`, `exec`, `child_process`, `sql`, `token`, `password`, `secret`, `jwt`, `auth`, `sanitize`, `escape`). If any file matches, select `qrspi-review-security`.
   - `SILENT_RE` — Patterns matching error swallowing, unhandled promise rejections, empty catch blocks, missing null checks, boundary conditions, operations that can fail silently (e.g., `catch\s*\(\s*\)\s*\{`, `\.catch\s*\(\s*\)`, `try\s*\{[^}]*\}\s*catch\s*\([^)]*\)\s*\{\s*\}`, `\?\s*\.`, optional chaining without fallback). If any file matches, select `qrspi-review-silent-failure`.
   - **Always select** `qrspi-review-code-quality` — code quality review runs on every task regardless of content heuristics.
   - Additional lenses (`qrspi-review-test-coverage`, `qrspi-review-test-quality`, `qrspi-review-code-simplifier`, `qrspi-review-goal-traceability`) are selected by other heuristics — for this task, only the three lenses above (`code-quality`, `security`, `silent-failure`) are created; the orchestrator prompt should acknowledge the full set but only dispatch the lenses that actually exist.

3. **Dispatch Selected Lenses.** For each selected lens, dispatch via `qrspi_dispatch` with `subagent_type` set to the lens name (e.g., `"qrspi-review-code-quality"`). Pass the full content of each changed file in the prompt, along with the task spec context and `=== RUN ID === <run-id>`. Lenses can be dispatched in parallel (issue all dispatches in one turn, then process results after they return).

4. **Collate Findings.** After all lenses return their outputs:
   - Parse each lens output for `### Status` (PASS or FAIL) and `### Findings` (a bulleted list of issues found).
   - Categorize each finding as:
     - **Blocking:** A defect that would cause incorrect behavior, data loss, a security vulnerability, an unhandled failure path, or a violation of a functional requirement. The implementation must not be marked clean while any blocking finding is unaddressed.
     - **Advisory:** A style issue, a naming suggestion, a possible improvement that does not strictly affect correctness, or a simplification that does not change semantics. Advisory findings can be deferred.
   - If multiple lenses flag the same issue, merge them into a single finding referencing both lenses.

5. **Produce Verdict.** Write the collated findings to `.pipeline/<run-id>/reviews/task-NN-code-review.md` and return the following structured output:

```
### Status — PASS (or FAIL)

### Blocking Findings
- [BLOCKING] <description> (source: <lens-name>)
...

### Advisory Findings
- [ADVISORY] <description> (source: <lens-name>)
...

### Summary
<One-line summary of review: number of blocking, number of advisory, lenses dispatched>
```

A status of FAIL means at least one blocking finding was identified. PASS means no blocking findings (advisory findings alone do not block).

### Agent 2: `agents/qrspi-review-code-quality.md` (Code Quality Review Lens)

**Role:** Read-only review lens that inspects a single task's changed files for general code quality issues: readability, naming, structure, duplication, complexity, adherence to project conventions, and maintainability concerns. Does not assess security, performance, test coverage, or goal traceability — those are separate lenses.

**Frontmatter:**
- `description`: "Code quality review lens — inspects one task's changed files for readability, naming, duplication, complexity, and maintainability concerns. Read-only."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `15`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-review-code-quality.md`):**

The reviewer receives the full content of the task's changed files and the task spec context. It must:

1. Read every changed file provided in the prompt.
2. Assess each file against a code quality checklist:
   - **Naming:** Are variables, functions, types, and files named clearly and consistently? Do names reveal intent?
   - **Structure:** Are functions/classes/modules appropriately sized and single-responsibility? Is nesting depth manageable?
   - **Duplication:** Is any logic or data shape duplicated across files? Can shared helpers reduce duplication?
   - **Complexity:** Are there overly complex expressions, deeply nested conditionals, or functions with too many parameters?
   - **Readability:** Are comments present where intent is non-obvious? Is the code self-documenting? Are magic numbers explained?
   - **Convention:** Does the code follow the project's existing conventions (formatting, import ordering, error handling patterns, type usage)?
3. Produce findings as concrete, specific observations with file paths and line references. Do not make vague or subjective statements.
4. Return output in this format:

```
### Status — PASS (or FAIL)

### Findings
- [<severity>] <file>:<line-range> — <concrete observation with rationale>
...
```

Severity: `BLOCKING` for issues that make the code unmaintainable or incorrect (e.g., logic errors visible from structure), `HIGH` for significant quality issues, `MEDIUM` for moderate concerns, `LOW` for minor improvements.

5. This agent is **read-only**. It must not modify any file. It is restricted to the `read`, `bash`, `grep`, `find`, and `ls` tools. The `bash` tool may be used for git operations (`git diff`, `git show`) and file inspection (`cat`, `head`, `tail`, `wc`), but must not mutate the working tree.

### Agent 3: `agents/qrspi-review-security.md` (Security Review Lens)

**Role:** Read-only review lens that inspects one task's changed files for concrete, exploitable security vulnerabilities. Focuses on implementation-level security issues, not architectural threat modeling. The review must be evidence-based — every finding must cite a specific code pattern and explain the exploit vector.

**Frontmatter:**
- `description`: "Security review lens — inspects one task's changed files for concrete security vulnerabilities: injection, auth bypass, secret exposure, unsafe deserialization, path traversal. Read-only."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `15`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-review-security.md`):**

The reviewer receives the full content of the task's changed files and the task spec context. It must:

1. Read every changed file provided in the prompt.
2. Assess each file against a security vulnerability checklist:
   - **Injection:** SQL injection, command injection (shell metacharacters in `exec`/`spawn`/`child_process` calls), template injection, LDAP/XPATH injection, log injection.
   - **Authentication and Authorization:** Missing or bypassable auth checks, insecure session handling, hardcoded credentials, weak token generation, incorrect permission scoping.
   - **Secret Exposure:** API keys, passwords, tokens, private keys, or connection strings in source code, config files, logs, or error messages.
   - **Input Validation:** Missing or insufficient sanitization of user-controlled input before use in dangerous contexts (file paths, HTTP headers, HTML output, SQL statements).
   - **Cryptography:** Use of weak algorithms (MD5, SHA-1 for security), insecure random number generation (`Math.random()` for tokens), hardcoded keys/IVs, improper certificate validation, timing side-channels.
   - **Path Traversal:** File operations with user-controlled path segments that could escape intended directories.
   - **Unsafe Deserialization:** `eval` of untrusted data, `JSON.parse` without schema validation leading to prototype pollution, dynamic `require`/`import` of user-controlled module paths.
   - **Sensitive Data Handling:** Logging of PII, passwords, or tokens; insecure data at rest; missing encryption of sensitive data in transit.
3. For each finding, explain:
   - The vulnerable code pattern (with exact file path and line reference)
   - The attack vector (how an attacker would exploit it)
   - The potential impact (data exposure, privilege escalation, denial of service, etc.)
   - Whether the finding is **definite** (confirmed exploitable from code alone) or **potential** (requires additional context or configuration to be exploitable)
4. Return output in this format:

```
### Status — PASS (or FAIL)

### Findings
- [<severity>/<confidence>] <file>:<line> — <vulnerability description>
  Attack vector: <exploit description>
  Impact: <potential damage>
...
```

Severity: `CRITICAL` (remote code execution, privilege escalation, mass data exposure), `HIGH` (authenticated data breach, injection with limited scope), `MEDIUM` (information disclosure, denial of service), `LOW` (defense-in-depth improvements, best practice violations without clear exploit). Confidence: `DEFINITE` or `POTENTIAL`. A CRITICAL or HIGH finding that is DEFINITE is always a blocking finding. A POTENTIAL finding may be flagged as advisory at the orchestrator's discretion.

5. This agent is **read-only**. It must not modify any file. It must not attempt to exploit vulnerabilities (no active scanning or attack simulation). It is restricted to the `read`, `bash`, `grep`, `find`, and `ls` tools. The `bash` tool may be used for git operations and file inspection but must not mutate the working tree.

### Agent 4: `agents/qrspi-review-silent-failure.md` (Silent Failure / Edge Case Review Lens)

**Role:** Read-only review lens that inspects one task's changed files for error handling gaps, edge cases, and failure modes that could produce incorrect behavior without obvious symptoms. Focuses on: swallowed errors, missing null/undefined checks, unvalidated boundaries, race conditions, resource leaks, and partial-failure scenarios where the system could continue in a degraded state without detection.

**Frontmatter:**
- `description`: "Silent failure review lens — inspects one task's changed files for error swallowing, unhandled rejections, missing null checks, edge cases, and partial-failure scenarios. Read-only."
- `tools`: `read, bash, grep, find, ls`
- `model`: `anthropic/claude-haiku-4-5`
- `thinking`: `low`
- `max_turns`: `15`
- `prompt_mode`: `replace`
- `extensions`: `false`
- `enabled`: `false`

**System prompt body (adapted from opencode `qrspi-review-silent-failure.md`):**

The reviewer receives the full content of the task's changed files and the task spec context. It must:

1. Read every changed file provided in the prompt.
2. Assess each file against a silent-failure and edge-case checklist:
   - **Error Swallowing:** Empty `catch` blocks, `catch` blocks that only log without re-throwing or handling, `.catch(() => {})` promises, suppressed error returns (e.g., ignoring an error-return value from a function call).
   - **Unhandled Promise Rejections:** `async` functions called without `await` or `.catch()`, promise chains missing terminal `.catch()`, `Promise.all` without individual rejection handling, fire-and-forget promises whose failures are never observed.
   - **Null / Undefined Handling:** Missing null checks on function parameters, return values from external calls, or properties accessed via optional chaining that lack a fallback. Cases where `undefined` or `null` could propagate to a context that assumes a valid value.
   - **Boundary Conditions:** Off-by-one errors in loops or array indexing, empty input cases (empty string, empty array, zero value), maximum/minimum value overflows, concurrent modification of shared state.
   - **Race Conditions:** Shared mutable state accessed without synchronization, file-system operations without atomicity guarantees, time-of-check-to-time-of-use (TOCTOU) patterns, asynchronous operations whose ordering assumptions are not enforced.
   - **Resource Leaks:** File handles, network sockets, database connections, or timers/intervals created without corresponding cleanup in all exit paths (including error paths).
   - **Partial Failures:** Multi-step operations where some steps succeed and others fail, leaving the system in an inconsistent state. Transaction rollback omissions. Idempotency violations in retry scenarios.
   - **Assumptions About External State:** Code that assumes a file exists, a network is reachable, an environment variable is set, a service responds within a timeout, or data conforms to an expected shape — without validation or graceful fallback.
3. For each finding, explain:
   - The vulnerable pattern (with exact file path and line reference)
   - The trigger scenario (what input, timing, or environment condition would expose the failure)
   - The silent consequence (what goes wrong that would not produce an obvious error — e.g., incorrect data written, stale cache served, resource exhaustion over time)
   - Whether the failure produces a **visible error** (user-visible, logged, or monitored) or a **truly silent failure** (no observable symptom until secondary effects accumulate)
4. Return output in this format:

```
### Status — PASS (or FAIL)

### Findings
- [<severity>/<visibility>] <file>:<line> — <failure description>
  Trigger: <scenario that exposes the failure>
  Silent consequence: <what goes wrong without obvious symptoms>
...
```

Severity: `BLOCKING` (guaranteed data corruption, resource exhaustion, or incorrect behavior under normal operation), `HIGH` (likely failure under uncommon but realistic conditions), `MEDIUM` (failure only under edge cases or adversarial conditions), `LOW` (defensive improvement with low probability of triggering). Visibility: `SILENT` (no error, log, or alert produced), `VISIBLE` (error surfaced but may be missed or ignored). BLOCKING severity is always a blocking finding regardless of visibility. HIGH severity with SILENT visibility is also blocking.

5. This agent is **read-only**. It must not modify any file. It is restricted to the `read`, `bash`, `grep`, `find`, and `ls` tools. The `bash` tool may be used for git operations and file inspection but must not mutate the working tree.

## Files
- `agents/qrspi-code-review.md` (CREATE) — Code review orchestrator agent type. Reads task changed files, applies regex heuristics (SECURITY_RE, SILENT_RE) to select review lenses, dispatches selected lenses via `qrspi_dispatch`, collates findings into blocking vs advisory categories, writes collated review to `.pipeline/<run-id>/reviews/task-NN-code-review.md`, and returns structured verdict with `### Status`, `### Blocking Findings`, `### Advisory Findings`, `### Summary`. Tools: all 7, max_turns: 40, thinking: low, model: anthropic/claude-sonnet-4-5. YAML frontmatter includes `enabled: false` (hidden from listing but spawnable).
- `agents/qrspi-review-code-quality.md` (CREATE) — Code quality review lens agent type. Reviews one task's changed files for naming, structure, duplication, complexity, readability, and convention adherence. Read-only (tools: read, bash, grep, find, ls). Returns `### Status — PASS/FAIL` with `### Findings` list (severity: BLOCKING/HIGH/MEDIUM/LOW). max_turns: 15, thinking: low, model: anthropic/claude-haiku-4-5. YAML frontmatter includes `enabled: false`.
- `agents/qrspi-review-security.md` (CREATE) — Security review lens agent type. Reviews one task's changed files for injection, auth bypass, secret exposure, unsafe deserialization, path traversal, weak cryptography. Read-only (tools: read, bash, grep, find, ls). Returns `### Status — PASS/FAIL` with `### Findings` list (severity: CRITICAL/HIGH/MEDIUM/LOW, confidence: DEFINITE/POTENTIAL) including attack vector and impact. max_turns: 15, thinking: low, model: anthropic/claude-haiku-4-5. YAML frontmatter includes `enabled: false`.
- `agents/qrspi-review-silent-failure.md` (CREATE) — Silent failure / edge case review lens agent type. Reviews one task's changed files for error swallowing, unhandled rejections, missing null checks, boundary conditions, race conditions, resource leaks, partial failures, and assumptions about external state. Read-only (tools: read, bash, grep, find, ls). Returns `### Status — PASS/FAIL` with `### Findings` list (severity: BLOCKING/HIGH/MEDIUM/LOW, visibility: SILENT/VISIBLE) including trigger scenario and silent consequence. max_turns: 15, thinking: low, model: anthropic/claude-haiku-4-5. YAML frontmatter includes `enabled: false`.

## Test Expectations
- **Orchestrator frontmatter correctness:** When the `agents/qrspi-code-review.md` file is parsed for YAML frontmatter, expect the `description` field to be non-empty and describe the orchestrator role, `tools` to be `"read, bash, grep, find, ls, write, edit"`, `model` to be `"anthropic/claude-sonnet-4-5"`, `thinking` to be `"low"`, `max_turns` to be `40`, `prompt_mode` to be `"replace"`, `extensions` to be `false`, and `enabled` to be `false`.
- **Code-quality lens frontmatter correctness:** When the `agents/qrspi-review-code-quality.md` file is parsed for YAML frontmatter, expect the `description` field to reference code quality review, `tools` to be `"read, bash, grep, find, ls"` (read-only — no `write` or `edit`), `model` to be `"anthropic/claude-haiku-4-5"`, `thinking` to be `"low"`, `max_turns` to be `15`, `prompt_mode` to be `"replace"`, `extensions` to be `false`, and `enabled` to be `false`.
- **Security lens frontmatter correctness:** When the `agents/qrspi-review-security.md` file is parsed for YAML frontmatter, expect the `description` field to reference security vulnerability review, `tools` to be `"read, bash, grep, find, ls"` (read-only), `model` to be `"anthropic/claude-haiku-4-5"`, `thinking` to be `"low"`, `max_turns` to be `15`, `prompt_mode` to be `"replace"`, `extensions` to be `false`, and `enabled` to be `false`.
- **Silent-failure lens frontmatter correctness:** When the `agents/qrspi-review-silent-failure.md` file is parsed for YAML frontmatter, expect the `description` field to reference silent failure or edge case review, `tools` to be `"read, bash, grep, find, ls"` (read-only), `model` to be `"anthropic/claude-haiku-4-5"`, `thinking` to be `"low"`, `max_turns` to be `15`, `prompt_mode` to be `"replace"`, `extensions` to be `false`, and `enabled` to be `false`.
- **Model tier separation:** When all four agent files are inspected, expect the orchestrator (`qrspi-code-review.md`) to use a sonnet-tier model and all three review lenses (`qrspi-review-code-quality.md`, `qrspi-review-security.md`, `qrspi-review-silent-failure.md`) to use a haiku-tier model, satisfying AC 7 (multiple model tiers).
- **Orchestrator system prompt present and complete:** When the body of `qrspi-code-review.md` (below the YAML frontmatter) is inspected, expect it to describe a process for reading task changed files, applying regex-based reviewer-selection heuristics (mentioning `SECURITY_RE` and `SILENT_RE` patterns), dispatching selected review lenses via `qrspi_dispatch`, collating findings into blocking and advisory categories, and returning a structured output block containing `### Status`, `### Blocking Findings`, `### Advisory Findings`, and `### Summary`.
- **Code-quality lens system prompt present and complete:** When the body of `qrspi-review-code-quality.md` is inspected, expect it to describe a read-only review process with a checklist covering naming, structure, duplication, complexity, readability, and convention, and to specify a return format with `### Status` and `### Findings`.
- **Security lens system prompt present and complete:** When the body of `qrspi-review-security.md` is inspected, expect it to describe a read-only review process with a vulnerability checklist covering injection, auth, secret exposure, input validation, cryptography, path traversal, unsafe deserialization, and sensitive data handling, and to specify a return format with `### Status` and `### Findings` including attack vector and impact for each finding.
- **Silent-failure lens system prompt present and complete:** When the body of `qrspi-review-silent-failure.md` is inspected, expect it to describe a read-only review process with a checklist covering error swallowing, unhandled rejections, null/undefined handling, boundary conditions, race conditions, resource leaks, partial failures, and assumptions about external state, and to specify a return format with `### Status` and `### Findings` including trigger scenario and silent consequence for each finding.
- **Read-only enforcement on lenses:** When the three lens agent files are inspected, expect none of them to include `write` or `edit` in their `tools` frontmatter field, and each lens system prompt body to explicitly state that the agent is read-only and must not modify any file.
- **No mutating tool access on lenses:** When any lens agent file is inspected, expect the `tools` frontmatter to not contain `write`, `edit`, or any tool that could mutate the filesystem beyond read-only inspection.
- **Orchestrator has full tool access:** When `qrspi-code-review.md` is inspected, expect the `tools` frontmatter to include `write` and `edit` (the orchestrator writes the collated review file to `.pipeline/<run-id>/reviews/`).

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
