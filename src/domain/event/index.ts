// Domain events — emitted by the pipeline; consumed by TelemetrySink.
// No node:* or pi imports.

import type {
  BackwardLoopClassification,
  BackwardLoopRequest,
  Route,
  StageName,
  StageOutcome,
} from "../value/index.js";

/**
 * Common stage-level fields shared by all stage/gate/backward-loop events.
 * Callers build one StageContext and spread it to avoid repeating the quartet.
 */
export interface StageContext {
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
}

export type DomainEvent =
  | RunStarted
  | RunResumed
  | RunCompleted
  | RunAborted
  | StageStarted
  | StageCompleted
  | StageFailed
  | StageSkipped
  | StageRetried
  | GatePresented
  | GateApproved
  | GateRejected
  | BackwardLoopRequested
  | BackwardLoopDecided
  | BackwardLoopDeferred
  | BackwardLoopReset
  | BackwardLoopFailed
  | PhaseStarted
  | ReviewRoundStarted
  | ReviewRoundCompleted
  | DispatchStarted
  | DispatchCompleted
  | TaskStarted
  | TaskCompleted;

export interface RunStarted {
  type: "run.started";
  runId: string;
  route: Route;
}

export interface RunResumed {
  type: "run.resumed";
  runId: string;
  route: Route;
}

export interface RunCompleted {
  type: "run.completed";
  runId: string;
  route: Route;
  status: "PASS" | "PARTIAL";
}

export interface RunAborted {
  type: "run.aborted";
  runId: string;
  route: Route;
  error: string;
}

export interface StageStarted {
  type: "stage.started";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
}

export interface StageCompleted {
  type: "stage.completed";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  outcome: StageOutcome;
  startedAt: string;
  endedAt: string;
}

export interface StageFailed {
  type: "stage.failed";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  summary: string;
  context?: Record<string, unknown>;
  error?: string;
}

export interface StageSkipped {
  type: "stage.skipped";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  summary: string;
}

export interface StageRetried {
  type: "stage.retried";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  summary: string;
  context?: Record<string, unknown>;
}

export interface GatePresented {
  type: "gate.presented";
  stage: StageName;
  phase: number;
  stageInstance?: number;
  route: Route;
  summary: string;
}

export interface GateApproved {
  type: "gate.approved";
  stage: StageName;
  phase: number;
  stageInstance?: number;
  route: Route;
  summary: string;
}

export interface GateRejected {
  type: "gate.rejected";
  stage: StageName;
  phase: number;
  stageInstance?: number;
  route: Route;
  summary: string;
}

export interface BackwardLoopRequested {
  type: "backward_loop.requested";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  request: BackwardLoopRequest;
}

export interface BackwardLoopDecided {
  type: "backward_loop.decided";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  targetStage: StageName;
  request: BackwardLoopRequest;
}

export interface BackwardLoopDeferred {
  type: "backward_loop.deferred";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  request: BackwardLoopRequest;
}

export interface BackwardLoopReset {
  type: "backward_loop.reset";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  targetStage: StageName;
  archived: string[];
}

export interface BackwardLoopFailed {
  type: "backward_loop.failed";
  stage: StageName;
  phase: number;
  stageInstance: number;
  route: Route;
  classification: BackwardLoopClassification;
  maxLoops: number;
}

// ---------------------------------------------------------------------------
// Sub-stage progress events — emitted from within stage/workflow code.
// These carry phase/route but omit stageInstance (pipeline-layer concept).
// ---------------------------------------------------------------------------

export interface PhaseStarted {
  type: "phase.started";
  phase: number;
  totalPhases: number;
  route: Route;
}

export interface ReviewRoundStarted {
  type: "review.round.started";
  stage: StageName;
  phase: number;
  route: Route;
  reviewRound: number;
  maxRounds: number;
}

export interface ReviewRoundCompleted {
  type: "review.round.completed";
  stage: StageName;
  phase: number;
  route: Route;
  reviewRound: number;
  maxRounds: number;
  status: "PASS" | "FAIL";
}

export interface DispatchStarted {
  type: "dispatch.started";
  stage?: StageName;
  phase: number;
  route: Route;
  childAgent: string;
  taskId?: string;
}

export interface DispatchCompleted {
  type: "dispatch.completed";
  stage?: StageName;
  phase: number;
  route: Route;
  childAgent: string;
  taskId?: string;
  endReason?: string;
  status: "PASS" | "FAIL" | "PARTIAL";
}

export interface TaskStarted {
  type: "task.started";
  phase: number;
  route: Route;
  taskId: string;
  title: string;
  wave: number;
}

export interface TaskCompleted {
  type: "task.completed";
  phase: number;
  route: Route;
  taskId: string;
  title: string;
  wave: number;
  status: "PASS" | "FAIL";
}
