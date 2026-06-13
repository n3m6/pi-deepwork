// Run aggregate — owns RunState mutations; emits no side effects.
// No node:* or pi imports.

import type {
  FailurePolicy,
  InteractionMode,
  NextStage,
  PhaseHistoryEntry,
  ReviewDepth,
  Route,
  RunState,
  StageName,
  VerifyStatus,
} from "../value/index.js";

export const MAX_BACKWARD_LOOPS = 3;
export const MAX_ACCEPT_FIX_ATTEMPTS = 2;
export const MAX_VERIFY_FIX_ATTEMPTS = 3;

/** Maximum per-round retries for transient dispatch failures (timeout, session_error). */
export const MAX_TRANSIENT_DISPATCH_RETRIES = 1;

/** Review-loop caps per stage. */
export const MAX_GOALS_REVIEW_ROUNDS = 5;
export const MAX_PLAN_REVIEW_ROUNDS = 5;
export const MAX_PLAN_TASK_REVIEW_ROUNDS = 3;
export const MAX_RESEARCH_REVIEW_ROUNDS = 3;
export const MAX_QUESTIONS_REVIEW_ROUNDS = 3;
export const MAX_REPLAN_REVIEW_ROUNDS = 3;
export const MAX_ACCEPTANCE_ROUNDS = 3;

/** Fast review mode caps every review loop to this many rounds (one correction cycle). */
export const FAST_REVIEW_ROUNDS = 2;

/**
 * Returns the effective number of review rounds for a loop.
 * In fast mode the cap is clamped to FAST_REVIEW_ROUNDS; in thorough mode the
 * stage-specific thoroughMax is used unchanged.
 */
export function effectiveReviewRounds(reviewDepth: ReviewDepth | undefined, thoroughMax: number): number {
  return reviewDepth === "fast" ? Math.min(thoroughMax, FAST_REVIEW_ROUNDS) : thoroughMax;
}

export interface StartRunOptions {
  runId: string;
  userTask?: string;
  interactionMode: InteractionMode;
  failurePolicy: FailurePolicy;
  route?: Route;
  nextStage?: NextStage;
  now?: string;
}

export class Run {
  private _state: RunState;

  private constructor(state: RunState) {
    this._state = state;
  }

  static start(options: StartRunOptions): Run {
    const timestamp = options.now ?? new Date().toISOString();
    const base: RunState = {
      runId: options.runId,
      route: options.route ?? "unknown",
      currentPhase: 1,
      totalPhases: 0,
      lastCompletedStage: "none",
      nextStage: options.nextStage ?? "goals",
      stagesCompleted: [],
      phaseHistory: [],
      backwardLoops: 0,
      acceptFixAttempts: 0,
      verifyFixAttempts: 0,
      resumeSource: "fresh",
      interactionMode: options.interactionMode,
      failurePolicy: options.failurePolicy,
      startedAt: timestamp,
      updatedAt: timestamp,
    };
    if (options.userTask !== undefined) {
      base.userTask = options.userTask;
    }
    return new Run(base);
  }

  static rehydrate(state: RunState): Run {
    return new Run({ ...state });
  }

  get state(): Readonly<RunState> {
    return this._state;
  }

  get nextStage(): NextStage {
    return this._state.nextStage;
  }

  toSnapshot(): RunState {
    return { ...this._state };
  }

  completeStage(
    stage: StageName,
    nextStage: NextStage,
    options?: {
      route?: Route;
      phase?: number;
      totalPhases?: number;
      verifyStatus?: VerifyStatus;
    },
  ): void {
    const phase = options?.phase ?? this._state.currentPhase;
    const phaseHistory = mergePhaseHistory(this._state.phaseHistory, phase, stage);
    const next: RunState = {
      ...this._state,
      route: options?.route ?? this._state.route,
      currentPhase: phase,
      totalPhases: options?.totalPhases ?? this._state.totalPhases,
      lastCompletedStage: stage,
      nextStage,
      stagesCompleted: appendUniqueStage(this._state.stagesCompleted, stage),
      phaseHistory,
      updatedAt: new Date().toISOString(),
    };
    if (options?.verifyStatus !== undefined) {
      next.verifyStatus = options.verifyStatus;
    }
    this._state = next;
  }

  skipStage(_stage: StageName, nextStage: NextStage): void {
    this._state = { ...this._state, nextStage, updatedAt: new Date().toISOString() };
  }

  setNextStage(nextStage: NextStage): void {
    this._state = { ...this._state, nextStage, updatedAt: new Date().toISOString() };
  }

  advancePhase(totalPhases: number): void {
    this._state = {
      ...this._state,
      currentPhase: Math.min(this._state.currentPhase + 1, Math.max(totalPhases, 1)),
      totalPhases,
      updatedAt: new Date().toISOString(),
    };
  }

  resetCurrentPhase(): void {
    this._state = { ...this._state, currentPhase: 1, updatedAt: new Date().toISOString() };
  }

  incrementBackwardLoops(): void {
    this._state = { ...this._state, backwardLoops: this._state.backwardLoops + 1, updatedAt: new Date().toISOString() };
  }

  incrementAcceptFixAttempts(): void {
    this._state = {
      ...this._state,
      acceptFixAttempts: this._state.acceptFixAttempts + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  resetAcceptFixAttempts(): void {
    this._state = { ...this._state, acceptFixAttempts: 0, updatedAt: new Date().toISOString() };
  }

  incrementVerifyFixAttempts(): void {
    this._state = {
      ...this._state,
      verifyFixAttempts: this._state.verifyFixAttempts + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  resetVerifyFixAttempts(): void {
    this._state = { ...this._state, verifyFixAttempts: 0, updatedAt: new Date().toISOString() };
  }

  setResumeSource(source: RunState["resumeSource"]): void {
    this._state = { ...this._state, resumeSource: source, updatedAt: new Date().toISOString() };
  }

  isBackwardLoopCapHit(): boolean {
    return this._state.backwardLoops >= MAX_BACKWARD_LOOPS;
  }

  isAcceptFixCapHit(): boolean {
    return this._state.acceptFixAttempts >= MAX_ACCEPT_FIX_ATTEMPTS;
  }

  isVerifyFixCapHit(): boolean {
    return this._state.verifyFixAttempts >= MAX_VERIFY_FIX_ATTEMPTS;
  }
}

function appendUniqueStage(stages: StageName[], stage: StageName): StageName[] {
  return stages.includes(stage) ? stages : [...stages, stage];
}

function mergePhaseHistory(history: PhaseHistoryEntry[], phase: number, stage: StageName): PhaseHistoryEntry[] {
  const existing = history.find((entry) => entry.phase === phase);
  if (!existing) {
    return [...history, { phase, completedStages: [stage] }];
  }
  return history.map((entry) =>
    entry.phase === phase ? { ...entry, completedStages: appendUniqueStage(entry.completedStages, stage) } : entry,
  );
}
