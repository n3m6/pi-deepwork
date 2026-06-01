import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { loadAgentDefinitions } from "./agent-defs.js";
import { resetArtifactsForBackwardLoop } from "./backward-loop.js";
import { CheckpointManager } from "./checkpoint.js";
import { determineInteractionMode } from "./gates.js";
import { UiProgressReporter } from "./progress.js";
import { resumeOrInferState } from "./resume.js";
import {
  advancePhase,
  createInitialState,
  createRunId,
  ensureRunDirectories,
  getRunArtifacts,
  incrementVerifyFixAttempts,
  incrementBackwardLoops,
  markStageCompleted,
  resetCurrentPhase,
  resetVerifyFixAttempts,
  saveState,
} from "./state.js";
import { acceptStage } from "./stages/accept.js";
import { designStage } from "./stages/design.js";
import { goalsStage } from "./stages/goals.js";
import { implementStage } from "./stages/implement.js";
import { planStage } from "./stages/plan.js";
import { replanStage } from "./stages/replan.js";
import { reportStage } from "./stages/report.js";
import { researchStage } from "./stages/research.js";
import { structureStage } from "./stages/structure.js";
import { verifyStage } from "./stages/verify.js";
import { TelemetryRecorder, createRunEventSummary } from "./telemetry.js";
import type { BackwardLoopRequest, StageModule, StageName, StageOutcome, StageRuntime, StageTelemetryContext } from "./types.js";
import { PiSessionDispatcher } from "./dispatch.js";
import { DefaultGateManager } from "./gates.js";
import { nextStageFor } from "./transitions.js";

const MAX_BACKWARD_LOOPS = 3;
const MAX_VERIFY_FIX_ATTEMPTS = 3;

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

export async function runDeepworkCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> {
  await ctx.waitForIdle();
  const interaction = determineInteractionMode(ctx, args);
  const runId = interaction.explicit.resumeRunId ?? createRunId();
  const userTask = interaction.explicit.resumeRunId ? undefined : stripCommandFlags(args).trim();

  const agentDefinitions = await loadAgentDefinitions();
  const dispatcher = new PiSessionDispatcher(ctx.modelRegistry, ctx.model);
  const gates = new DefaultGateManager(ctx, {
    interactionMode: interaction.interactionMode,
    failurePolicy: interaction.failurePolicy,
  });
  const progress = new UiProgressReporter(ctx);

  const resumed = await resumeOrInferState({
    workspaceRoot: ctx.cwd,
    runId,
    interactionMode: interaction.interactionMode,
    failurePolicy: interaction.failurePolicy,
  });
  const artifacts = resumed.artifacts;
  await ensureRunDirectories(artifacts);

  const state =
    resumed.state ??
    createInitialState({
      runId,
      interactionMode: interaction.interactionMode,
      failurePolicy: interaction.failurePolicy,
      ...(userTask ? { userTask } : {}),
    });

  const runtimeServices = {
    pi,
    commandContext: ctx,
    eventContext: ctx,
    dispatcher,
    agentDefinitions,
    gates,
    progress,
  };
  const checkpoint = new CheckpointManager(pi, ctx.cwd);
  const telemetry = new TelemetryRecorder(artifacts, runId);
  await telemetry.initialize();

  if (!resumed.state) {
    await checkpoint.createRunBranch(runId, ctx.signal);
    await telemetry.append({
      event_type: "run.started",
      status: "PASS",
      route: state.route,
      summary: createRunEventSummary(undefined, state.route, "started"),
    });
  } else {
    await telemetry.append({
      event_type: "run.resumed",
      status: "PASS",
      route: state.route,
      summary: createRunEventSummary(undefined, state.route, "resumed"),
    });
  }

  let currentState = state;
  const stageInstances = new Map<string, number>();
  await saveState(artifacts.stateFile, currentState);

  try {
    while (currentState.nextStage !== "done") {
      const stage = STAGES[currentState.nextStage];
      progress.setStage(`deepwork/${currentState.nextStage}`, `phase ${currentState.currentPhase}`);

      const runtime: StageRuntime = {
        state: currentState,
        artifacts,
        services: runtimeServices,
      };

      const { outcome, stageInstance, startedAt } = await executeStage(stage, runtime, currentState, telemetry, stageInstances);

      if (outcome.backwardLoop) {
        await telemetry.append({
          event_type: "backward_loop.requested",
          status: "FAIL",
          route: currentState.route,
          stage: stage.stage,
          phase: currentState.currentPhase,
          stage_instance: stageInstance,
          summary: outcome.backwardLoop.summary,
          context: {
            classification: outcome.backwardLoop.classification,
            guidance: outcome.backwardLoop.guidance,
          },
        });
        if (outcome.backwardLoop.classification === "DEFER_REPLAN") {
          await writeDeferredReplanFeedback(artifacts, currentState.currentPhase, outcome.backwardLoop);
          currentState = {
            ...currentState,
            nextStage: "replan",
          };
          await telemetry.append({
            event_type: "backward_loop.deferred",
            status: "PASS",
            route: currentState.route,
            stage: stage.stage,
            phase: currentState.currentPhase,
            stage_instance: stageInstance,
            summary: `Deferred remediation to replan for phase ${currentState.currentPhase}.`,
            context: {
              classification: outcome.backwardLoop.classification,
              guidance: outcome.backwardLoop.guidance,
            },
          });
          await saveState(artifacts.stateFile, currentState);
          continue;
        }

        if (currentState.backwardLoops >= MAX_BACKWARD_LOOPS) {
          await telemetry.append({
            event_type: "backward_loop.failed",
            status: "FAIL",
            route: currentState.route,
            stage: stage.stage,
            phase: currentState.currentPhase,
            stage_instance: stageInstance,
            summary: `Backward-loop cap (${MAX_BACKWARD_LOOPS}) reached; stopping the run.`,
            context: {
              classification: outcome.backwardLoop.classification,
            },
          });
          await saveState(artifacts.stateFile, currentState);
          break;
        }

        const reset = await resetArtifactsForBackwardLoop(artifacts, outcome.backwardLoop.classification);
        currentState = incrementBackwardLoops(currentState);
        currentState = resetCurrentPhase(currentState);
        currentState = {
          ...currentState,
          nextStage: reset.targetStage,
        };
        await telemetry.append({
          event_type: "backward_loop.decided",
          status: "PASS",
          route: currentState.route,
          stage: stage.stage,
          phase: currentState.currentPhase,
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
          route: currentState.route,
          stage: stage.stage,
          phase: currentState.currentPhase,
          stage_instance: stageInstance,
          summary: `Archived and deleted stale artifacts for ${reset.targetStage}.`,
          artifacts: reset.archived,
        });
        await saveState(artifacts.stateFile, currentState);
        continue;
      }

      await telemetry.append({
        event_type: outcome.status === "SKIP" ? "stage.skipped" : outcome.status === "FAIL" ? "stage.failed" : "stage.completed",
        status: outcome.status,
        route: outcome.route ?? currentState.route,
        stage: stage.stage,
        phase: outcome.phase ?? currentState.currentPhase,
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
        const verifyReroute = await maybeRouteVerifyFix(currentState, outcome, telemetry, stage, stageInstance);
        if (!verifyReroute) {
          await saveState(artifacts.stateFile, currentState);
          break;
        }
        currentState = verifyReroute;
        await saveState(artifacts.stateFile, currentState);
        continue;
      }

      if (outcome.status === "FAIL") {
        await saveState(artifacts.stateFile, currentState);
        break;
      }

      if (stage.stage === "verify" && outcome.status === "PARTIAL") {
        const verifyReroute = await maybeRouteVerifyFix(currentState, outcome, telemetry, stage, stageInstance);
        if (!verifyReroute) {
          await saveState(artifacts.stateFile, currentState);
          break;
        }
        currentState = verifyReroute;
        await saveState(artifacts.stateFile, currentState);
        continue;
      }

      if (stage.stage === "research" && currentState.route === "quick-fix") {
        await emitQuickFixSkips(currentState, telemetry, stageInstance);
      }

      currentState = await applyStageTransition(currentState, stage.stage, outcome, artifacts);
      await saveState(artifacts.stateFile, currentState);
      await checkpoint.stageBoundaryCheckpoint(stage.stage, "complete", ctx.signal);
      await telemetry.regenerateRunLog(currentState);
      await telemetry.regenerateMetrics(currentState);
    }

    await telemetry.append({
      event_type: "run.completed",
      status: currentState.nextStage === "done" ? "PASS" : "PARTIAL",
      route: currentState.route,
      summary: createRunEventSummary(undefined, currentState.route, currentState.nextStage === "done" ? "completed" : "stopped"),
    });
    await telemetry.regenerateRunLog(currentState);
    await telemetry.regenerateMetrics(currentState);
    progress.clear();
    ctx.ui.notify(`Deepwork run ${runId} finished at stage ${currentState.lastCompletedStage}.`, "info");
  } catch (error) {
    await telemetry.append({
      event_type: "run.aborted",
      status: "FAIL",
      route: currentState.route,
      summary: error instanceof Error ? error.message : String(error),
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    await telemetry.regenerateRunLog(currentState);
    await telemetry.regenerateMetrics(currentState);
    progress.clear();
    throw error;
  }
}

export async function applyStageTransition(
  state: ReturnType<typeof createInitialState>,
  stage: StageName,
  outcome: { route?: string; telemetry?: Record<string, unknown> },
  artifacts: ReturnType<typeof getRunArtifacts>,
) {
  switch (stage) {
    case "goals": {
      const route = outcome.route === "quick-fix" ? "quick-fix" : "full";
      const nextStage = nextStageFor("goals", { route, currentPhase: state.currentPhase, totalPhases: state.totalPhases });
      return markStageCompleted(state, "goals", nextStage, { route });
    }
    case "research":
      return markStageCompleted(state, "research", nextStageFor("research", state));
    case "design":
      return markStageCompleted(state, "design", nextStageFor("design", state));
    case "structure":
      return markStageCompleted(state, "structure", nextStageFor("structure", state));
    case "plan": {
      const totalPhases = await parseTotalPhasesFromFile(artifacts.phaseManifestFile);
      return markStageCompleted(state, "plan", nextStageFor("plan", { ...state, totalPhases }), { totalPhases });
    }
    case "implement":
      return markStageCompleted(state, "implement", nextStageFor("implement", state));
    case "accept":
      return markStageCompleted(state, "accept", nextStageFor("accept", state));
    case "replan":
      return advancePhase(markStageCompleted(state, "replan", nextStageFor("replan", state)), Math.max(state.totalPhases, state.currentPhase + 1));
    case "verify": {
      const verifyStatus = (outcome.telemetry?.verify_status as typeof state.verifyStatus | undefined) ?? state.verifyStatus;
      const nextState = markStageCompleted(state, "verify", nextStageFor("verify", { ...state, ...(verifyStatus ? { verifyStatus } : {}) }), {
        ...(verifyStatus ? { verifyStatus } : {}),
      });
      return verifyStatus === "PASS" ? resetVerifyFixAttempts(nextState) : nextState;
    }
    case "report":
      return markStageCompleted(state, "report", nextStageFor("report", state));
  }
}

async function maybeRouteVerifyFix(
  state: ReturnType<typeof createInitialState>,
  outcome: StageOutcome,
  telemetry: TelemetryRecorder,
  stage: StageModule,
  stageInstance: number,
): Promise<ReturnType<typeof createInitialState> | undefined> {
  const verifyStatus = (outcome.telemetry?.verify_status as typeof state.verifyStatus | undefined) ?? outcome.status;
  if (state.verifyFixAttempts >= MAX_VERIFY_FIX_ATTEMPTS) {
    await telemetry.append({
      event_type: "stage.failed",
      status: "FAIL",
      route: state.route,
      stage: stage.stage,
      phase: state.currentPhase,
      stage_instance: stageInstance,
      summary: `Verification fix cap (${MAX_VERIFY_FIX_ATTEMPTS}) reached; stopping the run.`,
      context: {
        verify_status: verifyStatus,
        verify_fix_attempts: state.verifyFixAttempts,
      },
    });
    return undefined;
  }

  await telemetry.append({
    event_type: "stage.retried",
    status: "RETRY",
    route: state.route,
    stage: stage.stage,
    phase: state.currentPhase,
    stage_instance: stageInstance,
    summary: `Routing non-PASS verification (${verifyStatus}) back to implement.`,
    context: {
      verify_status: verifyStatus,
      verify_fix_attempts: state.verifyFixAttempts + 1,
    },
  });
  return {
    ...incrementVerifyFixAttempts(resetCurrentPhase(markStageCompleted(state, "verify", "implement", {
      verifyStatus: verifyStatus === "PASS" || verifyStatus === "PARTIAL" || verifyStatus === "FAIL" ? verifyStatus : "FAIL",
    }))),
    nextStage: "implement",
  };
}

async function emitQuickFixSkips(
  state: ReturnType<typeof createInitialState>,
  telemetry: TelemetryRecorder,
  stageInstance: number,
): Promise<void> {
  for (const skippedStage of ["design", "structure"] as const) {
    await telemetry.append({
      event_type: "stage.skipped",
      status: "SKIP",
      route: state.route,
      stage: skippedStage,
      phase: state.currentPhase,
      stage_instance: stageInstance,
      summary: `${skippedStage} skipped for quick-fix route.`,
    });
  }
}

async function writeDeferredReplanFeedback(
  artifacts: ReturnType<typeof getRunArtifacts>,
  phase: number,
  backwardLoop: BackwardLoopRequest,
): Promise<void> {
  await mkdir(artifacts.feedbackDir, { recursive: true });
  const filePath = path.join(artifacts.feedbackDir, `deferred-replan-${String(phase).padStart(2, "0")}.md`);
  await writeFile(
    filePath,
    [
      `# Deferred Replan Feedback — Phase ${phase}`,
      "",
      `classification: ${backwardLoop.classification}`,
      "",
      "## Summary",
      backwardLoop.summary,
      "",
      "## Guidance",
      backwardLoop.guidance ?? "None.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function stripCommandFlags(args: string): string {
  return args
    .replace(/\bmode:(interactive|automated)\b/gi, "")
    .replace(/\bfailure(?:_policy)?:((?:fail-closed)|(?:best-effort))\b/gi, "")
    .replace(/\brun-id:(qrspi-[0-9]{8}-[0-9]{6})\b/gi, "")
    .replace(/\bresume\b/gi, "")
    .trim();
}

async function parseTotalPhasesFromFile(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, "utf8");
    const match = content.match(/total_phases:\s*(\d+)/);
    return match?.[1] ? Number.parseInt(match[1], 10) : 1;
  } catch {
    return 1;
  }
}

export async function executeStage(
  stage: StageModule,
  runtime: StageRuntime,
  currentState: ReturnType<typeof createInitialState>,
  telemetry: TelemetryRecorder,
  stageInstances: Map<string, number>,
): Promise<{ outcome: StageOutcome; stageInstance: number; startedAt: string }> {
  const stageKey = `${stage.stage}:${currentState.currentPhase}`;
  let automaticRetries = 0;

  while (true) {
    const stageInstance = (stageInstances.get(stageKey) ?? 0) + 1;
    stageInstances.set(stageKey, stageInstance);
    const startedAt = new Date().toISOString();
    await telemetry.append({
      event_type: "stage.started",
      status: "RUNNING",
      route: currentState.route,
      stage: stage.stage,
      phase: currentState.currentPhase,
      stage_instance: stageInstance,
      summary: createRunEventSummary(stage.stage, currentState.route, "started"),
    });

    try {
      const initialOutcome = await stage.run(runtime);
      const resolution = await resolveStageFailure(stage, initialOutcome, runtime, currentState, telemetry, stageInstance);
      if (resolution === "retry") {
        await telemetry.append({
          event_type: "stage.retried",
          status: "RETRY",
          route: currentState.route,
          stage: stage.stage,
          phase: currentState.currentPhase,
          stage_instance: stageInstance,
          summary: `Retrying ${stage.stage} after operator escalation.`,
        });
        continue;
      }
      return { outcome: resolution, stageInstance, startedAt };
    } catch (error) {
      await telemetry.append({
        event_type: "stage.failed",
        status: "FAIL",
        route: currentState.route,
        stage: stage.stage,
        phase: currentState.currentPhase,
        stage_instance: stageInstance,
        summary: error instanceof Error ? error.message : String(error),
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      if (runtime.services.commandContext.signal?.aborted) {
        throw error;
      }
      const shouldRetry =
        runtime.services.gates.failurePolicy === "best-effort" &&
        automaticRetries === 0;
      if (!shouldRetry) {
        throw error;
      }
      automaticRetries += 1;
      await telemetry.append({
        event_type: "stage.retried",
        status: "RETRY",
        route: currentState.route,
        stage: stage.stage,
        phase: currentState.currentPhase,
        stage_instance: stageInstance,
        summary: `Retrying ${stage.stage} after an unexpected error.`,
      });
    }
  }
}

export async function resolveStageFailure(
  stage: StageModule,
  outcome: StageOutcome,
  runtime: StageRuntime,
  currentState: ReturnType<typeof createInitialState>,
  telemetry: TelemetryRecorder,
  stageInstance: number,
): Promise<StageOutcome | "retry"> {
  if (outcome.status !== "FAIL" || outcome.telemetry?.terminal_review_state !== "unclean-cap") {
    return outcome;
  }

  const gateTitle = `${stage.stage} review did not converge`;
  const gateMessage = outcome.summary;
  const baseTelemetry: StageTelemetryContext = {
    ...(outcome.telemetry ?? {}),
    gate_rounds: (outcome.telemetry?.gate_rounds ?? 0) + 1,
    gate_mode: runtime.services.gates.interactionMode,
  };

  if (runtime.services.gates.interactionMode !== "interactive") {
    if (runtime.services.gates.failurePolicy !== "best-effort") {
      await telemetry.append({
        event_type: "gate.rejected",
        status: "FAIL",
        route: currentState.route,
        stage: stage.stage,
        phase: currentState.currentPhase,
        stage_instance: stageInstance,
        summary: `${stage.stage} stopped at the review cap in automated fail-closed mode.`,
      });
      return {
        ...outcome,
        telemetry: {
          ...baseTelemetry,
          gate_status: "rejected",
        },
      };
    }

    await telemetry.append({
      event_type: "gate.approved",
      status: "PASS",
      route: currentState.route,
      stage: stage.stage,
      phase: currentState.currentPhase,
      stage_instance: stageInstance,
      summary: `${stage.stage} auto-approved after hitting the review cap in best-effort mode.`,
    });
    return {
      ...outcome,
      status: "PARTIAL",
      summary: `${outcome.summary} Proceeding under automated best-effort.`,
      telemetry: {
        ...baseTelemetry,
        gate_status: "approved",
      },
    };
  }

  await telemetry.append({
    event_type: "gate.presented",
    status: "RUNNING",
    route: currentState.route,
    stage: stage.stage,
    phase: currentState.currentPhase,
    stage_instance: stageInstance,
    summary: gateTitle,
  });
  const choice = await runtime.services.gates.choose(
    gateTitle,
    [
      { value: "approve", label: "Proceed with the current artifact" },
      { value: "retry", label: "Retry the stage once more" },
      { value: "abort", label: "Stop the run here" },
    ],
    gateMessage,
  );

  if (choice?.value === "retry") {
    await telemetry.append({
      event_type: "gate.approved",
      status: "PASS",
      route: currentState.route,
      stage: stage.stage,
      phase: currentState.currentPhase,
      stage_instance: stageInstance,
      summary: `Retry approved for ${stage.stage}.`,
    });
    return "retry";
  }

  if (choice?.value === "approve") {
    await telemetry.append({
      event_type: "gate.approved",
      status: "PASS",
      route: currentState.route,
      stage: stage.stage,
      phase: currentState.currentPhase,
      stage_instance: stageInstance,
      summary: `${stage.stage} approved after review-cap escalation.`,
    });
    return {
      ...outcome,
      status: "PARTIAL",
      summary: `${outcome.summary} Proceeding with human approval after review-cap escalation.`,
      telemetry: {
        ...baseTelemetry,
        gate_status: "approved",
      },
    };
  }

  await telemetry.append({
    event_type: "gate.rejected",
    status: "FAIL",
    route: currentState.route,
    stage: stage.stage,
    phase: currentState.currentPhase,
    stage_instance: stageInstance,
    summary: `${stage.stage} stopped after review-cap escalation.`,
  });
  return {
    ...outcome,
    telemetry: {
      ...baseTelemetry,
      gate_status: "rejected",
    },
  };
}
