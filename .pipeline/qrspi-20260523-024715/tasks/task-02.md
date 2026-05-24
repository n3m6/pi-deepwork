# Task 02: TypeScript type definitions (`src/types/pi-extensions.ts`)

## Metadata
- **Task:** 02
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- **01 (Project scaffolding and package manifest)** — provides the `src/types/` directory (created by Task 01) and `tsconfig.json` with CommonJS/ES2020 compiler settings that govern how these types are consumed by downstream modules.

## Traceability
- **Acceptance Criteria:** None.
- **NFRs:** None.
- **Replan Gate Criteria:** Phase 1 replan gate (extension compiles)

## Source Traceability
- **Goals:** None directly (infrastructure). This file supports the Phase 1 replan gate, which requires the extension to compile and load.
- **Plan:** Task 02, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice — Shared Infrastructure
- **Structure:** Foundation Slice — `src/types/pi-extensions.ts` (CREATE)

## Description
Create the single TypeScript type-definitions file `src/types/pi-extensions.ts` that encodes pi's documented extension API contract. This file is the **single adjustment point** if the actual pi runtime exposes different shapes from the documented API — all downstream modules (`src/index.ts`, `src/shared-tools.ts`, `src/pipeline.ts`) import their pi-runtime types from this file.

The file must export the following interfaces and type aliases, reflecting the pi extension system as documented in the research summary (extension factory-function lifecycle, `ExtensionAPI`, `resources_discover` event, `ctx.ui` methods) and specified in the Foundation Slice interfaces block of `structure.md`:

### Core Extension API
- **`ExtensionAPI`** — the object passed to the extension's default `activate()` factory function. It provides:
  - `registerCommand(name: string, definition: CommandDefinition): void` — registers a new slash-command.
  - `registerTool(definition: ToolDefinition): void` — registers a custom tool callable by agents.
  - `on(event: string, handler: (...args: any[]) => any): void` — subscribes to pi lifecycle events. The two events relevant to this extension are `"resources_discover"` (for injecting the `deepwork` skill path) and `"session_shutdown"` (for cleanup). The event string is open-ended; any string is accepted for forward compatibility.

- **`ActivateFunction`** — the type signature of the extension's default export. Expressed as:
  ```typescript
  export type ActivateFunction = (pi: ExtensionAPI) => void | Promise<void>;
  ```
  This is the canonical factory-function shape that pi's extension loader expects.

### Command System
- **`CommandDefinition`** — configuration object passed to `pi.registerCommand()`. Fields:
  - `description: string` — human-readable description shown in command listings.
  - `getArgumentCompletions?: () => Promise<Record<string, string[]>>` — optional async function returning completions keyed by argument name.
  - `handler: CommandHandler` — the function invoked when the user issues the command.

- **`CommandHandler`** — the function type for command execution:
  ```typescript
  export type CommandHandler = (args: Record<string, any>, ctx: ExtensionContext) => Promise<void>;
  ```
  The `args` object contains slash-command arguments parsed by pi (e.g., `{ task: "..." }` for `/deepwork`, `{ "run-id": "..." }` for `/deepwork-resume`). The `ctx` is the extension context described below.

### Tool System
- **`ToolDefinition`** — configuration object passed to `pi.registerTool()`. Fields:
  - `name: string` — unique tool identifier (e.g., `"qrspi_dispatch"`).
  - `label: string` — short display label for UI.
  - `description: string` — description shown to the agent when deciding whether to call this tool.
  - `parameters: Record<string, unknown>` — a JSON Schema / TypeBox-compatible object describing the tool's expected parameters. This is consumed by pi's tool parameter validation.
  - `execute(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: (update: { content: string }) => void, ctx: ExtensionContext): Promise<{ content: string; details?: Record<string, unknown> }>` — the function invoked when an agent calls the tool. `toolCallId` is a unique call identifier, `params` are the tool argument values (validated against the `parameters` schema), `signal` supports cancellation, `onUpdate` supports streaming output during execution, and `ctx` is the extension context. The return value's `content` is the text response shown to the agent; optional `details` carry structured metadata.

- **`ToolHandler`** — the function type for `ToolDefinition.execute`, separated as a named type alias for clarity when the `execute` function is defined externally:
  ```typescript
  export type ToolHandler = (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: { content: string }) => void,
    ctx: ExtensionContext
  ) => Promise<{ content: string; details?: Record<string, unknown> }>;
  ```

### Extension Context
- **`ExtensionContext`** — the runtime context passed to every command handler and tool `execute` function. Fields:
  - `ui` — an object exposing interactive UI methods. Contains:
    - `confirm(title: string, message: string, opts?: UIConfirmParams): Promise<boolean>` — presents a yes/no dialog. Returns `true` if the user confirms, `false` on cancel or timeout.
    - `select(title: string, options: string[], opts?: UISelectParams): Promise<string | undefined>` — presents a choice from a list of options. Returns the selected string, or `undefined` on cancel or timeout.
  - `hasUI: boolean` — `true` when the pi session has an interactive UI (terminal/TUI); `false` in print/JSON/headless modes. Tools that require user interaction should check this before calling `ui` methods.
  - `cwd: string` — the current working directory of the pi session.
  - `sessionManager: unknown` — the pi session manager instance. Typed as `unknown` because this extension does not depend on its internal shape; it is passed through to the `AgentManager` facade when spawning sub-subagents.
  - `modelRegistry: unknown` — the pi model registry instance. Typed as `unknown` for the same pass-through reason.
  - `model: string` — the identifier of the model powering the current agent (e.g., `"anthropic/claude-sonnet-4-20250514"`).
  - `signal: AbortSignal` — an abort signal that fires when the session is cancelled or the enclosing command/tool is aborted. Long-running operations should respect this signal.
  - `abort(): void` — triggers session abort from within the extension.
  - `shutdown(): void` — triggers a clean session shutdown.

### UI Parameter Types
- **`UIConfirmParams`** — the optional third argument to `ctx.ui.confirm()`:
  ```typescript
  export interface UIConfirmParams {
    timeout?: number;   // milliseconds before auto-dismissing as "cancel"
    signal?: AbortSignal; // external abort signal
  }
  ```

- **`UISelectParams`** — the optional third argument to `ctx.ui.select()`:
  ```typescript
  export interface UISelectParams {
    timeout?: number;   // milliseconds before auto-dismissing as "cancel"
    signal?: AbortSignal; // external abort signal
  }
  ```

### Skill Injection (resources_discover)
- **`ResourcesDiscoverEvent`** — the event object passed to `"resources_discover"` handlers. When pi emits this event during session startup, the handler receives:
  ```typescript
  export interface ResourcesDiscoverEvent {
    type: "resources_discover";
    cwd: string;
    reason: string;
  }
  ```
  This event is the canonical mechanism for extensions to inject skill paths, prompt paths, and theme paths into pi's resource loader.

- **`SkillInjectionContext`** — alias for `ResourcesDiscoverEvent`, provided under this name because the `resources_discover` event is consumed by the extension's skill injection logic in `src/index.ts`. This name clarifies intent at the call site without requiring the implementer to understand the full event system.

- **`ResourcesDiscoverResult`** — the return value from a `"resources_discover"` event handler:
  ```typescript
  export interface ResourcesDiscoverResult {
    skillPaths?: string[];   // paths to skill files or directories for pi's skill loader
    promptPaths?: string[];  // paths to system prompt overrides
    themePaths?: string[];   // paths to theme definitions
  }
  ```
  This extension returns `{ skillPaths: [".../skills"] }` so pi's native loader and pi-subagents' skill preloader discover `skills/deepwork/SKILL.md`.

### Design Notes for the Implementer
- All interfaces should use **named exports** (`export interface ...` / `export type ...`). Do not use a default export; downstream modules import specific named types.
- The file must contain **only type/interface declarations** — no runtime code, no side effects, no imports from external packages. This keeps it safe for `import type` usage.
- The `ExtensionContext`, `ExtensionAPI`, and `ToolDefinition` interfaces are **assumptions** based on pi's documented extension contract. If the actual pi runtime diverges, this file is the single adjustment point. Mark this at the top of the file with a comment: `// Pi extension API types — assumed from documented pi extension contract. Adjust here if runtime shapes differ.`
- The `UIConfirmParams` and `UISelectParams` interfaces are intentionally identical in this version. They are declared separately (not as a single shared type) so they can diverge independently if pi's future API evolves.

## Files
- `src/types/pi-extensions.ts` (CREATE) — TypeScript-only declaration file exporting all interfaces and type aliases described above: `ExtensionAPI`, `ActivateFunction`, `CommandDefinition`, `CommandHandler`, `ToolDefinition`, `ToolHandler`, `ExtensionContext`, `UIConfirmParams`, `UISelectParams`, `ResourcesDiscoverEvent`, `SkillInjectionContext`, `ResourcesDiscoverResult`.

## Test Expectations
- **Compilation**: When `tsc --noEmit` runs against the project with `src/types/pi-extensions.ts` present and exported types imported by a valid downstream file (e.g., `src/pipeline.ts` importing `ExtensionContext`), expect zero TypeScript errors — all interfaces must satisfy the compiler's structural type checking.
- **Importability by pipeline.ts**: When `src/pipeline.ts` contains `import type { ExtensionContext } from "./types/pi-extensions"`, expect the import resolves without a "module not found" or "type not exported" error.
- **Importability by shared-tools.ts**: When `src/shared-tools.ts` contains `import type { ExtensionAPI, ExtensionContext, ToolDefinition, ToolHandler, UIConfirmParams, UISelectParams } from "./types/pi-extensions"`, expect all six named imports resolve correctly.
- **Importability by index.ts**: When `src/index.ts` contains `import type { ExtensionAPI, ExtensionContext, ToolDefinition, CommandHandler, ActivateFunction, ResourcesDiscoverEvent, ResourcesDiscoverResult } from "./types/pi-extensions"`, expect all seven named imports resolve correctly.
- **ExtensionContext.shape**: When code accesses `ctx.ui.confirm(...)` or `ctx.cwd` on a value typed as `ExtensionContext`, expect no type error — the `ui` property with `confirm`/`select` methods and the `cwd` string property must be present in the interface.
- **ActivateFunction assignment**: When a function declaration `export default function activate(pi: ExtensionAPI): void {}` is typed against `ActivateFunction`, expect the assignment is structurally compatible — the function's parameter count, `pi` type, and return type must match the type alias.
- **No runtime code**: When the file is loaded (e.g., via `require`), expect no side effects — the file must not execute any I/O, mutate globals, or throw at import time.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
