# Task 04: Shared Tool Implementations

## Metadata
- **Task:** 04
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- **Task 03** (`src/pipeline.ts`) — Provides `PipelineState`, `TelemetryEvent`, `PhaseHistoryEntry` type interfaces, pipeline path helper constants (`STAGE_NAMES`, `stageNumber`, `nextStage`), and pure utility functions (`generateRunId`, `getPipelineDir`, `getGitBranch`, `getStatePath`, `getTelemetryDir`, `getEventsPath`, `getRunLogPath`, `getMetricsPath`, `makeInitialState`, `makeTelemetryEvent`) that shared-tools may import for structured result formatting and path construction. Transitively depends on Task 02 (`src/types/pi-extensions.ts`) for `ExtensionContext`, `ExtensionAPI`, `ToolDefinition`, and `CommandDefinition` type definitions.

## Traceability
- **Acceptance Criteria:** AC 5 — Error handling and user-initiated abortion result in clean state recovery (partial: `qrspi_dispatch` graceful fallback when `@tintinweb/pi-subagents` is absent contributes to the error-handling surface; task provides the degradation pathway that AC 5's `/deepwork-resume` state-machine depends on).
- **NFRs:** NFR: Compatibility — gracefully handles absence of `@tintinweb/pi-subagents` with a fallback message (the `qrspi_dispatch` fallback is the primary mechanism for this NFR at the tool layer).
- **Replan Gate Criteria:** Phase 1 replan gate — tools functional. Both `qrspi_dispatch` and `qrspi_question` must register, accept their parameter schemas, and produce structured text results the orchestrator can parse.

## Source Traceability
- **Goals:** AC 5 (clean state recovery on error/abort), NFR Compatibility (graceful pi-subagents absence)
- **Plan:** Task 04, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice — Shared Infrastructure (extension entry, pipeline helpers, shared tools, orchestrator skill)
- **Structure:** Foundation Slice — `src/shared-tools.ts` (CREATE): provides `QrspiDispatchParams`, `QrspiQuestionParams`, `DispatchResult`, `QuestionResult`, `AgentManagerFacade` type interfaces, and factory functions `createDispatchTool()` and `createQuestionTool()` returning pi `ToolDefinition` objects.

## Description

Implement `src/shared-tools.ts`, which provides the two custom tools that stage orchestrator subagents use to spawn leaf sub-subagents and present interactive prompts to the user. Since the pi-subagents `Agent` tool is blocked in subagent contexts, stage orchestrators rely on these custom tools to perform work that would otherwise require the built-in `Agent` tool.

The module exports:

### Types
- **`QrspiDispatchParams`** — Parameter shape for the `qrspi_dispatch` tool.
  - `subagent_type: string` (required) — Agent type name, e.g. `"qrspi-goals-synthesizer"`.
  - `prompt: string` (required) — Task prompt for the spawned leaf subagent.
  - `description: string` (required) — 3–5 word summary used by pi-subagents for display/logging.
  - `model?: string` — Optional model override.
  - `thinking?: string` — Optional thinking level (`"low"`, `"medium"`, `"high"`).
  - `max_turns?: number` — Optional turn limit.
  - `run_in_background?: boolean` — Default `false`. When `false`, blocks until subagent completes; when `true`, returns immediately.
- **`QrspiQuestionParams`** — Parameter shape for the `qrspi_question` tool.
  - `header: string` (required) — Short label, max ~30 characters.
  - `message: string` (required) — Full question text.
  - `options: string[]` (required) — Available choices.
  - `type: "confirm" | "select"` (required) — Determines which `ctx.ui` method to call.
- **`DispatchResult`** — Normalised result from a sub-subagent dispatch.
  - `agentId: string` — The spawned agent's ID.
  - `status: "completed" | "running" | "failed"` — Final (or current) status.
  - `result?: string` — Subagent output text when status is `"completed"`.
  - `error?: string` — Error message when status is `"failed"`.
  - `toolUses?: number` — Count of tool invocations by the subagent.
  - `startedAt: string` — ISO timestamp of spawn.
  - `completedAt?: string` — ISO timestamp of completion (omitted for background/running).
- **`QuestionResult`** — Structured result from a user prompt.
  - `type: "confirm" | "select"` — Echo of the question type.
  - `header: string` — Echo of the prompt header.
  - `answer: string` — The user's response text or the fallback value.
  - `cancelled: boolean` — `true` if the user cancelled or timed out.
  - `uiUnavailable: boolean` — `true` if `ctx.hasUI` was `false` and a default was used.
- **`AgentManagerFacade`** — Type contract for the object registered at `Symbol.for("pi-subagents:manager")`.
  - `spawn(pi, ctx, type, prompt, options): string` — Background spawn; returns agent ID.
  - `spawnAndWait(pi, ctx, type, prompt, options): Promise<DispatchResult>` — Foreground spawn; blocks until completion.
  - `waitForAll(): Promise<void>` — Blocks until all background agents finish.
  - `hasRunning(): boolean` — Whether any background agents are still active.
  - `getRecord(id: string): DispatchResult | undefined` — Retrieves a dispatch record by ID.

### Factory Functions

#### Module-Level State

The file uses a module-scoped variable to capture the `ExtensionAPI` reference during extension activation so that tool factories can access it without requiring it as a parameter:

- `let _pi: ExtensionAPI | null = null` — Set by `activate()` before any tools are registered. The tool execute closures read this variable at invocation time.
- `let _ctx: ExtensionContext | undefined` — Set by `activate()` for access to the activation context (cwd, etc.) during tool registration.

#### `createDispatchTool(): ToolDefinition`

Returns a `ToolDefinition` for the `qrspi_dispatch` tool. The function takes no arguments because `pi` is captured via the module-scoped `_pi` variable (set by `activate()` before tool registration). The `ExtensionContext` (`ctx`) for the tool execution is received as the last parameter to `execute` at invocation time.

**Execute Implementation:**

1. Read `params` from the tool call; validate that `subagent_type`, `prompt`, and `description` are present and non-empty. Return an error result if validation fails.

2. Resolve the pi-subagents manager:
   - `const manager: AgentManagerFacade | undefined = (globalThis as any)[Symbol.for("pi-subagents:manager")]`
   - If `manager` is `undefined` or `null`, return a structured failure result:
     ```
     ### Status — FAIL
     **Agent:** qrspi_dispatch
     **Error:** `@tintinweb/pi-subagents` is not installed. Install it with:
       pi install npm:@tintinweb/pi-subagents
     ```
     This satisfies the NFR: Compatibility requirement for graceful degradation. No exception is thrown.

3. Build options bag from optional params:
   ```
   { model: params.model, thinking: params.thinking, max_turns: params.max_turns }
   ```
   Omit keys whose values are `undefined` so that pi-subagents' own defaults (inherited from agent config or parent) apply.

4. **Foreground path** (`run_in_background` is `false` or omitted):
   - Read `_pi` from the module scope. If `_pi` is `null` (called before `activate()` or after `session_shutdown`), return a failure result: `### Status — FAIL` with message "Extension not activated."
   - Call `await manager.spawnAndWait(_pi, ctx, params.subagent_type, params.prompt, options)`.
   - Wrap the returned `DispatchResult` in a structured text response that includes the agent ID, status, and full result/error text, formatted for the orchestrator to parse. Example shape:
      ```
      ### Status — PASS
      **Agent:** <agentId>
      **Type:** <subagent_type>
      **Result:**
      <result text>
      ```
   - On `status: "failed"`, emit `### Status — FAIL` with the error text.

5. **Background path** (`run_in_background` is `true`):
   - Read `_pi` from module scope; fail with "Extension not activated." if `null`.
   - Call `const agentId = manager.spawn(_pi, ctx, params.subagent_type, params.prompt, options)`.
   - Return:
     ```
     ### Status — RUNNING
     **Agent:** <agentId>
     **Type:** <subagent_type>
     **Note:** Subagent dispatched in background. Use get_subagent_result to retrieve output.
     ```

The tool's `parameters` property must be a valid pi tool schema (TypeBox-compatible JSON Schema object) describing the parameters above. The `name` must be `"qrspi_dispatch"`, the `label` a short human-readable label, and the `description` a sentence explaining the tool's purpose for LLM consumption.

#### `createQuestionTool(): ToolDefinition`

Returns a `ToolDefinition` for the `qrspi_question` tool. The factory does not need the `pi` reference (it only calls `ctx.ui` methods). The `ExtensionContext` (`ctx`) for UI operations is received as the last parameter to `execute` at invocation time.

**Execute Implementation:**

1. Read `params` from the tool call; validate that `header`, `message`, `options` (non-empty array), and `type` (`"confirm"` or `"select"`) are present. Return an error result if validation fails.

2. **No-UI guard**: If `ctx.hasUI` is `false` (headless/non-interactive mode), default to a safe fallback:
   - `type: "confirm"` → default to `true` (answer `"Yes"`).
   - `type: "select"` → default to `options[0]`.
   - Return a result indicating the default was used because UI is unavailable. Include `uiUnavailable: true` in the `QuestionResult` details.

3. **`type: "confirm"`**:
   - Call `const confirmed = await ctx.ui.confirm(params.header, params.message)`.
   - On `true`: return result with `answer: "Yes"`, `cancelled: false`.
   - On `false` / timeout / cancellation: return result with `answer: "No"`, `cancelled: true`.
   - Format the `content` as `"User confirmed: Yes"` or `"User confirmed: No"` so the orchestrator can parse it.

4. **`type: "select"`**:
   - Call `const selection = await ctx.ui.select(params.header, params.options)`.
   - If `selection` is a string: return result with `answer: selection`, `cancelled: false`.
   - If `selection` is `undefined` (cancelled/timed out): return result with `answer: ""`, `cancelled: true`.
   - Format the `content` as `"User selected: <selection>"` or `"User cancelled selection"`.

The tool's `name` must be `"qrspi_question"`, the `label` a short human-readable label, and the `description` a sentence explaining the tool's purpose for LLM consumption.

### Result Format Convention

Both tools return results in the pi tool contract shape: `{ content: string; details?: Record<string, unknown> }`. The `content` field carries the structured text (with `### Status` blocks for dispatch, plain text for question). The `details` field carries typed metadata (`DispatchResult` for dispatch, `QuestionResult` for question) for programmatic consumption by the orchestrator.

## Files
- `src/shared-tools.ts` (CREATE) — Type interfaces (`QrspiDispatchParams`, `QrspiQuestionParams`, `DispatchResult`, `QuestionResult`, `AgentManagerFacade`), module-level `_pi` and `_ctx` variables, factory functions `createDispatchTool()` and `createQuestionTool()` returning pi `ToolDefinition` objects, and the `execute` closures implementing foreground/background subagent dispatch via `AgentManager` and confirm/select user prompts via `ctx.ui`.

## Test Expectations
- **Foreground dispatch success:** When `qrspi_dispatch` is invoked with `run_in_background: false` and `@tintinweb/pi-subagents` is installed, expect the tool to return `content` containing `### Status — PASS` (or `### Status — FAIL` if the subagent itself failed), the spawned agent's ID, and the subagent's result or error text.
- **Background dispatch:** When `qrspi_dispatch` is invoked with `run_in_background: true` and `@tintinweb/pi-subagents` is installed, expect the tool to return `content` containing `### Status — RUNNING`, the spawned agent's ID, and a note that the subagent was dispatched in background — without blocking for completion.
- **Missing pi-subagents:** When `qrspi_dispatch` is invoked but `@tintinweb/pi-subagents` is not installed (the global symbol evaluates to `undefined`), expect the tool to return `content` containing `### Status — FAIL` and a descriptive error message stating that `@tintinweb/pi-subagents` must be installed — without throwing an uncaught exception.
- **Confirm — affirmative:** When `qrspi_question` is invoked with `type: "confirm"` and the user responds affirmatively (confirm returns `true`), expect the tool to return `content` containing `"User confirmed: Yes"` and `details` with `answer: "Yes"`, `cancelled: false`.
- **Confirm — negative/cancelled:** When `qrspi_question` is invoked with `type: "confirm"` and the user responds negatively, cancels, or the prompt times out (confirm returns `false`), expect the tool to return `content` containing `"User confirmed: No"` and `details` with `answer: "No"`, `cancelled: true`.
- **Select — chosen:** When `qrspi_question` is invoked with `type: "select"`, `options: ["A", "B", "C"]`, and the user picks `"B"`, expect the tool to return `content` containing `"User selected: B"` and `details` with `answer: "B"`, `cancelled: false`.
- **Select — cancelled:** When `qrspi_question` is invoked with `type: "select"` and the user cancels or the prompt times out (select returns `undefined`), expect the tool to return `content` containing `"User cancelled selection"` and `details` with `answer: ""`, `cancelled: true`.
- **No UI available:** When `qrspi_question` is invoked but `ctx.hasUI` is `false`, expect the tool to return a valid result with a safe default (`"Yes"` for confirm, first option for select) and `details` with `uiUnavailable: true` — without throwing or hanging.
- **Parameter validation:** When either tool is invoked with a required parameter missing or invalid (empty `subagent_type`, empty `options` array, unknown `type`), expect the tool to return `content` containing an error description (status `FAIL` or explicit error text) without crashing.
- **Module-level _pi capture:** When `createDispatchTool()` is called (no arguments) after `activate()` has set the module-level `_pi` variable, the returned `ToolDefinition` must pass `_pi` to `AgentManager` calls at execute time. When `createDispatchTool()` is called before `activate()` has run (`_pi` is `null`), the execute closure must return a graceful failure message rather than crashing with a null-reference error.
- **No-argument factory:** When `createDispatchTool()` is invoked with zero arguments, expect a valid `ToolDefinition` to be returned without throwing — the factory signature must be `(): ToolDefinition`.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
