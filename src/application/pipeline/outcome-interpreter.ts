/**
 * OutcomeInterpreter — applies stage transitions and routes failures.
 *
 * Handles: applyStageTransition, maybeRouteAcceptFix, maybeRouteVerifyFix,
 * emitQuickFixSkips. writeDeferredFeedback lives in the artifact-repository
 * adapter (infrastructure layer with fs access).
 */

import { parseTotalPhases } from "../../infrastructure/codec/markdown-codec.js";
import { Run, MAX_ACCEPT_FIX_ATTEMPTS, MAX_VERIFY_FIX_ATTEMPTS } from "../../domain/run/index.js";
import { isImplementationRepairableAcceptFailure } from "../../domain/stage/fix-routing-policy.js";
import { nextStageFor } from "../../domain/stage/transition-policy.js";
import type { VerifyStatus } from "../../domain/value/index.js";
import type { TelemetrySink } from "../../application/port/index.js";
import type {
  ArtifactRepository,
  RunState,
  StageName,
  StageModule,
  StageOutcome,
} from "../port/index.js";

function extractVerifyStatus(outcome: StageOutcome, fallback: VerifyStatus | undefined): VerifyStatus | undefined {
  const raw = outcome.telemetry?.verify_status;
  return raw === "PASS" || raw === "PARTIAL" || raw === "FAIL" ? raw : fallback;
}

export async function applyStageTransition(
  state: RunState,
  stage: StageName,
  outcome: StageOutcome,
  artifactRepo?: ArtifactRepository,
): Promise<RunState> {
  const run = Run.rehydrate(state);
  switch (stage) {
    case "goals": {
      const route = outcome.route === "quick-fix" ? "quick-fix" : "full";
      run.completeStage("goals", nextStageFor("goals", { route, currentPhase: run.state.currentPhase, totalPhases: run.state.totalPhases }), { route });
      return run.toSnapshot();
    }
    case "research": {
      run.completeStage("research", nextStageFor("research", run.state));
      return run.toSnapshot();
    }
    case "design": {
      run.completeStage("design", nextStageFor("design", run.state));
      return run.toSnapshot();
    }
    case "structure": {
      run.completeStage("structure", nextStageFor("structure", run.state));
      return run.toSnapshot();
    }
    case "plan": {
      const manifestContent = artifactRepo
        ? ((await artifactRepo.read({ kind: "phaseManifest" })) ?? "")
        : "";
      const totalPhases = parseTotalPhases(manifestContent);
      run.completeStage("plan", nextStageFor("plan", { route: run.state.route, currentPhase: run.state.currentPhase, totalPhases }), { totalPhases });
      return run.toSnapshot();
    }
    case "implement": {
      run.completeStage("implement", nextStageFor("implement", run.state));
      return run.toSnapshot();
    }
    case "accept": {
      run.completeStage("accept", nextStageFor("accept", run.state));
      run.resetAcceptFixAttempts();
      return run.toSnapshot();
    }
    case "replan": {
      run.completeStage("replan", nextStageFor("replan", run.state));
      run.advancePhase(Math.max(run.state.totalPhases, run.state.currentPhase + 1));
      return run.toSnapshot();
    }
    case "verify": {
      const verifyStatus = extractVerifyStatus(outcome, state.verifyStatus);
      run.completeStage(
        "verify",
        nextStageFor("verify", { route: run.state.route, currentPhase: run.state.currentPhase, totalPhases: run.state.totalPhases, ...(verifyStatus ? { verifyStatus } : {}) }),
        verifyStatus ? { verifyStatus } : undefined,
      );
      if (verifyStatus === "PASS") {
        run.resetVerifyFixAttempts();
      }
      return run.toSnapshot();
    }
    case "report": {
      run.completeStage("report", nextStageFor("report", run.state));
      return run.toSnapshot();
    }
    default:
      return run.toSnapshot();
  }
}

export async function maybeRouteAcceptFix(
  state: RunState,
  outcome: StageOutcome,
  telemetrySink: TelemetrySink,
  stage: StageModule,
  stageInstance: number,
): Promise<RunState | undefined> {
  if (!isImplementationRepairableAcceptFailure(outcome)) {
    await telemetrySink.record({
      type: "stage.failed",
      stage: stage.stage,
      phase: state.currentPhase,
      stageInstance,
      route: state.route,
      summary: "Acceptance failed outside the implementation repair path; stopping the run.",
      context: {
        accept_summary: outcome.summary,
      },
    });
    return undefined;
  }

  const run = Run.rehydrate(state);
  if (run.isAcceptFixCapHit()) {
    await telemetrySink.record({
      type: "stage.failed",
      stage: stage.stage,
      phase: state.currentPhase,
      stageInstance,
      route: state.route,
      summary: `Acceptance fix cap (${MAX_ACCEPT_FIX_ATTEMPTS}) reached; stopping the run.`,
      context: {
        accept_fix_attempts: state.acceptFixAttempts,
      },
    });
    return undefined;
  }

  await telemetrySink.record({
    type: "stage.retried",
    stage: stage.stage,
    phase: state.currentPhase,
    stageInstance,
    route: state.route,
    summary: "Routing failed acceptance back to implement.",
    context: {
      accept_summary: outcome.summary,
      accept_fix_attempts: state.acceptFixAttempts + 1,
    },
  });
  run.completeStage("accept", "implement");
  run.incrementAcceptFixAttempts();
  return run.toSnapshot();
}

export async function maybeRouteVerifyFix(
  state: RunState,
  outcome: StageOutcome,
  telemetrySink: TelemetrySink,
  stage: StageModule,
  stageInstance: number,
): Promise<RunState | undefined> {
  const verifyStatus = extractVerifyStatus(outcome, outcome.status as VerifyStatus | undefined) ?? outcome.status;
  const run = Run.rehydrate(state);

  if (run.isVerifyFixCapHit()) {
    await telemetrySink.record({
      type: "stage.failed",
      stage: stage.stage,
      phase: state.currentPhase,
      stageInstance,
      route: state.route,
      summary: `Verification fix cap (${MAX_VERIFY_FIX_ATTEMPTS}) reached; stopping the run.`,
      context: {
        verify_status: verifyStatus,
        verify_fix_attempts: state.verifyFixAttempts,
      },
    });
    return undefined;
  }

  await telemetrySink.record({
    type: "stage.retried",
    stage: stage.stage,
    phase: state.currentPhase,
    stageInstance,
    route: state.route,
    summary: `Routing non-PASS verification (${verifyStatus}) back to implement.`,
    context: {
      verify_status: verifyStatus,
      verify_fix_attempts: state.verifyFixAttempts + 1,
    },
  });
  const safeVerifyStatus: VerifyStatus = verifyStatus === "PASS" || verifyStatus === "PARTIAL" || verifyStatus === "FAIL" ? verifyStatus : "FAIL";
  run.completeStage("verify", "implement", { verifyStatus: safeVerifyStatus });
  run.resetCurrentPhase();
  run.incrementVerifyFixAttempts();
  return run.toSnapshot();
}

export async function emitQuickFixSkips(
  state: RunState,
  telemetrySink: TelemetrySink,
  stageInstance: number,
): Promise<void> {
  for (const skippedStage of ["design", "structure"] as const) {
    await telemetrySink.record({
      type: "stage.skipped",
      stage: skippedStage,
      phase: state.currentPhase,
      stageInstance,
      route: state.route,
      summary: `${skippedStage} skipped for quick-fix route.`,
    });
  }
}
