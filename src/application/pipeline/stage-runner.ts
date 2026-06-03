/**
 * StageRunner — executes a single stage with retry logic.
 */

import { createRunEventSummary } from "../../telemetry.js";
import type { TelemetryRecorder } from "../../telemetry.js";
import type { RunState, StageModule, StageOutcome, StageRuntime } from "../../types.js";
import { resolveStageFailure } from "./review-gate-coordinator.js";

export async function executeStage(
  stage: StageModule,
  runtime: StageRuntime,
  state: RunState,
  telemetry: TelemetryRecorder,
  stageInstances: Map<string, number>,
): Promise<{ outcome: StageOutcome; stageInstance: number; startedAt: string }> {
  const stageKey = `${stage.stage}:${state.currentPhase}`;
  let automaticRetries = 0;

  while (true) {
    const stageInstance = (stageInstances.get(stageKey) ?? 0) + 1;
    stageInstances.set(stageKey, stageInstance);
    const startedAt = new Date().toISOString();
    await telemetry.append({
      event_type: "stage.started",
      status: "RUNNING",
      route: state.route,
      stage: stage.stage,
      phase: state.currentPhase,
      stage_instance: stageInstance,
      summary: createRunEventSummary(stage.stage, state.route, "started"),
    });

    try {
      const initialOutcome = await stage.run(runtime);
      const resolution = await resolveStageFailure(stage, initialOutcome, runtime, state, telemetry, stageInstance);
      if (resolution === "retry") {
        await telemetry.append({
          event_type: "stage.retried",
          status: "RETRY",
          route: state.route,
          stage: stage.stage,
          phase: state.currentPhase,
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
        route: state.route,
        stage: stage.stage,
        phase: state.currentPhase,
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
        route: state.route,
        stage: stage.stage,
        phase: state.currentPhase,
        stage_instance: stageInstance,
        summary: `Retrying ${stage.stage} after an unexpected error.`,
      });
    }
  }
}
