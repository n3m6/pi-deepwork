/**
 * PipelineLoop — the main runPipeline loop.
 */

import { Run, MAX_BACKWARD_LOOPS } from "../../domain/run/index.js";
import { acceptStage } from "../stage/accept.js";
import { designStage } from "../stage/design.js";
import { goalsStage } from "../stage/goals.js";
import { implementStage } from "../stage/implement.js";
import { planStage } from "../stage/plan.js";
import { replanStage } from "../stage/replan.js";
import { reportStage } from "../stage/report.js";
import { researchStage } from "../stage/research.js";
import { structureStage } from "../stage/structure.js";
import { verifyStage } from "../stage/verify.js";
import type {
  PipelineServices,
  RunArtifacts,
  RunState,
  StageModule,
  StageName,
  StageRuntime,
  TelemetrySink,
} from "../port/index.js";
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
  isResumed: boolean;
}): Promise<RunState> {
  const { services, artifacts, isResumed } = options;
  const sink: TelemetrySink = services.telemetrySink!;
  const signal = services.commandContext.signal;
  let run = Run.rehydrate(options.state);
  const stageInstances = new Map<string, number>();

  if (!isResumed) {
    await services.versionControl!.createRunBranch(run.state.runId, signal);
    await sink.record({ type: "run.started", runId: run.state.runId, route: run.state.route });
  } else {
    await sink.record({ type: "run.resumed", runId: run.state.runId, route: run.state.route });
  }

  await services.stateRepo!.save(run);

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

      const { outcome, stageInstance, startedAt } = await executeStage(stage, runtime, stateSnapshot, sink, stageInstances);

      if (outcome.backwardLoop) {
        await sink.record({
          type: "backward_loop.requested",
          stage: stage.stage,
          phase: run.state.currentPhase,
          stageInstance,
          route: run.state.route,
          request: outcome.backwardLoop,
        });

        if (outcome.backwardLoop.classification === "DEFER_REPLAN") {
          await services.artifactRepo!.writeDeferredFeedback(run.state.currentPhase, outcome.backwardLoop);
          run.setNextStage("replan");
          await sink.record({
            type: "backward_loop.deferred",
            stage: stage.stage,
            phase: run.state.currentPhase,
            stageInstance,
            route: run.state.route,
            request: outcome.backwardLoop,
          });
          await services.stateRepo!.save(run);
          continue;
        }

        if (run.isBackwardLoopCapHit()) {
          await sink.record({
            type: "backward_loop.failed",
            stage: stage.stage,
            phase: run.state.currentPhase,
            stageInstance,
            route: run.state.route,
            classification: outcome.backwardLoop.classification,
            maxLoops: MAX_BACKWARD_LOOPS,
          });
          await services.stateRepo!.save(run);
          break;
        }

        const reset = await services.artifactRepo!.archiveForBackwardLoop(outcome.backwardLoop.classification);
        run.incrementBackwardLoops();
        run.resetCurrentPhase();
        run.setNextStage(reset.targetStage);
        await sink.record({
          type: "backward_loop.decided",
          stage: stage.stage,
          phase: run.state.currentPhase,
          stageInstance,
          route: run.state.route,
          targetStage: reset.targetStage,
          request: outcome.backwardLoop,
        });
        await sink.record({
          type: "backward_loop.reset",
          stage: stage.stage,
          phase: run.state.currentPhase,
          stageInstance,
          route: run.state.route,
          targetStage: reset.targetStage,
          archived: reset.archived,
        });
        await services.stateRepo!.save(run);
        continue;
      }

      await sink.record({
        type: "stage.completed",
        stage: stage.stage,
        phase: outcome.phase ?? run.state.currentPhase,
        stageInstance,
        route: outcome.route ?? run.state.route,
        outcome,
        startedAt,
        endedAt: new Date().toISOString(),
      });

      if (stage.stage === "verify" && outcome.status === "FAIL") {
        const verifyReroute = await maybeRouteVerifyFix(run.toSnapshot(), outcome, sink, stage, stageInstance);
        if (!verifyReroute) {
          await services.stateRepo!.save(run);
          break;
        }
        run = Run.rehydrate(verifyReroute);
        await services.stateRepo!.save(run);
        continue;
      }

      if (stage.stage === "accept" && outcome.status === "FAIL") {
        const acceptReroute = await maybeRouteAcceptFix(run.toSnapshot(), outcome, sink, stage, stageInstance);
        if (!acceptReroute) {
          await services.stateRepo!.save(run);
          break;
        }
        run = Run.rehydrate(acceptReroute);
        await services.stateRepo!.save(run);
        continue;
      }

      if (outcome.status === "FAIL") {
        await services.stateRepo!.save(run);
        break;
      }

      if (stage.stage === "verify" && outcome.status === "PARTIAL") {
        const verifyReroute = await maybeRouteVerifyFix(run.toSnapshot(), outcome, sink, stage, stageInstance);
        if (!verifyReroute) {
          await services.stateRepo!.save(run);
          break;
        }
        run = Run.rehydrate(verifyReroute);
        await services.stateRepo!.save(run);
        continue;
      }

      if (stage.stage === "research" && run.state.route === "quick-fix") {
        await emitQuickFixSkips(run.toSnapshot(), sink, stageInstance);
      }

      const newState = await applyStageTransition(run.toSnapshot(), stage.stage, outcome, artifacts, services.artifactRepo);
      run = Run.rehydrate(newState);
      await services.stateRepo!.save(run);
      await services.versionControl!.checkpoint(stage.stage, "complete", signal);
      await sink.regenerateRunLog(run.toSnapshot());
      await sink.regenerateMetrics(run.toSnapshot());
    }

    await sink.record({
      type: "run.completed",
      runId: run.state.runId,
      route: run.state.route,
      status: run.nextStage === "done" ? "PASS" : "PARTIAL",
    });
    await sink.regenerateRunLog(run.toSnapshot());
    await sink.regenerateMetrics(run.toSnapshot());
    return run.toSnapshot();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await sink.record({
      type: "run.aborted",
      runId: run.state.runId,
      route: run.state.route,
      error: msg,
    });
    await sink.regenerateRunLog(run.toSnapshot());
    await sink.regenerateMetrics(run.toSnapshot());
    throw error;
  } finally {
    services.progress.clear();
  }
}
