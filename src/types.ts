import type { AgentToolResult, ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

export type Route = "full" | "quick-fix" | "unknown";
export type InteractionMode = "interactive" | "automated";
export type FailurePolicy = "fail-closed" | "best-effort";
export type ResumeSource = "fresh" | "resume" | "artifacts";
export type ReviewState = "clean" | "unclean-cap" | "stable-cap";
export type StageStatus = "PASS" | "FAIL" | "PARTIAL" | "SKIP";
export type VerifyStatus = "PASS" | "PARTIAL" | "FAIL";

export type StageName =
  | "goals"
  | "research"
  | "design"
  | "structure"
  | "plan"
  | "implement"
  | "accept"
  | "replan"
  | "verify"
  | "report";

export type NextStage = StageName | "done";

export type BackwardLoopClassification =
  | "LOOP_PLAN"
  | "LOOP_STRUCTURE"
  | "LOOP_DESIGN"
  | "LOOP_GOALS"
  | "DEFER_REPLAN"
  | "NO_LOOP";

export interface BackwardLoopRequest {
  classification: BackwardLoopClassification;
  summary: string;
  guidance?: string;
  targetStage?: StageName;
  localFixAllowed?: boolean;
  deferredRemediation?: boolean;
  details?: Record<string, unknown>;
}

export interface PhaseHistoryEntry {
  phase: number;
  completedStages: StageName[];
}

export interface RunState {
  runId: string;
  userTask?: string;
  route: Route;
  currentPhase: number;
  totalPhases: number;
  lastCompletedStage: StageName | "none";
  nextStage: NextStage;
  stagesCompleted: StageName[];
  phaseHistory: PhaseHistoryEntry[];
  backwardLoops: number;
  verifyFixAttempts: number;
  resumeSource: ResumeSource;
  interactionMode: InteractionMode;
  failurePolicy: FailurePolicy;
  verifyStatus?: VerifyStatus;
  startedAt: string;
  updatedAt: string;
}

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

export interface StageOutcome {
  status: StageStatus;
  filesWritten: string[];
  summary: string;
  route?: Route;
  phase?: number;
  nextStage?: NextStage;
  lastCompletedStage?: StageName | "none";
  telemetry?: StageTelemetryContext;
  backwardLoop?: BackwardLoopRequest;
  reportContent?: string;
}

export interface StageTelemetryContext {
  review_rounds?: number;
  terminal_review_state?: ReviewState;
  review_type?: string;
  child_agent_calls?: Record<string, number>;
  evidence_quality?: EvidenceQuality;
  gate_status?: "approved" | "rejected" | "none";
  gate_mode?: InteractionMode | "automated";
  gate_rounds?: number;
  gate_wait_time_s?: number;
  gate_round_details?: GateRoundDetail[];
  verify_status?: VerifyStatus;
  [key: string]: unknown;
}

export interface EvidenceQuality {
  deterministic: number;
  flaky: number;
  harnessNoisy: number;
  ambiguous: number;
  redundant: number;
  noTestTasks: number;
  noTestAuditOverrides: number;
}

export interface GateRoundDetail {
  round: number;
  decision: "approved" | "rejected";
  presented_at: string;
  responded_at: string;
}

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

export interface StageExecutionEnvelope {
  stage: StageName;
  phase?: number;
  stageInstance: number;
  startedAt: string;
}

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

export interface PipelineServices {
  pi: Pick<ExtensionAPI, "exec">;
  commandContext: ExtensionCommandContext;
  eventContext: ExtensionContext;
  dispatcher: Dispatcher;
  agentDefinitions: Map<string, LeafAgentDefinition>;
  gates: GateManager;
  progress: ProgressReporter;
}

export type ThinkingLevelName = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface StageRuntime {
  state: RunState;
  artifacts: RunArtifacts;
  services: PipelineServices;
}

export interface StageModule {
  readonly stage: StageName;
  run(runtime: StageRuntime): Promise<StageOutcome>;
}

export interface ExplicitRunOptions {
  mode?: InteractionMode;
  failurePolicy?: FailurePolicy;
  resumeRunId?: string;
}
