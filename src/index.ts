import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { FileSystemArtifactRepository, ensureRunDirectories, getRunArtifacts } from "./infra/fs/artifact-repository.js";
import { FileSystemRunStateRepository } from "./infra/fs/state-repository.js";
import { resumeOrInferState } from "./infra/fs/state-reconstruction.js";
import { GitVersionControl } from "./infra/git/version-control.js";
import { NpmBuildTool } from "./infra/npm/build-tool.js";
import { MarkdownAgentCatalog } from "./infra/pi/agent-catalog.js";
import { DefaultGateManager, determineInteractionMode } from "./infra/pi/human-gate.js";
import { UiProgressReporter } from "./infra/pi/progress-reporter.js";
import { PiSessionDispatcher } from "./infra/pi/session-dispatcher.js";
import {
  DEEPWORK_PROGRESS_CUSTOM_TYPE,
  DEEPWORK_PROGRESS_RENDERER,
  LiveUiTelemetrySink,
} from "./infra/pi/live-ui-telemetry-sink.js";
import { LiveActivityPresenter } from "./infra/pi/live-activity-presenter.js";
import { ConfiguredModelPolicy } from "./infra/pi/model-policy.js";
import { loadModelConfig, resolveProfile } from "./infra/config/model-config.js";
import { JsonlTelemetrySink } from "./infra/telemetry/jsonl-telemetry-sink.js";
import { TimestampIdGenerator } from "./infra/system/id-generator.js";
import { SystemClock } from "./infra/system/clock.js";
import { Run } from "./domain/run/index.js";
import { runPipeline } from "./application/pipeline/run-pipeline.js";
import type { PipelineServices } from "./application/port/index.js";

export default function (pi: ExtensionAPI): void {
  // Register the transcript breadcrumb renderer once at extension load time.
  pi.registerMessageRenderer(DEEPWORK_PROGRESS_CUSTOM_TYPE, DEEPWORK_PROGRESS_RENDERER);

  pi.registerCommand("deepwork", {
    description: "Run the deterministic QRSPI deepwork pipeline.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const interaction = determineInteractionMode(ctx, args);
      const clock = new SystemClock();
      const runId = interaction.explicit.resumeRunId ?? new TimestampIdGenerator().runId();
      const userTask = interaction.explicit.resumeRunId ? undefined : stripCommandFlags(args).trim();

      const agentCatalog = await MarkdownAgentCatalog.load();
      const agentDefinitions = agentCatalog.all();

      // Construct the presenter once; shared by the sink and dispatcher.
      const presenter = ctx.hasUI ? new LiveActivityPresenter(ctx) : undefined;

      const modelConfig = await loadModelConfig(ctx.cwd, (msg) => ctx.ui.notify(msg, "warning"));
      const activeProfileName = interaction.explicit.modelProfile ?? modelConfig.profile;
      const activeProfile = resolveProfile(modelConfig, activeProfileName);
      const modelPolicy = new ConfiguredModelPolicy(activeProfile);

      const dispatcher = new PiSessionDispatcher(ctx.modelRegistry, ctx.model, undefined, presenter, modelPolicy);
      const gates = new DefaultGateManager(ctx, {
        interactionMode: interaction.interactionMode,
        failurePolicy: interaction.failurePolicy,
        reviewDepth: interaction.reviewDepth,
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
      const jsonlSink = JsonlTelemetrySink.create(artifacts, runId, clock);
      const telemetrySink = new LiveUiTelemetrySink(jsonlSink, pi, ctx, presenter);
      const stateRepo = new FileSystemRunStateRepository(artifacts.stateFile);

      const services: PipelineServices = {
        commandContext: { signal: ctx.signal },
        eventContext: { signal: ctx.signal },
        dispatcher,
        agentDefinitions,
        gates,
        progress,
        clock,
        artifactRepo,
        versionControl,
        buildTool,
        telemetrySink,
        stateRepo,
      };

      await telemetrySink.initialize();
      presenter?.start();

      try {
        const finalState = await runPipeline({
          services,
          state: initialRun.toSnapshot(),
          workspaceRoot: ctx.cwd,
          isResumed: !!resumedState,
        });
        ctx.ui.notify(`Deepwork run ${runId} finished at stage ${finalState.lastCompletedStage}.`, "info");
      } finally {
        presenter?.stop();
      }
    },
  });
}

export function stripCommandFlags(args: string): string {
  return args
    .replace(/\bmode:(interactive|automated)\b/gi, "")
    .replace(/\bfailure(?:_policy)?:((?:fail-closed)|(?:best-effort))\b/gi, "")
    .replace(/\brun-id:(qrspi-[0-9]{8}-[0-9]{6})\b/gi, "")
    .replace(/\bresume\b/gi, "")
    .replace(/\breview:(thorough|fast)\b/gi, "")
    .replace(/\bmodels:[a-z0-9-]+\b/gi, "")
    .trim();
}
