/**
 * LiveUiTelemetrySink — TelemetrySink decorator that drives the pi UI surfaces
 * (status widget, transcript breadcrumbs, toast notifications) in addition to
 * forwarding every call to the wrapped JSONL sink.
 *
 * All UI side effects are gated behind ctx.hasUI so automated/headless runs
 * (--mode text, smoke tests) are unaffected. The inner sink runs first for
 * every call, keeping on-disk artifacts byte-identical to a no-UI run.
 */

import type { ExtensionAPI, ExtensionCommandContext, MessageRenderer } from "@earendil-works/pi-coding-agent";

import type { DomainEvent } from "../../domain/event/index.js";
import { MAX_ACCEPT_FIX_ATTEMPTS, MAX_BACKWARD_LOOPS, MAX_VERIFY_FIX_ATTEMPTS } from "../../domain/run/index.js";
import type { RunState, StageName, TelemetryEvent, TelemetrySink } from "../../application/port/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WIDGET_KEY = "deepwork";
export const DEEPWORK_PROGRESS_CUSTOM_TYPE = "deepwork-progress";

const STAGE_ORDER: StageName[] = [
  "goals",
  "research",
  "design",
  "structure",
  "plan",
  "implement",
  "accept",
  "replan",
  "verify",
  "report",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadcrumbResult {
  line: string;
  level?: "info" | "warning" | "error";
}

interface RunView {
  state?: RunState;
  currentStage?: StageName;
  stageStartedAt?: number;
  lastSummary?: string;
  runStartedAt?: number;
  /** Short label for what is happening right now within the current stage. */
  currentActivity?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * Maps a DomainEvent to a breadcrumb line. Returns undefined for high-frequency
 * events that update the widget activity line instead of the transcript.
 */
export function breadcrumbFor(event: DomainEvent): BreadcrumbResult | undefined {
  switch (event.type) {
    case "run.started":
      return { line: `Deepwork started - route ${event.route}`, level: "info" };
    case "run.resumed":
      return { line: `Deepwork resumed - route ${event.route}`, level: "info" };
    case "run.completed":
      return { line: `Deepwork ${event.status}`, level: "info" };
    case "run.aborted":
      return { line: `Deepwork aborted - ${event.error}`, level: "error" };
    case "stage.started":
      return { line: `starting ${event.stage}` };
    case "stage.completed":
      return { line: `OK ${event.stage} - ${event.outcome.summary}` };
    case "stage.failed":
      return { line: `FAIL ${event.stage} - ${event.summary}`, level: "error" };
    case "stage.skipped":
      return { line: `skip ${event.stage} (${event.summary})` };
    case "backward_loop.decided":
      return { line: `loop back to ${event.targetStage}` };
    case "backward_loop.reset":
      return { line: `loop back to ${event.targetStage}` };
    case "backward_loop.failed":
      return { line: `backward-loop cap reached`, level: "error" };
    case "gate.presented":
      return { line: `approval needed at ${event.stage}`, level: "warning" };
    case "gate.approved":
      return { line: `gate ${event.stage} approved` };
    case "gate.rejected":
      return { line: `gate ${event.stage} rejected` };
    case "phase.started":
      return { line: `phase ${event.phase}/${event.totalPhases} started` };
    case "review.round.started":
      return { line: `${event.stage} review round ${event.reviewRound}/${event.maxRounds}` };
    case "task.completed":
      return { line: `task ${event.taskId} ${event.status === "PASS" ? "done" : "FAIL"} (wave ${event.wave})` };
    // High-frequency — widget activity line only, no transcript breadcrumb.
    case "dispatch.started":
    case "dispatch.completed":
    case "review.round.completed":
    case "task.started":
    case "backward_loop.requested":
    case "backward_loop.deferred":
      return undefined;
    default:
      return undefined;
  }
}

/** Formats an elapsed millisecond duration as mm:ss. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Builds the widget string lines from a cached run view and an optional
 * reference timestamp (defaults to Date.now()).
 */
export function renderWidgetLines(view: RunView, nowMs?: number): string[] {
  if (!view.state) {
    return ["deepwork - starting..."];
  }

  const state = view.state;
  const now = nowMs ?? Date.now();

  const runElapsed = view.runStartedAt !== undefined ? formatDuration(now - view.runStartedAt) : "--:--";
  const header = `deepwork - ${state.runId} - ${state.route} - ${runElapsed}`;

  const stageRow = STAGE_ORDER.map((stage) => {
    const isSkipped = state.route === "quick-fix" && (stage === "design" || stage === "structure");
    const isDone = state.stagesCompleted.includes(stage);
    const isCurrent = view.currentStage === stage;
    let marker: string;
    if (isSkipped) {
      marker = "-";
    } else if (isCurrent) {
      // Active stage wins over "done": re-executed stages (verify-fix/accept-fix
      // retry loops) stay in stagesCompleted but must still render as running.
      marker = "▶";
    } else if (isDone) {
      marker = "✓";
    } else {
      marker = " ";
    }
    return `${stage}${marker}`;
  }).join("  ");

  const totalPhases = Math.max(state.totalPhases, 1);
  const stageStartedMs = view.stageStartedAt;
  const runningFor = stageStartedMs !== undefined ? formatDuration(now - stageStartedMs) : "--:--";
  const currentLabel = view.currentStage ?? state.nextStage;
  const phaseLine = `phase ${state.currentPhase}/${totalPhases} - ${currentLabel} (running ${runningFor})`;

  const loopLine = `loops: backward ${state.backwardLoops}/${MAX_BACKWARD_LOOPS} - accept-fix ${state.acceptFixAttempts}/${MAX_ACCEPT_FIX_ATTEMPTS} - verify-fix ${state.verifyFixAttempts}/${MAX_VERIFY_FIX_ATTEMPTS}`;

  const lastLabel = state.lastCompletedStage === "none" ? "none" : state.lastCompletedStage;
  const lastLine = view.lastSummary ? `last: ${lastLabel} - ${view.lastSummary}` : `last: ${lastLabel}`;

  const activityLine = view.currentActivity ? `activity: ${view.currentActivity}` : "activity: —";

  return [header, stageRow, phaseLine, loopLine, lastLine, activityLine];
}

// ---------------------------------------------------------------------------
// Message renderer (transcript breadcrumbs)
// ---------------------------------------------------------------------------

/**
 * Custom renderer for DEEPWORK_PROGRESS_CUSTOM_TYPE messages.
 *
 * Returns a minimal Component-compatible object whose render() method splits
 * the message content on newlines. @earendil-works/pi-tui is not a direct dep
 * so we satisfy the Component interface structurally at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Component type from pi-tui not a direct dep; runtime shape satisfies render(width: number): string[]
export const DEEPWORK_PROGRESS_RENDERER: MessageRenderer = (message, _options, _theme): any => {
  const rawContent = (message as { content?: string }).content ?? "";
  const content = typeof rawContent === "string" ? rawContent : "";
  return {
    render(_width: number): string[] {
      return content.split("\n");
    },
  };
};

// ---------------------------------------------------------------------------
// LiveUiTelemetrySink
// ---------------------------------------------------------------------------

/** Inner sink interface: the full TelemetrySink port plus the initialize() method
 *  that JsonlTelemetrySink exposes (not part of the port, called from index.ts). */
export interface InitializableTelemetrySink extends TelemetrySink {
  initialize(): Promise<void>;
}

/**
 * TelemetrySink decorator. Wraps an InitializableTelemetrySink (typically
 * JsonlTelemetrySink), forwards every call verbatim, and additionally drives:
 *  - ctx.ui.setWidget  — live stage/phase/loop widget above the editor
 *  - pi.sendMessage    — one transcript breadcrumb per milestone event
 *  - ctx.ui.notify     — toast for gate / failure / terminal events
 */
export class LiveUiTelemetrySink implements TelemetrySink {
  private view: RunView = {};

  constructor(
    private readonly inner: InitializableTelemetrySink,
    private readonly pi: ExtensionAPI,
    private readonly ctx: ExtensionCommandContext,
  ) {}

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  readEvents(): Promise<TelemetryEvent[]> {
    return this.inner.readEvents();
  }

  async record(event: DomainEvent): Promise<void> {
    await this.inner.record(event);
    if (!this.ctx.hasUI) return;
    this.applyEventToView(event);
    const crumb = breadcrumbFor(event);
    if (crumb) {
      this.pi.sendMessage({
        customType: DEEPWORK_PROGRESS_CUSTOM_TYPE,
        content: crumb.line,
        display: true,
      });
      if (crumb.level) {
        this.ctx.ui.notify(crumb.line, crumb.level);
      }
    }
    this.refreshWidget();
  }

  async regenerateRunLog(state: RunState): Promise<void> {
    await this.inner.regenerateRunLog(state);
    this.view = { ...this.view, state };
    if (this.ctx.hasUI) {
      this.refreshWidget();
    }
  }

  async regenerateMetrics(state: RunState): Promise<void> {
    return this.inner.regenerateMetrics(state);
  }

  private applyEventToView(event: DomainEvent): void {
    switch (event.type) {
      case "run.started":
      case "run.resumed":
        this.view = { ...this.view, runStartedAt: Date.now() };
        break;
      case "stage.started": {
        const { currentActivity: _ca0, ...rest0 } = this.view;
        this.view = { ...rest0, currentStage: event.stage, stageStartedAt: Date.now() };
        break;
      }
      case "stage.completed": {
        const { currentStage: _cs1, stageStartedAt: _ss1, currentActivity: _ca1, ...rest1 } = this.view;
        this.view = { ...rest1, lastSummary: event.outcome.summary };
        break;
      }
      case "stage.failed": {
        const { currentStage: _cs2, stageStartedAt: _ss2, currentActivity: _ca2, ...rest2 } = this.view;
        this.view = { ...rest2, lastSummary: event.summary };
        break;
      }
      case "dispatch.started":
        this.view = { ...this.view, currentActivity: `dispatching ${event.childAgent}` };
        break;
      case "dispatch.completed":
        this.view = { ...this.view, currentActivity: `${event.childAgent} done` };
        break;
      case "review.round.started":
        this.view = {
          ...this.view,
          currentActivity: `${event.stage} review round ${event.reviewRound}/${event.maxRounds}`,
        };
        break;
      case "task.started":
        this.view = {
          ...this.view,
          currentActivity: `task ${event.taskId} wave ${event.wave}`,
        };
        break;
      default:
        break;
    }
  }

  private refreshWidget(): void {
    this.ctx.ui.setWidget(WIDGET_KEY, renderWidgetLines(this.view));
  }
}
