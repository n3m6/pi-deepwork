# Task 03: Pipeline helper functions (`src/pipeline.ts`)

## Metadata
- **Task:** 03
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- **Task 02** — provides `src/types/pi-extensions.ts` type definitions. This task does not import them directly (pipeline helpers are framework-agnostic pure functions), but it must compile alongside the pi-extensions types in the same project. If the pi type definitions change, this module's types (`PipelineState`, `TelemetryEvent`, etc.) remain unaffected.

## Traceability
- **Acceptance Criteria:** AC 5 (state file templates — `makeInitialState` produces valid initial state with all 10 fields), AC 6 (pipeline directory conventions — `getPipelineDir` and path helpers produce correct directory paths per the `.pipeline/qrspi-<run-id>/` convention)
- **NFRs:** NFR: Reliability (state file format — `PipelineState` type encodes all 10 fields required by the file-based protocol), NFR: Observability (event templates — `makeTelemetryEvent` produces valid JSONL-compatible event objects matching the telemetry protocol envelope schema)
- **Replan Gate Criteria:** Phase 1 replan gate (pipeline helpers functional — `generateRunId` produces valid IDs, all path helpers return correct paths, state/event templates produce structurally valid objects)

## Source Traceability
- **Goals:** AC 5 (clean state recovery via `PipelineState` / `makeInitialState`), AC 6 (pipeline directory conventions via path helpers)
- **Plan:** Task 03, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice — Shared Infrastructure (pipeline helpers are the reusable runtime that every pipeline stage depends on for run ID generation, directory path construction, state file templates, and event templates)
- **Structure:** Foundation Slice — `src/pipeline.ts` (CREATE). Implements all exported functions and types defined in the structure.md interfaces section: `generateRunId`, `getPipelineDir`, `getGitBranch`, `getStatePath`, `getTelemetryDir`, `getEventsPath`, `getRunLogPath`, `getMetricsPath`, `getPipelinePaths`, `makeInitialState`, `makeTelemetryEvent`, `createRunLogEntry`, `STAGE_NAMES`, `stageNumber`, `nextStage`, and associated types `PipelineState`, `PhaseHistoryEntry`, `TelemetryEvent`, `RunId`, `PipelinePaths`.

## Description
Create `src/pipeline.ts` — a module of pure helper functions and types that form the data foundation of the QRSPI pipeline. Every function is side-effect-free (no file I/O, no fs operations, no shell commands). The module exports named functions for run ID generation, pipeline path construction, state file templates, telemetry event templates, stage name sequencing, and a run-log entry formatter.

### Run ID Generation
`generateRunId()` produces a string in the format `qrspi-YYYYMMDD-HHMMSS` using the current system clock. The date/time components are zero-padded: two-digit month, day, hours, minutes, seconds. Example: `qrspi-20260523-143022`. The function reads from `new Date()` and formats it using UTC methods (`getUTCFullYear()`, `getUTCMonth()+1`, `getUTCDate()`, `getUTCHours()`, `getUTCMinutes()`, `getUTCSeconds()`).

### Pipeline Path Construction
All path helpers are pure string functions that accept a `runId` parameter and return a path relative to the working directory (they do not prepend an absolute `cwd` — callers join with a base directory as needed):

- `getPipelineDir(runId: string): string` — returns `.pipeline/<runId>`. Example: `getPipelineDir("qrspi-20260523-143022")` → `".pipeline/qrspi-20260523-143022"`.
- `getGitBranch(runId: string): string` — returns `qrspi/<runId>`. Example: `getGitBranch("qrspi-20260523-143022")` → `"qrspi/qrspi-20260523-143022"`.
- `getStatePath(runId: string): string` — returns the path to `state.md` under the pipeline directory: `getPipelineDir(runId) + "/state.md"`.
- `getTelemetryDir(runId: string): string` — returns `getPipelineDir(runId) + "/telemetry"`.
- `getEventsPath(runId: string): string` — returns `getTelemetryDir(runId) + "/events.jsonl"`.
- `getRunLogPath(runId: string): string` — returns `getTelemetryDir(runId) + "/run-log.md"`.
- `getMetricsPath(runId: string): string` — returns `getTelemetryDir(runId) + "/metrics-summary.md"`.
- `getPipelinePaths(runId: string): PipelinePaths` — convenience function that returns an object with all above paths computed at once: `{ pipelineDir, gitBranch, statePath, telemetryDir, eventsPath, runLogPath, metricsPath }`.

### State File Templates
`makeInitialState(runId: string): PipelineState` returns a `PipelineState` object representing a fresh pipeline run, with these fields pre-populated:

- `run_id`: the given `runId`
- `route`: `""` (empty string — determined at Stage 1 and updated later)
- `current_phase`: `1`
- `total_phases`: `0` (set to actual count by the plan stage)
- `last_completed_stage`: `"0"` (string; pre-flight has not completed any stages)
- `next_stage`: `"1"` (string; Stage 1 — Goals — is next)
- `stages_completed`: `[]` (empty array)
- `phase_history`: `[]` (empty array)
- `backward_loops`: `0`
- `resume_source`: `"fresh"`

The `PipelineState` interface and the `PhaseHistoryEntry` sub-interface must be exported:

```typescript
export interface PipelineState {
  run_id: string;
  route: "" | "full" | "quick-fix";
  current_phase: number;
  total_phases: number;
  last_completed_stage: string;
  next_stage: string;
  stages_completed: string[];
  phase_history: PhaseHistoryEntry[];
  backward_loops: number;
  resume_source: "fresh" | "resume";
}

export interface PhaseHistoryEntry {
  phase: number;
  completed_stages: string[];
}
```

### Telemetry Event Templates
`makeTelemetryEvent(runId: string, eventType: string, overrides: Partial<TelemetryEvent>): TelemetryEvent` returns a `TelemetryEvent` object with default values pre-populated, then merged with the provided overrides. Defaults:

- `schema_version`: `"1.0"`
- `event_id`: a UUID-like string generated from `runId` + `eventType` + timestamp components (deterministic within a millisecond — use `runId` + `-` + `eventType` + `-` + current UTC ISO string as a composite identifier)
- `sequence`: `0` (caller is responsible for incrementing)
- `ts`: current UTC ISO 8601 string (`new Date().toISOString()`)
- `run_id`: the given `runId`
- `writer_agent`: `"orchestrator"`
- `writer_scope`: `"pipeline"`
- `event_type`: the given `eventType`
- `status`: `"PASS"`
- `route`: `""` (empty string)
- `summary`: `""` (empty string)

All optional fields (`stage`, `stage_instance`, `phase`, `wave`, `task_id`, `review_round`, `attempt`, `child_agent`, `correlation_id`, `payload`) default to `undefined`. The overrides parameter is merged shallowly at the top level — any field present in `overrides` replaces the default. The `payload` object, if provided in overrides, replaces the entire `payload` (no deep merge).

The `TelemetryEvent` interface must be exported matching the telemetry protocol envelope schema from `protocol/telemetry-protocol.md` (25 event types), with the required fields always present and optional scope/payload fields typed as optional:

```typescript
export interface TelemetryEvent {
  schema_version: string;
  event_id: string;
  sequence: number;
  ts: string;
  run_id: string;
  writer_agent: string;
  writer_scope: string;
  event_type: string;
  status: "PASS" | "FAIL" | "SKIP" | "ABORT";
  route: "" | "full" | "quick-fix";
  summary: string;
  stage?: number;
  stage_instance?: string;
  phase?: number;
  wave?: number;
  task_id?: string;
  review_round?: number;
  attempt?: number;
  child_agent?: string;
  correlation_id?: string;
  payload?: {
    context?: Record<string, unknown>;
    artifacts?: string[];
    timing?: { started_at: string; completed_at: string; duration_ms: number };
    decision?: string;
    error?: string;
    git?: { branch: string; commit?: string };
  };
}
```

### Run-Log Entry Formatter
`createRunLogEntry(event: TelemetryEvent): string` formats a single `TelemetryEvent` as a human-readable Markdown line item entry suitable for the `run-log.md` file. The output is a bullet line with the event timestamp, type, status, and summary:

```
- [<ts>] <event_type> — <status>: <summary>
```

Example output:
```
- [2026-05-23T14:30:22.000Z] run.started — PASS: Pipeline initialized with run ID qrspi-20260523-143022
```

### Stage Name Sequencing
The module exports a constant `STAGE_NAMES` — a readonly array of pipeline stage names in their canonical execution order:

```typescript
export const STAGE_NAMES: ReadonlyArray<string> = [
  "goals",
  "questions",
  "research",
  "design",
  "structure",
  "plan",
  "implement",
  "accept",
  "replan",
  "verify",
  "report"
];
```

`stageNumber(name: string): number` returns the 1-based index of a stage name within `STAGE_NAMES`. Returns `0` for unknown names. Matching is case-insensitive. Example: `stageNumber("goals")` → `1`, `stageNumber("Report")` → `11`.

`nextStage(currentStage: string, route: "full" | "quick-fix"): string | null` returns the name of the next stage in sequence, or `null` if `currentStage` is the last stage (`"report"`). For the `quick-fix` route, `"design"` and `"structure"` are skipped — the sequence jumps from `"research"` to `"plan"` and from `"plan"` to `"implement"` (replan is also skipped). The full route walks linearly through all 11 entries in `STAGE_NAMES`. Matching is case-insensitive for `currentStage`. If `currentStage` is unrecognized (not in `STAGE_NAMES`), return `null`.

### Supporting Types
Export these type aliases:
```typescript
export type RunId = string;        // branded concept: a qrspi-YYYYMMDD-HHMMSS string

export interface PipelinePaths {
  pipelineDir: string;
  gitBranch: string;
  statePath: string;
  telemetryDir: string;
  eventsPath: string;
  runLogPath: string;
  metricsPath: string;
}
```

### Summary of All Exports

| Export | Kind | Purpose |
|--------|------|---------|
| `generateRunId()` | function | Produce `qrspi-YYYYMMDD-HHMMSS` run ID from current UTC time |
| `getPipelineDir(runId)` | function | Return `.pipeline/<runId>` path |
| `getGitBranch(runId)` | function | Return `qrspi/<runId>` branch name |
| `getStatePath(runId)` | function | Return path to `state.md` |
| `getTelemetryDir(runId)` | function | Return path to `telemetry/` directory |
| `getEventsPath(runId)` | function | Return path to `events.jsonl` |
| `getRunLogPath(runId)` | function | Return path to `run-log.md` |
| `getMetricsPath(runId)` | function | Return path to `metrics-summary.md` |
| `getPipelinePaths(runId)` | function | Return all paths as a `PipelinePaths` object |
| `makeInitialState(runId)` | function | Produce a fresh `PipelineState` with all 10 fields |
| `makeTelemetryEvent(runId, eventType, overrides)` | function | Produce a `TelemetryEvent` with defaults merged with overrides |
| `createRunLogEntry(event)` | function | Format a `TelemetryEvent` as a run-log bullet line |
| `stageNumber(name)` | function | Return 1-based index of stage name (0 if unknown) |
| `nextStage(currentStage, route)` | function | Return next stage name, or null; skips design/structure/replan for quick-fix |
| `STAGE_NAMES` | const | Readonly array of 11 stage names in execution order |
| `PipelineState` | interface | 10-field state file shape |
| `PhaseHistoryEntry` | interface | Per-phase completion record |
| `TelemetryEvent` | interface | Full telemetry event envelope with optional scope/payload fields |
| `PipelinePaths` | interface | Aggregate of all pipeline directory/file paths |
| `RunId` | type | Branded string type for run IDs |

## Files
- `src/pipeline.ts` (CREATE) — Pure functions for run ID generation, directory path construction, git branch naming, initial state templates, telemetry event templates, run-log entry formatting, and stage name sequencing. Exports supporting types: `PipelineState`, `PhaseHistoryEntry`, `TelemetryEvent`, `PipelinePaths`, `RunId`.

## Test Expectations
- **generateRunId format**: When `generateRunId()` is called, expect a string matching the regex `/^qrspi-\d{8}-\d{6}$/` (e.g., `qrspi-20260523-143022`). The date portion must be the current UTC date; the time portion must be the current UTC time within a tolerance of 1 second.
- **generateRunId uniqueness**: When `generateRunId()` is called twice in rapid succession (within the same second), expect identical return values (same second yields same ID). When called across a second boundary (actual clock rollover, not mocked), expect the time portion to differ.
- **getPipelineDir**: When `getPipelineDir("qrspi-20260523-143022")` is called, expect the return value `".pipeline/qrspi-20260523-143022"`.
- **getGitBranch**: When `getGitBranch("qrspi-20260523-143022")` is called, expect the return value `"qrspi/qrspi-20260523-143022"`.
- **Path helper consistency**: When all individual path helpers (`getStatePath`, `getTelemetryDir`, `getEventsPath`, `getRunLogPath`, `getMetricsPath`) are called with the same `runId`, expect each to return a path under `getPipelineDir(runId)`. The `getPipelinePaths(runId)` result must contain all these values keyed by their respective property names and match the individual function outputs exactly.
- **makeInitialState fields**: When `makeInitialState("qrspi-20260523-143022")` is called, expect a `PipelineState` object with `run_id: "qrspi-20260523-143022"`, `route: ""`, `current_phase: 1`, `total_phases: 0`, `last_completed_stage: "0"`, `next_stage: "1"`, `stages_completed: []`, `phase_history: []`, `backward_loops: 0`, `resume_source: "fresh"`. All 10 fields must be present.
- **makeTelemetryEvent defaults**: When `makeTelemetryEvent("qrspi-20260523-143022", "run.started", {})` is called, expect a `TelemetryEvent` with `run_id: "qrspi-20260523-143022"`, `event_type: "run.started"`, `schema_version: "1.0"`, `writer_agent: "orchestrator"`, `writer_scope: "pipeline"`, `status: "PASS"`, `route: ""`, `summary: ""`. The `ts` field must be a valid ISO 8601 string. The `event_id` field must be a non-empty string containing the run ID and event type.
- **makeTelemetryEvent overrides**: When `makeTelemetryEvent("qrspi-xxx", "stage.completed", { status: "FAIL", stage: 1, summary: "Stage 1 failed" })` is called, expect the returned object to have `status: "FAIL"`, `stage: 1`, `summary: "Stage 1 failed"` while retaining the default `event_type: "stage.completed"` and `run_id: "qrspi-xxx"`.
- **createRunLogEntry format**: When `createRunLogEntry(event)` is called with a `TelemetryEvent` that has `ts: "2026-05-23T14:30:22.000Z"`, `event_type: "run.started"`, `status: "PASS"`, and `summary: "Pipeline initialized"`, expect the return value to be exactly `"- [2026-05-23T14:30:22.000Z] run.started — PASS: Pipeline initialized"`.
- **STAGE_NAMES order**: When `STAGE_NAMES` is read, expect an array of exactly 11 strings in order: `["goals", "questions", "research", "design", "structure", "plan", "implement", "accept", "replan", "verify", "report"]`.
- **stageNumber valid inputs**: When `stageNumber("goals")` is called, expect `1`. When `stageNumber("Design")` is called (case-insensitive), expect `4`. When `stageNumber("report")` is called, expect `11`.
- **stageNumber invalid input**: When `stageNumber("nonexistent")` is called, expect `0`.
- **nextStage full route**: When `nextStage("goals", "full")` is called, expect `"questions"`. When `nextStage("design", "full")` is called, expect `"structure"`. When `nextStage("report", "full")` is called, expect `null`.
- **nextStage quick-fix route skips**: When `nextStage("research", "quick-fix")` is called, expect `"plan"` (skipping design and structure). When `nextStage("plan", "quick-fix")` is called, expect `"implement"`. When `nextStage("implement", "quick-fix")` is called, expect `"accept"` (replan is skipped). When `nextStage("accept", "quick-fix")` is called, expect `"verify"`.
- **nextStage invalid inputs**: When `nextStage("bogus", "full")` is called, expect `null`. When `nextStage("", "quick-fix")` is called, expect `null`.
- **All functions are pure**: When any exported function is called multiple times with the same arguments (excluding `generateRunId` which depends on wall-clock time), expect identical return values. No function reads from or writes to the filesystem, environment variables, or global mutable state other than `Date` for time-dependent functions.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
