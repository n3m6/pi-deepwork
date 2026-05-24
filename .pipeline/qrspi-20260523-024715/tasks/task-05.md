# Task 05: Extension entry point (`src/index.ts`)

## Metadata
- **Task:** 05
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- **Task 04 (`src/shared-tools.ts`)** — provides `createDispatchTool()` and `createQuestionTool()`, each returning a fully-formed `ToolDefinition` object (with `name`, `label`, `description`, `parameters`, and `execute` fields). The `qrspi_dispatch` tool definition accesses `Symbol.for("pi-subagents:manager")` internally and handles the graceful-fallback case when pi-subagents is absent. The `qrspi_question` tool definition wraps `ctx.ui.confirm()` and `ctx.ui.select()` and returns user selections as structured text. These functions are the sole mechanism for registering the two custom tools.
- **Task 03 (`src/pipeline.ts`)** — provides `generateRunId()`, `getPipelineDir()`, `getGitBranch()`, `getStatePath()`, `getTelemetryDir()`, `getEventsPath()`, `makeInitialState()`, and the `PipelineState` type. The `generateRunId()` function produces IDs in `qrspi-YYYYMMDD-HHMMSS` format. The `makeInitialState()` function returns a `PipelineState` object with all 10 fields populated and `resume_source: "fresh"`. These are used during the `/deepwork` pre-flight flow to create the pipeline directory tree and write the initial `state.md`.
- **Task 02 (`src/types/pi-extensions.ts`)** — provides the `ExtensionAPI`, `ExtensionContext`, `CommandDefinition`, `CommandHandler`, and `ToolDefinition` TypeScript interfaces used as type annotations throughout the file.

## Traceability
- **Acceptance Criteria:** AC 1 (command registration — `/deepwork` slash command registered and callable), AC 2 (resume command registration — `/deepwork-resume` slash command registered and callable), AC 5 (git-unavailable fallback — pipeline proceeds without git branches when `git` is absent, emitting a warning)
- **NFRs:** NFR: Reliability (resume from state — `/deepwork-resume` reads `state.md` and resumes from recorded next stage), NFR: Usability (single command entry — `/deepwork "task"` initiates the full pipeline with one prompt)
- **Replan Gate Criteria:** Phase 1 replan gate (extension activates — extension loads via pi discovery, commands and tools are registered, skill is injected)

## Source Traceability
- **Goals:** AC 1, AC 2, AC 5
- **Plan:** Task 05, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice — Shared Infrastructure
- **Structure:** Foundation Slice — `src/index.ts` (MODIFY)

## Description

Replace the existing stub `src/index.ts` (which currently exports `getReadyMessage()` and a `main()` function) with the full extension entry point. The file must export a **default factory function** `activate(pi: ExtensionAPI)` that pi's extension loader calls when discovering the extension. This function performs all registration and event subscription synchronously or asynchronously (returning `void` or `Promise<void>`).

### `activate()` Registration

The `activate()` function performs four registration operations:

1. **Register the `/deepwork` slash command** via `pi.registerCommand("deepwork", definition)`. The command definition includes:
   - `description`: a human-readable description of what the command does.
   - `getArgumentCompletions`: a function returning `{ task: [] }` (no predefined completions; the task argument accepts free-form text).
   - `handler`: the `/deepwork` command handler (detailed below).

2. **Register the `/deepwork-resume` slash command** via `pi.registerCommand("deepwork-resume", definition)`. The command definition includes:
   - `description`: explains the resume functionality.
   - `getArgumentCompletions`: when possible, scans `.pipeline/` for existing run directories, extracts valid `qrspi-*` run IDs, and returns them as completions for the `run-id` argument. If `.pipeline/` does not exist, returns `{ "run-id": [] }`.
   - `handler`: the `/deepwork-resume` command handler (detailed below).

3. **Register the `qrspi_dispatch` tool** via `pi.registerTool(createDispatchTool())`. Imports `createDispatchTool` from `./shared-tools`. The tool is registered exactly once during activation.

4. **Register the `qrspi_question` tool** via `pi.registerTool(createQuestionTool())`. Imports `createQuestionTool` from `./shared-tools`. The tool is registered exactly once during activation.

5. **Subscribe to the `resources_discover` event** via `pi.on("resources_discover", handler)`. The handler returns `{ skillPaths: [path.join(__dirname, "..", "skills")] }`. This tells pi's skill loader to scan the `skills/` directory, where it will discover `skills/deepwork/SKILL.md` via the `<root>/.../<name>/SKILL.md` convention. The skill is injected into the main agent's context and is available for all commands in the session.

### `/deepwork` Command Handler

The handler receives `args: { task: string }` and `ctx: ExtensionContext`. It executes the pre-flight setup and then emits a kickoff message that causes the main agent (now equipped with the injected deepwork skill) to begin the pipeline.

1. **Validate the task description.** If `args.task` is empty, null, or whitespace-only, use `ctx.ui.confirm("Deepwork Task", "No task description provided. Run a generic deepwork pipeline?", { signal: ctx.signal })`. If the user confirms (returns `true`), use a default task string `"Unspecified task — generic deepwork run"`. If the user declines (returns `false`), abort the command and return a message: "Deepwork aborted — no task description provided."

2. **Generate a run ID.** Call `generateRunId()` from `src/pipeline.ts`. The returned string follows the format `qrspi-YYYYMMDD-HHMMSS`.

3. **Construct the pipeline directory path.** Call `getPipelineDir(runId)` to obtain `.pipeline/<runId>` and derive the telemetry directory path using `getTelemetryDir(runId)`.

4. **Create the pipeline directory tree.** Create the pipeline directory and telemetry subdirectory (equivalent to `mkdir -p .pipeline/<runId>/telemetry`). Use `fs.mkdirSync` with `{ recursive: true }` — no shell invocation required. If directory creation fails, emit an error message and abort the command.

5. **Handle git branching.** Check if `git` is available in `$PATH`:
   - Attempt to run `git --version` (via `child_process.execSync` or `spawnSync`, capturing output; do not throw on failure). If the command succeeds (exit code 0), `git` is available.
   - **If git is available:** Attempt to create a branch named `qrspi/<runId>` from `main` using `git checkout -b qrspi/<runId> main`. If the branch already exists or creation fails for any other reason, emit a warning (`console.warn`) with the specific error message but do **not** abort the command — pipeline state tracking in `.pipeline/` files is sufficient.
   - **If git is NOT available:** Emit `console.warn("git not found in PATH — proceeding without git branching. Pipeline state will be tracked in .pipeline/ files only.")` and continue.

6. **Write initial `state.md`.** Call `makeInitialState(runId)` to obtain a `PipelineState` object. Serialize it as YAML frontmatter (the conventional format is `---\n` lines followed by the YAML key-value pairs, terminated by `---\n`). Write this to `getStatePath(runId)`. The state must record `last_completed_stage: "0"`, `next_stage: "1"`, `resume_source: "fresh"`, and `route: ""` (empty — to be populated by Stage 1).

7. **Create empty `events.jsonl`.** Write an empty file (or a file with a single newline) at `getEventsPath(runId)` so that subsequent telemetry events can be appended.

8. **Emit the kickoff message.** Construct and return/output a structured kickoff message:
   ```
   === RUN ID ===
   <runId>

   === USER TASK ===
   <task>

   Deepwork pipeline starting. Stage 1 (Goals) will begin.
   ```
   This message is sent to the chat/session. The main pi agent, which has the deepwork skill injected via `resources_discover`, reads this message and begins executing the pipeline stages.

### `/deepwork-resume` Command Handler

The handler receives `args: { "run-id": string }` and `ctx: ExtensionContext`. It validates the run ID, reads the existing pipeline state, and emits a resume message.

1. **Validate the run ID.** Check that `args["run-id"]` is non-empty. If empty, return an error message: "No run ID provided. Usage: /deepwork-resume qrspi-YYYYMMDD-HHMMSS".

2. **Verify the pipeline state file exists.** Construct the state path via `getStatePath(args["run-id"])`. Check if the file exists using `fs.existsSync()`. If the file does not exist, return an error message: `Run ID "<run-id>" not found. Check .pipeline/ for valid run IDs.`

3. **Read and parse `state.md`.** Read the file contents. The file uses YAML frontmatter format (`---\n...\n---\n`). Extract the YAML block between the first two `---` delimiters. Parse the YAML fields: `run_id`, `next_stage`, `last_completed_stage`, `route`. If parsing fails, return an error message: `state.md for run "<run-id>" is corrupted. Cannot resume.`

4. **Emit the resume message.** Construct and return/output a structured resume message:
   ```
   === RESUME RUN ID ===
   <runId>

   === RESUME FROM STAGE ===
   Stage <next_stage> (last completed: Stage <last_completed_stage>)

   === ROUTE ===
   <route>

   Resuming deepwork pipeline. The orchestrator will pick up from the recorded next stage.
   ```
   The main agent, with the deepwork skill injected, reads this message and continues execution from `next_stage`.

### Import Conventions

All imports use relative paths within the `src/` directory. Since `tsconfig.json` sets `rootDir: "src"` and `module: "commonjs"`, imports resolve relative to the source file:

- `import { generateRunId, getPipelineDir, getGitBranch, getStatePath, getTelemetryDir, getEventsPath, makeInitialState } from "./pipeline";`
- `import type { PipelineState } from "./pipeline";`
- `import { createDispatchTool, createQuestionTool } from "./shared-tools";`
- `import type { ExtensionAPI, ExtensionContext, CommandDefinition, CommandHandler, ToolDefinition } from "./types/pi-extensions";`

For filesystem operations (mkdir, writeFile, existsSync, readFile), use `node:fs` — already available as a Node.js built-in. For `console.warn`, use the global `console`.

The `path` module (`import * as path from "node:path"`) is used for `path.join(__dirname, "..", "skills")` in the `resources_discover` handler.

## Files
- `src/index.ts` (MODIFY) — Replace the existing stub (which exports `getReadyMessage()` and a `main()` CLI entry point) with the full extension entry point: `export default function activate(pi: ExtensionAPI)` that registers `/deepwork` and `/deepwork-resume` slash commands, registers `qrspi_dispatch` and `qrspi_question` tools via `createDispatchTool()` and `createQuestionTool()` from `src/shared-tools.ts`, subscribes to `resources_discover` to inject the `deepwork` skill path, implements the `/deepwork` command handler (task validation, run ID generation, pipeline directory creation, git branch creation with graceful fallback, initial state writing, empty events.jsonl creation, kickoff message emission), and implements the `/deepwork-resume` command handler (run ID validation, state.md existence check and parsing, resume message emission with next stage and route information).

## Test Expectations
- **Command registration (`/deepwork`):** After `activate(pi)` is called, `pi.registerCommand` has been invoked with name `"deepwork"` and a definition whose `handler` is a callable function receiving `{ task: string }` and an `ExtensionContext`. The command appears in pi's registered command list.
- **Command registration (`/deepwork-resume`):** After `activate(pi)` is called, `pi.registerCommand` has been invoked with name `"deepwork-resume"` and a definition whose `handler` is a callable function receiving `{ "run-id": string }` and an `ExtensionContext`.
- **Tool registration:** After `activate(pi)` is called, `pi.registerTool` has been invoked twice — once with a tool definition whose `name` is `"qrspi_dispatch"` and once with a tool definition whose `name` is `"qrspi_question"`. Both tools appear in pi's registered tool list.
- **Skill injection:** When pi emits a `resources_discover` event during session initialization, the handler subscribed by `activate()` returns an object with `skillPaths` containing a string that ends with `skills` (the directory containing `skills/deepwork/SKILL.md`). The deepwork skill becomes available to the main agent in the session.
- **`/deepwork` with a valid task:** When the `/deepwork` handler is called with `args.task = "Build a chat app"`, a `.pipeline/qrspi-<ts>/` directory is created under the current working directory, containing a `state.md` file (with `run_id` matching the generated ID, `last_completed_stage: "0"`, `next_stage: "1"`, `resume_source: "fresh"`), a `telemetry/` subdirectory, and an empty `events.jsonl` file. The handler returns/output produces a message starting with `=== RUN ID ===` containing the generated run ID and `=== USER TASK ===` containing the task description.
- **`/deepwork` with an empty task (user confirms):** When the `/deepwork` handler is called with `args.task = ""` and `ctx.ui.confirm` resolves to `true`, the pipeline proceeds with a default task string, directories and state are created, and the kickoff message is emitted. No error is thrown.
- **`/deepwork` with an empty task (user declines):** When the `/deepwork` handler is called with `args.task = ""` and `ctx.ui.confirm` resolves to `false`, the handler returns an abort message containing "aborted" and no pipeline directories or state files are created.
- **`/deepwork-resume` with a valid run ID:** When the `/deepwork-resume` handler is called with `args["run-id"] = "qrspi-20260515-143022"` and `.pipeline/qrspi-20260515-143022/state.md` exists with `next_stage: "4"`, `last_completed_stage: "3"`, `route: "full"`, the handler returns/outputs a message containing `=== RESUME RUN ID ===`, `=== RESUME FROM STAGE === Stage 4`, `last completed: Stage 3`, and `=== ROUTE === full`.
- **`/deepwork-resume` with a missing run ID:** When the `/deepwork-resume` handler is called with `args["run-id"] = "qrspi-nonexistent"` and no corresponding `.pipeline/qrspi-nonexistent/state.md` file exists, the handler returns/outputs an error message containing "not found" or similar. No directories are created, and no skill context is modified.
- **`/deepwork-resume` with a corrupted state file:** When the `/deepwork-resume` handler is called with a valid run ID whose `state.md` contains malformed YAML (unparseable), the handler returns/outputs an error message containing "corrupted" and does not proceed.
- **Git unavailable — pipeline continues with warning:** When `git` is not in `$PATH` (the `git --version` check fails with a non-zero exit code or throws), invoking `/deepwork` still creates the `.pipeline/` directory tree, writes `state.md` and empty `events.jsonl`, and emits the kickoff message. A `console.warn` message is produced mentioning "git not found" or "without git". No exception is thrown and no git branch is created.
- **Git available but branch creation fails — pipeline continues with warning:** When `git` is available but `git checkout -b qrspi/<runId> main` fails (e.g., branch already exists), the handler emits a `console.warn` with the git error, still creates the pipeline directory tree and state files, and emits the kickoff message without aborting.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
