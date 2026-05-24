import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "./types/pi-extensions";

// ──────────────────────────────────────────────
// Module-level state — set by activate() before tool registration
// ──────────────────────────────────────────────
/** Reference to the ExtensionAPI; set by activate() before any tools register. */
export let _pi: ExtensionAPI | null = null;

export function setPi(pi: ExtensionAPI | null): void {
  _pi = pi;
}

// ═══════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════

/** Parameter shape for the qrspi_dispatch tool. */
export interface QrspiDispatchParams {
  subagent_type: string;
  prompt: string;
  description: string;
  model?: string;
  thinking?: string;
  max_turns?: number;
  run_in_background?: boolean;
}

/** Parameter shape for the qrspi_question tool. */
export interface QrspiQuestionParams {
  header: string;
  message: string;
  options: string[];
  type: "confirm" | "select";
}

/** Normalised result from a sub-subagent dispatch. */
export interface DispatchResult {
  agentId: string;
  status: "completed" | "running" | "failed";
  result?: string;
  error?: string;
  toolUses?: number;
  startedAt: string;
  completedAt?: string;
}

/** Structured result from a user prompt. */
export interface QuestionResult {
  type: "confirm" | "select";
  header: string;
  answer: string;
  cancelled: boolean;
  uiUnavailable: boolean;
}

/** Options bag passed to AgentManager spawn methods. */
export interface SpawnOptions {
  model?: string;
  thinking?: string;
  max_turns?: number;
}

/** Type contract for the object registered at Symbol.for("pi-subagents:manager"). */
export interface AgentManagerFacade {
  spawn(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: string,
    prompt: string,
    options: SpawnOptions,
  ): string;
  spawnAndWait(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    type: string,
    prompt: string,
    options: SpawnOptions,
  ): Promise<DispatchResult>;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  getRecord(id: string): DispatchResult | undefined;
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNonEmptyArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.length > 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Build SpawnOptions, omitting undefined keys. */
function buildSpawnOptions(params: Record<string, unknown>): SpawnOptions {
  const opts: SpawnOptions = {};
  // Only assign keys that are explicitly defined on the incoming param object;
  // undefined keys are naturally omitted because we check typeof.
  if (params.model !== undefined) {
    opts.model = params.model as string;
  }
  if (params.thinking !== undefined) {
    opts.thinking = params.thinking as string;
  }
  if (params.max_turns !== undefined) {
    opts.max_turns = params.max_turns as number;
  }
  return opts;
}

interface ToolResult {
  content: string;
  details: Record<string, unknown>;
}

function dispatchFailResponse(reason: string): ToolResult {
  return {
    content: `### Status — FAIL\n**Error:** ${reason}`,
    details: {
      agentId: "qrspi_dispatch",
      status: "failed",
      error: reason,
      startedAt: new Date().toISOString(),
    } as Record<string, unknown>,
  };
}

function questionErrorResponse(reason: string, qtype?: string): ToolResult {
  return {
    content: `Error: ${reason}`,
    details: {
      type: qtype || "confirm",
      header: "qrspi_question",
      answer: "",
      cancelled: false,
      uiUnavailable: false,
    } as Record<string, unknown>,
  };
}

function dispatchErrorResponse(error: unknown): ToolResult {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    content: `### Status — FAIL\n**Error:** dispatch failed: ${msg}`,
    details: {
      agentId: "qrspi_dispatch",
      status: "failed",
      error: msg,
      startedAt: new Date().toISOString(),
    } as Record<string, unknown>,
  };
}

// ═══════════════════════════════════════════
// createDispatchTool
// ═══════════════════════════════════════════

const DISPATCH_PARAM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    subagent_type: {
      type: "string",
      description: "Agent type name, e.g. qrspi-goals-synthesizer",
    },
    prompt: {
      type: "string",
      description: "Full task prompt for the spawned leaf subagent",
    },
    description: {
      type: "string",
      description: "3-5 word summary for display/logging",
    },
    model: {
      type: "string",
      description: "Optional model override",
    },
    thinking: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Optional thinking level",
    },
    max_turns: {
      type: "number",
      description: "Optional turn limit",
    },
    run_in_background: {
      type: "boolean",
      default: false,
      description: "When true, dispatch returns immediately without waiting",
    },
  },
  required: ["subagent_type", "prompt", "description"],
};

/**
 * Factory that returns a ToolDefinition for qrspi_dispatch.
 * The returned tool reads `_pi` from module-scope (set by activate())
 * and receives ctx as the last execute parameter.
 */
export function createDispatchTool(): ToolDefinition {
  const execute: ToolDefinition["execute"] = async (
    _toolCallId,
    params,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    // 1. Validate required params
    if (!isRecord(params)) {
      return dispatchFailResponse("Invalid parameters — expected an object.");
    }

    const subagentType = params.subagent_type;
    const prompt = params.prompt;
    const description = params.description;

    if (
      !isNonEmptyString(subagentType) ||
      !isNonEmptyString(prompt) ||
      !isNonEmptyString(description)
    ) {
      const missing: string[] = [];
      if (!isNonEmptyString(subagentType)) missing.push("subagent_type");
      if (!isNonEmptyString(prompt)) missing.push("prompt");
      if (!isNonEmptyString(description)) missing.push("description");
      return dispatchFailResponse(
        `Missing or empty required parameters: ${missing.join(", ")}`,
      );
    }

    // 2. Resolve pi-subagents manager
    const manager: AgentManagerFacade | undefined = (
      globalThis as Record<string, unknown>
    )[Symbol.for("pi-subagents:manager") as unknown as string] as
      | AgentManagerFacade
      | undefined;

    if (manager == null) {
      return dispatchFailResponse(
        "`@tintinweb/pi-subagents` is not installed. Install it with:\n  pi install npm:@tintinweb/pi-subagents",
      );
    }

    // 3. Build options bag
    const spawnOpts = buildSpawnOptions(params);

    // 4. Guard: extension must be activated
    if (_pi === null) {
      return dispatchFailResponse("Extension not activated.");
    }

    // 5. Background path
    const runInBg = params.run_in_background === true;
    if (runInBg) {
      let agentId: string;
      try {
        agentId = manager.spawn(_pi, ctx, subagentType, prompt, spawnOpts);
      } catch (e: unknown) {
        console.error("qrspi_dispatch: spawn failed", e);
        return dispatchErrorResponse(e);
      }

      const result: DispatchResult = {
        agentId,
        status: "running",
        startedAt: new Date().toISOString(),
      };

      return {
        content: `### Status — RUNNING
**Agent:** ${agentId}
**Type:** ${subagentType}
**Note:** Subagent dispatched in background. Use get_subagent_result to retrieve output.`,
        details: result as unknown as Record<string, unknown>,
      };
    }

    // 6. Foreground path
    let dispatched: DispatchResult;
    try {
      dispatched = await manager.spawnAndWait(
        _pi,
        ctx,
        subagentType,
        prompt,
        spawnOpts,
      );
    } catch (e: unknown) {
      console.error("qrspi_dispatch: spawnAndWait failed", e);
      return dispatchErrorResponse(e);
    }

    if (dispatched.status === "failed") {
      return {
        content: `### Status — FAIL
**Agent:** ${dispatched.agentId}
**Type:** ${subagentType}
**Error:**
${dispatched.error ?? "Unknown error"}`,
        details: dispatched as unknown as Record<string, unknown>,
      };
    }

    return {
      content: `### Status — PASS
**Agent:** ${dispatched.agentId}
**Type:** ${subagentType}
**Result:**
${dispatched.result ?? ""}`,
      details: dispatched as unknown as Record<string, unknown>,
    };
  };

  return {
    name: "qrspi_dispatch",
    label: "Dispatch Subagent",
    description:
      "Spawn a leaf subagent to perform a scoped task. Use this when you need to delegate work that would normally use the Agent tool (which is blocked in subagent contexts). Supports foreground (blocking) and background modes.",
    parameters: DISPATCH_PARAM_SCHEMA,
    execute,
  };
}

// ═══════════════════════════════════════════
// createQuestionTool
// ═══════════════════════════════════════════

const QUESTION_PARAM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    header: {
      type: "string",
      description: "Short label, max ~30 characters",
    },
    message: {
      type: "string",
      description: "Full question text",
    },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Available choices",
    },
    type: {
      type: "string",
      enum: ["confirm", "select"],
      description: "Type of prompt: confirm (yes/no) or select (pick one)",
    },
  },
  required: ["header", "message", "options", "type"],
};

/**
 * Factory that returns a ToolDefinition for qrspi_question.
 * The returned tool receives ctx as the last execute parameter.
 */
export function createQuestionTool(): ToolDefinition {
  const execute: ToolDefinition["execute"] = async (
    _toolCallId,
    params,
    _signal,
    _onUpdate,
    ctx,
  ) => {
    // 1. Validate required params
    if (!isRecord(params)) {
      return questionErrorResponse("Invalid parameters — expected an object.");
    }

    const header = params.header;
    const message = params.message;
    const options = params.options;
    const qtype = params.type;

    if (!isNonEmptyString(header)) {
      return questionErrorResponse(
        "Missing or empty required parameter: header",
        qtype as string | undefined,
      );
    }

    if (!isNonEmptyString(message)) {
      return {
        content: "Error: Missing or empty required parameter: message",
        details: {
          type: (qtype as QuestionResult["type"]) ?? "confirm",
          header: header,
          answer: "",
          cancelled: false,
          uiUnavailable: false,
        } as Record<string, unknown>,
      };
    }

    if (!isNonEmptyArray(options)) {
      return {
        content:
          "Error: Missing or empty required parameter: options (must be a non-empty array)",
        details: {
          type: (qtype as QuestionResult["type"]) ?? "confirm",
          header: header,
          answer: "",
          cancelled: false,
          uiUnavailable: false,
        } as Record<string, unknown>,
      };
    }

    if (qtype !== "confirm" && qtype !== "select") {
      return questionErrorResponse(
        'Invalid type parameter — must be "confirm" or "select".',
        qtype as string | undefined,
      );
    }

    const optsArr = options as string[];

    // 2. No-UI guard
    if (!ctx.hasUI) {
      console.warn(
        "qrspi_question: no UI available — returning default fallback answer",
      );
      if (qtype === "confirm") {
        return {
          content: "[NO UI — DEFAULT] User confirmed: Yes",
          details: {
            type: "confirm",
            header: header,
            answer: "Yes",
            cancelled: false,
            uiUnavailable: true,
          } as Record<string, unknown>,
        };
      }
      // select: default to first option
      const fallback = optsArr[0] ?? "";
      return {
        content: `[NO UI — DEFAULT] User selected: ${fallback}`,
        details: {
          type: "select",
          header: header,
          answer: fallback,
          cancelled: false,
          uiUnavailable: true,
        } as Record<string, unknown>,
      };
    }

    // 3 & 4. UI available — dispatch to ctx.ui
    if (qtype === "confirm") {
      let confirmed: boolean;
      try {
        confirmed = await ctx.ui.confirm(header, message);
      } catch (e) {
        console.error("qrspi_question: UI confirm failed", e);
        const errMsg = e instanceof Error ? e.message : String(e);
        return {
          content: `### Status — FAIL\n**Error:** UI confirm dialog failed: ${errMsg}`,
          details: {
            type: "confirm",
            header: header,
            answer: "",
            cancelled: false,
            uiUnavailable: true,
          } as Record<string, unknown>,
        };
      }
      if (confirmed) {
        return {
          content: "User confirmed: Yes",
          details: {
            type: "confirm",
            header: header,
            answer: "Yes",
            cancelled: false,
            uiUnavailable: false,
          } as Record<string, unknown>,
        };
      }
      return {
        content: "User confirmed: No",
        details: {
          type: "confirm",
          header: header,
          answer: "No",
          cancelled: true,
          uiUnavailable: false,
        } as Record<string, unknown>,
      };
    }

    // qtype === "select"
    let selection: string | undefined;
    try {
      selection = await ctx.ui.select(header, optsArr);
    } catch (e) {
      console.error("qrspi_question: UI select failed", e);
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        content: `### Status — FAIL\n**Error:** UI select dialog failed: ${errMsg}`,
        details: {
          type: "select",
          header: header,
          answer: "",
          cancelled: true,
          uiUnavailable: true,
        } as Record<string, unknown>,
      };
    }
    if (selection !== undefined && typeof selection === "string") {
      return {
        content: `User selected: ${selection}`,
        details: {
          type: "select",
          header: header,
          answer: selection,
          cancelled: false,
          uiUnavailable: false,
        } as Record<string, unknown>,
      };
    }
    return {
      content: "User cancelled selection",
      details: {
        type: "select",
        header: header,
        answer: "",
        cancelled: true,
        uiUnavailable: false,
      } as Record<string, unknown>,
    };
  };

  return {
    name: "qrspi_question",
    label: "Ask User Question",
    description:
      "Present an interactive prompt to the user (confirm or select). Use this when the orchestrator needs user input during pipeline execution. Falls back to safe defaults when no UI is available.",
    parameters: QUESTION_PARAM_SCHEMA,
    execute,
  };
}
