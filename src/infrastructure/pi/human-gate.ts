import { defineTool, type ExtensionCommandContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  ExplicitRunOptions,
  FailurePolicy,
  GateChoice,
  GateManager,
  GateOption,
  InteractionMode,
} from "../../application/port/index.js";

export function parseExplicitRunOptions(args: string): ExplicitRunOptions {
  const options: ExplicitRunOptions = {};
  const mode = args.match(/\bmode:(interactive|automated)\b/i)?.[1]?.toLowerCase();
  const failure = args.match(/\bfailure(?:_policy)?:((?:fail-closed)|(?:best-effort))\b/i)?.[1]?.toLowerCase();
  const resumeRunId = args.match(/\brun-id:(qrspi-[0-9]{8}-[0-9]{6})\b/i)?.[1];

  if (mode === "interactive" || mode === "automated") {
    options.mode = mode;
  }
  if (failure === "fail-closed" || failure === "best-effort") {
    options.failurePolicy = failure;
  }
  if (resumeRunId) {
    options.resumeRunId = resumeRunId;
  }
  return options;
}

export function determineInteractionMode(ctx: ExtensionCommandContext, args: string): {
  interactionMode: InteractionMode;
  failurePolicy: FailurePolicy;
  explicit: ExplicitRunOptions;
} {
  const explicit = parseExplicitRunOptions(args);
  const interactionMode = explicit.mode ?? (hasReplyCapability(ctx) ? "interactive" : "automated");
  const failurePolicy =
    explicit.failurePolicy ?? (interactionMode === "interactive" ? "fail-closed" : "best-effort");

  return {
    interactionMode,
    failurePolicy,
    explicit,
  };
}

export class DefaultGateManager implements GateManager {
  readonly interactionMode: InteractionMode;
  readonly failurePolicy: FailurePolicy;

  constructor(
    private readonly ctx: ExtensionCommandContext,
    options: { interactionMode: InteractionMode; failurePolicy: FailurePolicy },
  ) {
    this.interactionMode = options.interactionMode;
    this.failurePolicy = options.failurePolicy;
  }

  async askText(title: string, question: string, placeholder?: string): Promise<string | undefined> {
    if (this.interactionMode !== "interactive" || !this.ctx.hasUI) {
      return undefined;
    }
    return this.ctx.ui.input(title, `${question}${placeholder ? `\n${placeholder}` : ""}`);
  }

  async choose(title: string, options: GateOption[], message?: string): Promise<GateChoice | undefined> {
    if (this.interactionMode !== "interactive" || !this.ctx.hasUI) {
      return undefined;
    }
    const rendered = options.map((option) => `${option.value}: ${option.label}`);
    const select = (this.ctx.ui as { select?: (prompt: string, options: string[]) => Promise<string | undefined> }).select;
    if (!select) {
      return chooseWithConfirmFallback(this, title, options, message);
    }
    const choice = await select(message ? `${title}\n\n${message}` : title, rendered);
    if (!choice) {
      return undefined;
    }
    const matched = rendered.findIndex((option) => option === choice);
    const selected = matched >= 0 ? options[matched] : undefined;
    return selected ? { value: selected.value } : { value: choice };
  }

  async confirm(title: string, message: string): Promise<boolean> {
    if (this.interactionMode !== "interactive" || !this.ctx.hasUI) {
      return false;
    }
    return this.ctx.ui.confirm(title, message);
  }
}

/** Alias matching the new naming convention. */
export { DefaultGateManager as PiHumanGate };

function hasReplyCapability(ctx: ExtensionCommandContext): boolean {
  if (!ctx.hasUI) {
    return false;
  }
  const ui = ctx.ui as {
    input?: unknown;
    confirm?: unknown;
    select?: unknown;
  };
  return typeof ui.input === "function" || typeof ui.confirm === "function" || typeof ui.select === "function";
}

async function chooseWithConfirmFallback(
  gates: DefaultGateManager,
  title: string,
  options: GateOption[],
  message?: string,
): Promise<GateChoice | undefined> {
  for (const option of options) {
    const accepted = await gates.confirm(`${title}: ${option.label}`, message ?? `Choose ${option.label}?`);
    if (accepted) {
      return { value: option.value };
    }
  }
  return undefined;
}

const askHumanParameters = Type.Object({
  title: Type.String(),
  question: Type.String(),
  options: Type.Optional(Type.Array(Type.String())),
  allowFreeform: Type.Optional(Type.Boolean()),
});

export function createAskHumanTool(gates: GateManager): ToolDefinition<typeof askHumanParameters, { answer?: string }> {
  return defineTool({
    name: "ask_human",
    label: "Ask Human",
    description: "Prompt the human for an answer or selection from an interactive child session.",
    promptSnippet: "Ask the human a clarifying question or approval gate.",
    parameters: askHumanParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let answer: string | undefined;
      if (params.options && params.options.length > 0) {
        answer = (await gates.choose(params.title, params.options.map((option) => ({ value: option, label: option })), params.question))
          ?.value;
      } else {
        answer = await gates.askText(params.title, params.question);
      }
      return {
        content: [{ type: "text", text: answer ? `Human answered: ${answer}` : "Human input unavailable." }],
        details: answer ? { answer } : {},
      };
    },
  });
}
