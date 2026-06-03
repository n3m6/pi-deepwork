import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { FileSystemArtifactRepository, ensureRunDirectories, getRunArtifacts } from "./infrastructure/fs/artifact-repository.js";
import { FileSystemRunStateRepository } from "./infrastructure/fs/state-repository.js";
import { resumeOrInferState } from "./infrastructure/fs/state-reconstruction.js";
import { GitVersionControl } from "./infrastructure/git/version-control.js";
import { NpmBuildTool } from "./infrastructure/npm/build-tool.js";
import { MarkdownAgentCatalog } from "./infrastructure/pi/agent-catalog.js";
import { DefaultGateManager, determineInteractionMode } from "./infrastructure/pi/human-gate.js";
import { UiProgressReporter } from "./infrastructure/pi/progress-reporter.js";
import { PiSessionDispatcher } from "./infrastructure/pi/session-dispatcher.js";
import { JsonlTelemetrySink } from "./infrastructure/telemetry/jsonl-telemetry-sink.js";
import { createRunId } from "./infrastructure/system/id-generator.js";
import { Run } from "./domain/run/index.js";
import { runPipeline } from "./application/pipeline/run-pipeline.js";
import type { PipelineServices } from "./application/port/index.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("deepwork", {
    description: "Run the deterministic QRSPI deepwork pipeline.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const interaction = determineInteractionMode(ctx, args);
      const runId = interaction.explicit.resumeRunId ?? createRunId();
      const userTask = interaction.explicit.resumeRunId ? undefined : stripCommandFlags(args).trim();

      const agentCatalog = await MarkdownAgentCatalog.load();
      const agentDefinitions = agentCatalog.all();
      const dispatcher = new PiSessionDispatcher(ctx.modelRegistry, ctx.model);
      const gates = new DefaultGateManager(ctx, {
        interactionMode: interaction.interactionMode,
        failurePolicy: interaction.failurePolicy,
      });
      const progress = new UiProgressReporter(ctx);

      const resumedState = await resumeOrInferState({
        workspaceRoot: ctx.cwd,
        runId,
        interactionMode: interaction.interactionMode,
        failurePolicy: interaction.failurePolicy,
      });
      const artifacts = getRunArtifacts(ctx.cwd, runId);
      await ensureRunDirectories(artifacts);

      const initialRun = resumedState
        ? Run.rehydrate(resumedState)
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
      const stateRepo = new FileSystemRunStateRepository(artifacts.stateFile);

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
        stateRepo,
      };

      await telemetrySink.initialize();

      const finalState = await runPipeline({
        services,
        state: initialRun.toSnapshot(),
        workspaceRoot: ctx.cwd,
        isResumed: !!resumedState,
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
