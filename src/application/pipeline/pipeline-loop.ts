/**
 * PipelineLoop — the main runPipeline loop.
 */

import { resetArtifactsForBackwardLoop, writeDeferredReplanFeedback } from "../../backward-loop.js";
import { CheckpointManager } from "../../checkpoint.js";
import { Run, MAX_BACKWARD_LOOPS } from "../../domain/run/index.js";
import { saveState } from "../../state.js";
import { acceptStage } from "../../stages/accept.js";
import { designStage } from "../../stages/design.js";
import { goalsStage } from "../../stages/goals.js";
import { implementStage } from "../../stages/implement.js";
import { planStage } from "../../stages/plan.js";
import { replanStage } from "../../stages/replan.js";
import { reportStage } from "../../stages/report.js";
import { researchStage } from "../../stages/research.js";
import { structureStage } from "../../stages/structure.js";
import { verifyStage } from "../../stages/verify.js";
import { TelemetryRecorder, createRunEventSummary } from "../../telemetry.js";
import type {
  PipelineServices,
  RunArtifacts,
  RunState,
  StageModule,
  StageName,
  StageRuntime,
} from "../../types.js";
import { executeStage } from "./stage-runner.js";
import {
  applyStageTransition,
  emitQuickFixSkips,
  maybeRouteAcceptFix,
  maybeRouteVerifyFix,
} from "./outcome-interpreter.js";

const STAGES: Record<StageName, StageModule> = {
  goals: goalsStage,
  research: researchStage,
  design: designStage,
  structure: structureStage,
  plan: planStage,
  implement: implementStage,
  accept: acceptStage,
  replan: replanStage,
  verify: verifyStage,
  report: reportStage,
};

export async function runPipeline(options: {
  services: PipelineServices;
  state: RunState;
  artifacts: RunArtifacts;
  telemetry: TelemetryRecorder;
  checkpoint: CheckpointManager;
  isResumed: boolean;
}): Promise<RunState> {
  const { services, artifacts, telemetry, checkpoint, isResumed } = options;
  const signal = services.commandContext.signal;
  let run = Run.rehydrate(options.state);
  const stageInstances = new Map<string, number>();

  if (!isResumed) {
    await checkpoint.createRunBranch(run.state.runId, signal);
    await telemetry.append({
      event_type: "run.started",
      status: "PASS",
      route: run.state.route,
      summary: createRunEventSummary(undefined, run.state.route, "started"),
    });
  } else {
    await telemetry.append({
      event_type: "run.resumed",
      status: "PASS",
      route: run.state.route,
      summary: createRunEventSummary(undefined, run.state.route, "resumed"),
    });
  }

  await saveState(artifacts.stateFile, run.toSnapshot());

  try {
    while (run.nextStage !== "done") {
      const stageName = run.nextStage as StageName;
      const stage = STAGES[stageName];
      services.progress.setStage(`deepwork/${stageName}`, `phase ${run.state.currentPhase}`);

      const stateSnapshot = run.toSnapshot();
      const runtime: StageRuntime = {
        state: stateSnapshot,
        artifacts,
        services,
      };

      const { outcome, stageInstance, startedAt } = await executeStage(stage, runtime, stateSnapshot, telemetry, stageInstances);

      if (outcome.backwardLoop) {
        await telemetry.append({
          event_type: "backward_loop.requested",
          status: "FAIL",
          route: run.state.route,
          stage: stage.stage,
          phase: run.state.currentPhase,
          stage_instance: stageInstance,
          summary: outcome.backwardLoop.summary,
          context: {
            classification: outcome.backwardLoop.classification,
            guidance: outcome.backwardLoop.guidance,
          },
        });

        if (outcome.backwardLoop.classification === "DEFER_REPLAN") {
          await writeDeferredReplanFeedback(artifacts, run.state.currentPhase, outcome.backwardLoop);
          run.setNextStage("replan");
          await telemetry.append({
            event_type: "backward_loop.deferred",
            status: "PASS",
            route: run.state.route,
            stage: stage.stage,
            phase: run.state.currentPhase,
            stage_instance: stageInstance,
            summary: `Deferred remediation to replan for phase ${run.state.currentPhase}.`,
            context: {
              classification: outcome.backwardLoop.classification,
              guidance: outcome.backwardLoop.guidance,
            },
          });
          await saveState(artifacts.stateFile, run.toSnapshot());
          continue;
        }

        if (run.isBackwardLoopCapHit()) {
          await telemetry.append({
            event_type: "backward_loop.failed",
            status: "FAIL",
            route: run.state.route,
            stage: stage.stage,
            phase: run.state.currentPhase,
            stage_instance: stageInstance,
            summary: `Backward-loop cap (${MAX_BACKWARD_LOOPS}) reached; stopping the run.`,
            context: {
              classification: outcome.backwardLoop.classification,
            },
          });
          await saveState(artifacts.stateFile, run.toSnapshot());
          break;
        }

        const reset = await resetArtifactsForBackwardLoop(artifacts, outcome.backwardLoop.classification);
        run.incrementBackwardLoops();
        run.resetCurrentPhase();
        run.setNextStage(reset.targetStage);
        await telemetry.append({
          event_type: "backward_loop.decided",
          status: "PASS",
          route: run.state.route,
          stage: stage.stage,
          phase: run.state.currentPhase,
          stage_instance: stageInstance,
          summary: `Looping back to ${reset.targetStage}.`,
          context: {
            classification: outcome.backwardLoop.classification,
            target_stage: reset.targetStage,
          },
        });
        await telemetry.append({
          event_type: "backward_loop.reset",
          status: "PASS",
          route: run.state.route,
          stage: stage.stage,
          phase: run.state.currentPhase,
          stage_instance: stageInstance,
          summary: `Archived and deleted stale artifacts for ${reset.targetStage}.`,
          artifacts: reset.archived,
        });
        await saveState(artifacts.stateFile, run.toSnapshot());
        continue;
      }

      await telemetry.append({
        event_type: outcome.status === "SKIP" ? "stage.skipped" : outcome.status === "FAIL" ? "stage.failed" : "stage.completed",
        status: outcome.status,
        route: outcome.route ?? run.state.route,
        stage: stage.stage,
        phase: outcome.phase ?? run.state.currentPhase,
        stage_instance: stageInstance,
        summary: outcome.summary,
        artifacts: outcome.filesWritten,
        timing: {
          started_at: startedAt,
          ended_at: new Date().toISOString(),
        },
        ...(outcome.telemetry ? { context: outcome.telemetry } : {}),
      });

      if (stage.stage === "verify" && outcome.status === "FAIL") {
        const verifyReroute = await maybeRouteVerifyFix(run.toSnapshot(), outcome, telemetry, stage, stageInstance);
        if (!verifyReroute) {
          await saveState(artifacts.stateFile, run.toSnapshot());
          break;
        }
        run = Run.rehydrate(verifyReroute);
        await saveState(artifacts.stateFile, run.toSnapshot());
        continue;
      }

      if (stage.stage === "accept" && outcome.status === "FAIL") {
        const acceptReroute = await maybeRouteAcceptFix(run.toSnapshot(), outcome, telemetry, stage, stageInstance);
        if (!acceptReroute) {
          await saveState(artifacts.stateFile, run.toSnapshot());
          break;
        }
        run = Run.rehydrate(acceptReroute);
        await saveState(artifacts.stateFile, run.toSnapshot());
        continue;
      }

      if (outcome.status === "FAIL") {
        await saveState(artifacts.stateFile, run.toSnapshot());
        break;
      }

      if (stage.stage === "verify" && outcome.status === "PARTIAL") {
        const verifyReroute = await maybeRouteVerifyFix(run.toSnapshot(), outcome, telemetry, stage, stageInstance);
        if (!verifyReroute) {
          await saveState(artifacts.stateFile, run.toSnapshot());
          break;
        }
        run = Run.rehydrate(verifyReroute);
        await saveState(artifacts.stateFile, run.toSnapshot());
        continue;
      }

      if (stage.stage === "research" && run.state.route === "quick-fix") {
        await emitQuickFixSkips(run.toSnapshot(), telemetry, stageInstance);
      }

      const newState = await applyStageTransition(run.toSnapshot(), stage.stage, outcome, artifacts, services.artifactRepo);
      run = Run.rehydrate(newState);
      await saveState(artifacts.stateFile, run.toSnapshot());
      await checkpoint.stageBoundaryCheckpoint(stage.stage, "complete", signal);
      await telemetry.regenerateRunLog(run.toSnapshot());
      await telemetry.regenerateMetrics(run.toSnapshot());
    }

    await telemetry.append({
      event_type: "run.completed",
      status: run.nextStage === "done" ? "PASS" : "PARTIAL",
      route: run.state.route,
      summary: createRunEventSummary(undefined, run.state.route, run.nextStage === "done" ? "completed" : "stopped"),
    });
    await telemetry.regenerateRunLog(run.toSnapshot());
    await telemetry.regenerateMetrics(run.toSnapshot());
    return run.toSnapshot();
  } catch (error) {
    await telemetry.append({
      event_type: "run.aborted",
      status: "FAIL",
      route: run.state.route,
      summary: error instanceof Error ? error.message : String(error),
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await telemetry.regenerateRunLog(run.toSnapshot());
    await telemetry.regenerateMetrics(run.toSnapshot());
    throw error;
  } finally {
    services.progress.clear();
  }
}
