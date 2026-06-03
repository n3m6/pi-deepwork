/**
 * Application port definitions — the source of truth for all shared types.
 * Infrastructure adapters implement the interfaces defined here.
 * The domain layer is imported for pure value types; pi/node imports are temporary
 * and will be removed when the ESLint boundary rule is enforced in Phase 7.
 */

import type { AgentToolResult, ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Re-export pure domain value types
// ---------------------------------------------------------------------------

export type {
  BackwardLoopClassification,
  BackwardLoopRequest,
  EvidenceQuality,
  ExplicitRunOptions,
  GateRoundDetail,
  InteractionMode,
  FailurePolicy,
  NextStage,
  PhaseHistoryEntry,
  ResumeSource,
  ReviewState,
  Route,
  RunState,
  StageOutcome,
  StageName,
  StageStatus,
  StageTelemetryContext,
  VerifyStatus,
} from "../../domain/value/index.js";

import type {
  BackwardLoopClassification,
  BackwardLoopRequest,
  StageName,
  Route,
  InteractionMode,
  FailurePolicy,
  RunState,
  StageOutcome,
} from "../../domain/value/index.js";

import type { DomainEvent } from "../../domain/event/index.js";
import type { Run } from "../../domain/run/index.js";

// ---------------------------------------------------------------------------
// ArtifactId — typed keyspace replacing the 28-field RunArtifacts string bag
// ---------------------------------------------------------------------------

export type SingletonArtifact =
  | "requirements"
  | "goals"
  | "config"
  | "questions"
  | "researchSummary"
  | "researchOpenQuestions"
  | "design"
  | "structure"
  | "plan"
  | "phaseManifest"
  | "baselineResults"
  | "stage9Summary"
  | "stage10Summary";

export type ArtifactId =
  | { kind: SingletonArtifact }
  | { kind: "taskSpec"; phase: number; taskId: string }
  | { kind: "taskOutline"; taskId: string }
  | { kind: "baseTaskSpec"; taskId: string }
  | { kind: "phaseFile"; phase: number; name: string }
  | { kind: "reviewFile"; name: string }
  | { kind: "feedbackFile"; name: string }
  | { kind: "researchFile"; name: string }
  | { kind: "taskOutlineFile"; name: string }
  | { kind: "runFile"; name: string };

// ---------------------------------------------------------------------------
// RunArtifacts — kept for migration compatibility until Phase 5/8
// ---------------------------------------------------------------------------

export interface RunArtifacts {
  workspaceRoot: string;
  runDir: string;
  telemetryDir: string;
  reviewsDir: string;
  feedbackDir: string;
  tasksDir: string;
  outlinesDir: string;
  phasesDir: string;
  archiveDir: string;
  stateFile: string;
  requirementsFile: string;
  goalsFile: string;
  configFile: string;
  researchDir: string;
  researchSummaryFile: string;
  researchQuestionsFile: string;
  researchOpenQuestionsFile: string;
  designFile: string;
  structureFile: string;
  planFile: string;
  phaseManifestFile: string;
  baselineResultsFile: string;
  stage9SummaryFile: string;
  stage10SummaryFile: string;
  eventsFile: string;
  runLogFile: string;
  metricsFile: string;
}

// ---------------------------------------------------------------------------
// Telemetry event schema
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  schema_version: string;
  event_id: string;
  sequence: number;
  ts: string;
  run_id: string;
  writer_agent: "deepwork";
  writer_scope: "orchestrator";
  event_type:
    | "run.started"
    | "run.resumed"
    | "run.completed"
    | "run.aborted"
    | "stage.started"
    | "stage.completed"
    | "stage.failed"
    | "stage.skipped"
    | "stage.retried"
    | "gate.presented"
    | "gate.approved"
    | "gate.rejected"
    | "backward_loop.requested"
    | "backward_loop.decided"
    | "backward_loop.deferred"
    | "backward_loop.reset"
    | "backward_loop.failed"
    | "checkpoint.created"
    | "metrics.generated";
  status: string;
  route: Route;
  summary: string;
  stage?: StageName;
  stage_instance?: number;
  phase?: number;
  task_id?: string;
  review_round?: number;
  attempt?: number;
  child_agent?: string;
  correlation_id?: string;
  context?: Record<string, unknown>;
  artifacts?: string[];
  timing?: {
    started_at?: string;
    ended_at?: string;
    duration_s?: number;
  };
  decision?: {
    choice?: string;
    reason?: string;
  };
  error?: {
    message: string;
    code?: string;
  };
  git?: {
    branch?: string;
    commit?: string;
    dirty?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Stage execution envelope
// ---------------------------------------------------------------------------

export interface StageExecutionEnvelope {
  stage: StageName;
  phase?: number;
  stageInstance: number;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Agent / dispatch types (infrastructure-coupled via pi SDK)
// ---------------------------------------------------------------------------

export type ThinkingLevelName = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface GenericCodingTarget {
  kind: "generic";
  name: "generic-coding";
  tools: string[];
  model?: Model<any>;
  thinkingLevel?: ThinkingLevelName;
}

export interface LeafAgentDefinition {
  kind: "leaf";
  name: string;
  description: string;
  tools: string[];
  modelName?: string;
  thinkingLevel?: ThinkingLevelName;
  maxTurns: number;
  systemPromptMode: "replace" | "append";
  extensions: string[];
  filePath: string;
  body: string;
}

export type DispatchTarget = LeafAgentDefinition | GenericCodingTarget;

export interface DispatchRequest {
  target: DispatchTarget;
  prompt: string;
  cwd: string;
  signal?: AbortSignal;
  tools?: string[];
  customTools?: Array<ToolDefinition<any, any, any>>;
  timeoutMs?: number;
}

export interface DispatchCustomToolCall {
  name: string;
  result: AgentToolResult<unknown>;
}

export interface DispatchResult {
  text: string;
  messages: unknown[];
  customToolCalls: DispatchCustomToolCall[];
  endReason?: "agent_end" | "stage_return" | "aborted" | "max_turns" | "timeout" | "session_error";
  errorMessage?: string;
}

export interface Dispatcher {
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]>;
  dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]>;
}

// ---------------------------------------------------------------------------
// Gate / progress types
// ---------------------------------------------------------------------------

export interface GateChoice {
  value: string;
  comment?: string;
}

export interface GateOption {
  value: string;
  label: string;
}

export interface GateManager {
  readonly interactionMode: InteractionMode;
  readonly failurePolicy: FailurePolicy;
  askText(title: string, question: string, placeholder?: string): Promise<string | undefined>;
  choose(title: string, options: GateOption[], message?: string): Promise<GateChoice | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
}

export interface ProgressReporter {
  setStage(stage: string, detail?: string): void;
  setWidget(lines: string[]): void;
  clear(): void;
}

export interface ShellExecutor {
  exec: ExtensionAPI["exec"];
}

// ---------------------------------------------------------------------------
// Pipeline services + stage runtime (infrastructure-coupled, migration compat)
// ---------------------------------------------------------------------------

export interface PipelineServices {
  pi: Pick<ExtensionAPI, "exec">;
  commandContext: ExtensionCommandContext;
  eventContext: ExtensionContext;
  dispatcher: Dispatcher;
  agentDefinitions: Map<string, LeafAgentDefinition>;
  gates: GateManager;
  progress: ProgressReporter;
  /** Port-based infrastructure — populated by the composition root. */
  versionControl?: VersionControl;
  buildTool?: BuildToolPort;
  artifactRepo?: ArtifactRepository;
  telemetrySink?: TelemetrySink;
  stateRepo?: RunStateRepository;
}

export interface StageRuntime {
  state: RunState;
  artifacts: RunArtifacts;
  services: PipelineServices;
}

export interface StageModule {
  readonly stage: StageName;
  run(runtime: StageRuntime): Promise<StageOutcome>;
}

// ---------------------------------------------------------------------------
// Port aliases for the new naming convention
// ---------------------------------------------------------------------------

export type { Dispatcher as AgentGateway };
export type { GateManager as HumanGate };
export type { ProgressReporter as ProgressPort };

// ---------------------------------------------------------------------------
// AgentCatalog port
// ---------------------------------------------------------------------------

export interface AgentCatalog {
  get(name: string): LeafAgentDefinition | undefined;
  all(): Map<string, LeafAgentDefinition>;
}

// ---------------------------------------------------------------------------
// ArtifactRepository port (uses ArtifactId)
// ---------------------------------------------------------------------------

export interface ArtifactRepository {
  read(id: ArtifactId): Promise<string | undefined>;
  write(id: ArtifactId, content: string): Promise<void>;
  exists(id: ArtifactId): Promise<boolean>;
  resolvePath(id: ArtifactId): string;
  /** Relative path from runDir to the artifact — used for filesWritten telemetry. */
  relPath(id: ArtifactId): string;
  listTaskSpecs(phase?: number): Promise<ArtifactId[]>;
  listBaseTaskSpecs(): Promise<ArtifactId[]>;
  listTaskOutlines(): Promise<ArtifactId[]>;
  listOutlineFiles(): Promise<string[]>;
  listPhases(): Promise<number[]>;
  hasPhaseTaskSpecs(phase: number): Promise<boolean>;
  ensureDirectories(): Promise<void>;
  ensurePhaseLayout(currentPhase: number, totalPhases: number): Promise<void>;
  archiveForBackwardLoop(classification: BackwardLoopClassification): Promise<{ targetStage: StageName; archived: string[] }>;
  writeDeferredFeedback(phase: number, request: BackwardLoopRequest): Promise<void>;
  readWorkspaceFile(relativePath: string): Promise<string | undefined>;
  writeWorkspaceFile(relativePath: string, content: string): Promise<void>;
  /** Legacy path bag, kept for migration compatibility until Phase 5 */
  readonly paths: RunArtifacts;
}

// ---------------------------------------------------------------------------
// RunStateRepository port
// ---------------------------------------------------------------------------

export interface RunStateRepository {
  load(runId: string): Promise<Run | undefined>;
  save(run: Run): Promise<void>;
}

// ---------------------------------------------------------------------------
// TaskWorktreeHandle + VersionControl port
// ---------------------------------------------------------------------------

export interface TaskWorktreeHandle {
  branch: string;
  worktreeRoot: string;
  taskId: string;
  phase: number;
}

export interface VersionControl {
  createRunBranch(runId: string, signal?: AbortSignal): Promise<void>;
  checkpoint(stage: StageName, action: "complete" | "skipped" | "failed", signal?: AbortSignal): Promise<void>;
  resolveRepoRoot(signal?: AbortSignal): Promise<string>;
  prepareWorktree(phase: number, taskId: string, repoRoot: string, signal?: AbortSignal): Promise<TaskWorktreeHandle>;
  squashMerge(worktree: TaskWorktreeHandle, commitMessage: string, signal?: AbortSignal): Promise<{ ok: boolean; conflictOutput?: string }>;
  rebaseWorktree(worktree: TaskWorktreeHandle, signal?: AbortSignal): Promise<{ ok: boolean; output?: string }>;
  continueRebase(worktree: TaskWorktreeHandle, signal?: AbortSignal): Promise<{ ok: boolean; output?: string }>;
  commitWorktreeChanges(worktreeRoot: string, message: string, signal?: AbortSignal): Promise<void>;
  changedFiles(cwd: string, signal?: AbortSignal): Promise<string[]>;
  changedLineCount(cwd: string, signal?: AbortSignal): Promise<number>;
  listWorkspaceFiles(cwd: string, signal?: AbortSignal): Promise<string[]>;
  cleanupWorktree(worktree: TaskWorktreeHandle, signal?: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------------------
// BuildToolPort
// ---------------------------------------------------------------------------

export interface ExecOutcome {
  stdout: string;
  stderr: string;
  code: number;
}

export interface BuildToolPort {
  availableScripts(cwd: string): Promise<string[]>;
  runScript(name: string, cwd: string): Promise<ExecOutcome>;
}

// ---------------------------------------------------------------------------
// TelemetrySink port (receives domain events)
// ---------------------------------------------------------------------------

export interface TelemetrySink {
  record(event: DomainEvent): Promise<void>;
  regenerateRunLog(state: RunState): Promise<void>;
  regenerateMetrics(state: RunState): Promise<void>;
  readEvents(): Promise<TelemetryEvent[]>;
}

// ---------------------------------------------------------------------------
// Clock + IdGenerator ports
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  runId(now?: Date): string;
}
