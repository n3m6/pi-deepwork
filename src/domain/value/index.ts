// Pure domain value types — no node:* or pi imports allowed.

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
  acceptFixAttempts: number;
  verifyFixAttempts: number;
  resumeSource: ResumeSource;
  interactionMode: InteractionMode;
  failurePolicy: FailurePolicy;
  verifyStatus?: VerifyStatus;
  startedAt: string;
  updatedAt: string;
}

export interface ExplicitRunOptions {
  mode?: InteractionMode;
  failurePolicy?: FailurePolicy;
  resumeRunId?: string;
}
