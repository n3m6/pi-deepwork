/**
 * PipelineLoop — the main runPipeline loop.
 */

import { Run, MAX_BACKWARD_LOOPS } from "../../domain/run/index.js";
import type { StageContext } from "../../domain/event/index.js";
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
  RunState,
  StageModule,
  StageName,
  StageOutcome,
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
  workspaceRoot: string;
  isResumed: boolean;
}): Promise<RunState> {
  const { services, workspaceRoot, isResumed } = options;
  const sink: TelemetrySink = services.telemetrySink;
  const signal = services.commandContext.signal;
  let run = Run.rehydrate(options.state);
  const stageInstances = new Map<string, number>();

  if (!isResumed) {
    await services.versionControl.createRunBranch(run.state.runId, signal);
    await sink.record({ type: "run.started", runId: run.state.runId, route: run.state.route });
  } else {
    await sink.record({ type: "run.resumed", runId: run.state.runId, route: run.state.route });
  }

  await services.stateRepo.save(run);

  try {
    while (run.nextStage !== "done") {
      const stageName = run.nextStage;
      const stage = STAGES[stageName];
      services.progress.setStage(`deepwork/${stageName}`, `phase ${run.state.currentPhase}`);

      const stateSnapshot = run.toSnapshot();
      const runtime: StageRuntime = {
        state: stateSnapshot,
        workspaceRoot,
        services,
      };

      const { outcome, stageInstance, startedAt } = await executeStage(
        stage,
        runtime,
        stateSnapshot,
        sink,
        stageInstances,
      );

      // Capture stage context before any phase mutations.
      const stageCtx: StageContext = {
        stage: stage.stage,
        phase: run.state.currentPhase,
        stageInstance,
        route: run.state.route,
      };

      if (outcome.backwardLoop) {
        await sink.record({ type: "backward_loop.requested", ...stageCtx, request: outcome.backwardLoop });

        if (outcome.backwardLoop.classification === "DEFER_REPLAN") {
          await services.artifactRepo.writeDeferredFeedback(run.state.currentPhase, outcome.backwardLoop);
          run.setNextStage("replan");
          await sink.record({ type: "backward_loop.deferred", ...stageCtx, request: outcome.backwardLoop });
          await services.stateRepo.save(run);
          continue;
        }

        if (run.isBackwardLoopCapHit()) {
          await sink.record({
            type: "backward_loop.failed",
            ...stageCtx,
            classification: outcome.backwardLoop.classification,
            maxLoops: MAX_BACKWARD_LOOPS,
          });
          await services.stateRepo.save(run);
          break;
        }

        const reset = await services.artifactRepo.archiveForBackwardLoop(outcome.backwardLoop.classification);
        run.incrementBackwardLoops();
        run.resetCurrentPhase();
        run.setNextStage(reset.targetStage);
        // Re-capture phase after reset — these events record the new phase.
        const resetCtx: StageContext = { ...stageCtx, phase: run.state.currentPhase };
        await sink.record({
          type: "backward_loop.decided",
          ...resetCtx,
          targetStage: reset.targetStage,
          request: outcome.backwardLoop,
        });
        await sink.record({
          type: "backward_loop.reset",
          ...resetCtx,
          targetStage: reset.targetStage,
          archived: reset.archived,
        });
        await services.stateRepo.save(run);
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
        endedAt: (services.clock?.now() ?? new Date()).toISOString(),
      });

      const reroute = await handleReroute(run, outcome, sink, stage, stageInstance, services);
      if (reroute) {
        run = reroute.run;
        if (reroute.action === "break") break;
        continue;
      }

      if (stage.stage === "research" && run.state.route === "quick-fix") {
        await emitQuickFixSkips(run.toSnapshot(), sink, stageInstance);
      }

      const newState = await applyStageTransition(run.toSnapshot(), stage.stage, outcome, services.artifactRepo);
      run = Run.rehydrate(newState);
      await services.stateRepo.save(run);
      await services.versionControl.checkpoint(stage.stage, "complete", signal);
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

async function handleReroute(
  run: Run,
  outcome: StageOutcome,
  sink: TelemetrySink,
  stage: StageModule,
  stageInstance: number,
  services: PipelineServices,
): Promise<{ run: Run; action: "continue" | "break" } | undefined> {
  if (stage.stage === "verify" && (outcome.status === "FAIL" || outcome.status === "PARTIAL")) {
    const reroute = await maybeRouteVerifyFix(run.toSnapshot(), outcome, sink, stage, stageInstance);
    const nextRun = reroute ? Run.rehydrate(reroute) : run;
    await services.stateRepo.save(nextRun);
    return { run: nextRun, action: reroute ? "continue" : "break" };
  }
  if (stage.stage === "accept" && outcome.status === "FAIL") {
    const reroute = await maybeRouteAcceptFix(run.toSnapshot(), outcome, sink, stage, stageInstance);
    const nextRun = reroute ? Run.rehydrate(reroute) : run;
    await services.stateRepo.save(nextRun);
    return { run: nextRun, action: reroute ? "continue" : "break" };
  }
  if (outcome.status === "FAIL") {
    await services.stateRepo.save(run);
    return { run, action: "break" };
  }
  return undefined;
}
