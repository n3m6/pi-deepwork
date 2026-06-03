import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadAgentDefinitions } from "./agent-defs.js";
import { PiSessionDispatcher } from "./dispatch.js";
import { DefaultGateManager, determineInteractionMode } from "./gates.js";
import { CheckpointManager } from "./checkpoint.js";
import { FileSystemArtifactRepository } from "./infrastructure/fs/artifact-repository.js";
import { GitVersionControl } from "./infrastructure/git/version-control.js";
import { NpmBuildTool } from "./infrastructure/npm/build-tool.js";
import { JsonlTelemetrySink } from "./infrastructure/telemetry/jsonl-telemetry-sink.js";
import { Run } from "./domain/run/index.js";
import { UiProgressReporter } from "./progress.js";
import { resumeOrInferState } from "./resume.js";
import { createRunId, ensureRunDirectories } from "./state.js";
import { runPipeline } from "./application/pipeline/run-pipeline.js";
import { TelemetryRecorder } from "./telemetry.js";
import type { PipelineServices } from "./types.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("deepwork", {
    description: "Run the deterministic QRSPI deepwork pipeline.",
    handler: async (args, ctx) => {
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

      const initialRun = resumed.state
        ? Run.rehydrate(resumed.state)
        : Run.start({
            runId,
            interactionMode: interaction.interactionMode,
            failurePolicy: interaction.failurePolicy,
            ...(userTask ? { userTask } : {}),
          });

      const artifactRepo = FileSystemArtifactRepository.fromPaths(artifacts);
      const versionControl = new GitVersionControl(pi, ctx.cwd, runId);
      const buildTool = new NpmBuildTool(pi);
      const telemetrySink = JsonlTelemetrySink.create(artifacts, runId);

      const services: PipelineServices = {
        pi,
        commandContext: ctx,
        eventContext: ctx,
        dispatcher,
        agentDefinitions,
        gates,
        progress,
        artifactRepo,
        versionControl,
        buildTool,
        telemetrySink,
      };

      const checkpoint = new CheckpointManager(pi, ctx.cwd);
      const telemetry = new TelemetryRecorder(artifacts, runId);
      await telemetry.initialize();

      const finalState = await runPipeline({
        services,
        state: initialRun.toSnapshot(),
        artifacts,
        telemetry,
        checkpoint,
        isResumed: !!resumed.state,
      });
      ctx.ui.notify(`Deepwork run ${runId} finished at stage ${finalState.lastCompletedStage}.`, "info");
    },
  });
}

function stripCommandFlags(args: string): string {
  return args
    .replace(/\bmode:(interactive|automated)\b/gi, "")
    .replace(/\bfailure(?:_policy)?:((?:fail-closed)|(?:best-effort))\b/gi, "")
    .replace(/\brun-id:(qrspi-[0-9]{8}-[0-9]{6})\b/gi, "")
    .replace(/\bresume\b/gi, "")
    .trim();
}
