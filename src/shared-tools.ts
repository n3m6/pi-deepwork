import type {
  ExtensionAPI,
  ExtensionContext,
  ModelLike,
  ModelRegistryLike,
  ToolDefinition,
} from "./types/pi-extensions";
import {
  ensureRegisteredSubagents,
  refreshSubagentRegistry,
} from "./subagent-catalog";

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

/** Parameter shape for the qrspi_get_subagent_result tool. */
export interface QrspiGetSubagentResultParams {
  agent_id: string;
  wait?: boolean;
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

/** Options bag passed to AgentManager spawn methods. */
export interface SpawnOptions {
  description: string;
  model?: ModelLike;
  thinkingLevel?: string;
  maxTurns?: number;
  isBackground?: boolean;
  signal?: AbortSignal;
}

interface AgentRecordFacade {
  id: string;
  status: string;
  result?: string;
  error?: string;
  toolUses?: number;
  startedAt: number | string;
  completedAt?: number | string;
  promise?: Promise<string>;
  resultConsumed?: boolean;
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
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  getRecord(id: string): AgentRecordFacade | undefined;
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requiresRegisteredQrspiAgent(subagentType: string): boolean {
  return subagentType.toLowerCase().startsWith("qrspi-");
}

/** Build SpawnOptions, omitting undefined keys. */
function buildSpawnOptions(
  params: Record<string, unknown>,
  description: string,
  model: ModelLike | undefined,
  signal: AbortSignal,
): SpawnOptions {
  const opts: SpawnOptions = {
    description,
    signal,
  };
  if (model !== undefined) {
    opts.model = model;
  }
  if (params.thinking !== undefined) {
    opts.thinkingLevel = params.thinking as string;
  }
  if (params.max_turns !== undefined) {
    opts.maxTurns = params.max_turns as number;
  }
  return opts;
}

function isModelRegistryLike(v: unknown): v is ModelRegistryLike {
  return (
    isRecord(v) &&
    (typeof v.find === "function" ||
      typeof v.getAll === "function" ||
      typeof v.getAvailable === "function")
  );
}

function toModelNames(candidate: ModelLike): string[] {
  if (typeof candidate === "string") {
    return [candidate];
  }

  if (!isRecord(candidate)) {
    return [];
  }

  const names = new Set<string>();
  const provider = candidate.provider;
  const id = candidate.id ?? candidate.modelId;
  if (typeof provider === "string" && typeof id === "string") {
    names.add(`${provider}/${id}`);
  }

  for (const key of ["id", "modelId", "name", "label", "displayName"]) {
    const value = candidate[key];
    if (typeof value === "string") {
      names.add(value);
    }
  }

  return [...names];
}

function resolveModelFromCandidates(
  modelInput: string,
  candidates: ModelLike[],
): ModelLike | undefined {
  const needle = modelInput.toLowerCase();

  for (const candidate of candidates) {
    const names = toModelNames(candidate).map((name) => name.toLowerCase());
    if (names.includes(needle)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const names = toModelNames(candidate).map((name) => name.toLowerCase());
    if (
      names.some(
        (name) =>
          name.endsWith(`/${needle}`) ||
          name.includes(needle) ||
          name.replace(/-\d{8}$/, "") === needle,
      )
    ) {
      return candidate;
    }
  }

  return undefined;
}

function resolveModelOverride(
  modelInput: unknown,
  ctx: ExtensionContext,
): { model?: ModelLike; error?: string } {
  if (modelInput === undefined) {
    return {};
  }

  if (!isNonEmptyString(modelInput)) {
    return {
      error: "Model override must be a non-empty string.",
    };
  }

  if (!isModelRegistryLike(ctx.modelRegistry)) {
    return {
      error: `Model override \"${modelInput}\" requires a modelRegistry on the extension context.`,
    };
  }

  try {
    const found = ctx.modelRegistry.find?.(modelInput);
    if (found !== undefined && found !== null) {
      return { model: found };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Failed to resolve model override \"${modelInput}\": ${message}`,
    };
  }

  const candidates = [
    ...(ctx.modelRegistry.getAvailable?.() ?? []),
    ...(ctx.modelRegistry.getAll?.() ?? []),
  ];
  const resolved = resolveModelFromCandidates(modelInput, candidates);
  if (resolved !== undefined) {
    return { model: resolved };
  }

  return {
    error: `Unable to resolve model override \"${modelInput}\".`,
  };
}

function toIsoTimestamp(v: number | string | undefined): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }

  if (isNonEmptyString(v)) {
    return v;
  }

  return undefined;
}

function toDispatchStatus(status: string): DispatchResult["status"] {
  switch (status) {
    case "completed":
    case "steered":
      return "completed";
    case "running":
    case "queued":
      return "running";
    default:
      return "failed";
  }
}

function isPendingAgentStatus(status: string): boolean {
  return status === "running" || status === "queued";
}

function toDispatchResult(record: AgentRecordFacade): DispatchResult {
  const result: DispatchResult = {
    agentId: record.id,
    status: toDispatchStatus(record.status),
    startedAt: toIsoTimestamp(record.startedAt) ?? new Date().toISOString(),
  };

  if (record.result !== undefined) {
    result.result = record.result;
  }
  if (record.error !== undefined) {
    result.error = record.error;
  }
  if (record.toolUses !== undefined) {
    result.toolUses = record.toolUses;
  }
  const completedAt = toIsoTimestamp(record.completedAt);
  if (completedAt !== undefined) {
    result.completedAt = completedAt;
  }

  return result;
}

async function waitForForegroundDispatch(
  manager: AgentManagerFacade,
  agentId: string,
): Promise<DispatchResult> {
  const initialRecord = manager.getRecord(agentId);
  if (!initialRecord) {
    throw new Error(
      `Agent manager returned no record for agent \"${agentId}\".`,
    );
  }

  if (
    initialRecord.promise === undefined &&
    (initialRecord.status === "running" || initialRecord.status === "queued")
  ) {
    throw new Error(
      `Agent manager record for \"${agentId}\" has no promise for foreground dispatch.`,
    );
  }

  try {
    await initialRecord.promise;
  } catch {
    // The final record carries the terminal status and error details.
  }

  return toDispatchResult(manager.getRecord(agentId) ?? initialRecord);
}

async function waitForBackgroundDispatch(
  manager: AgentManagerFacade,
  record: AgentRecordFacade,
): Promise<AgentRecordFacade> {
  try {
    if (record.promise !== undefined) {
      await record.promise;
    } else if (isPendingAgentStatus(record.status)) {
      await manager.waitForAll();
    }
  } catch {
    // The final record carries the terminal status and error details.
  }

  let refreshed = manager.getRecord(record.id) ?? record;
  if (isPendingAgentStatus(refreshed.status)) {
    try {
      await manager.waitForAll();
    } catch {
      // Keep the most recent record we can observe.
    }
    refreshed = manager.getRecord(record.id) ?? refreshed;
  }

  return refreshed;
}

function makeSyntheticDispatchResult(
  agentId: string,
  status: DispatchResult["status"] = "running",
): DispatchResult {
  return {
    agentId,
    status,
    startedAt: new Date().toISOString(),
  };
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

function subagentResultFailResponse(
  reason: string,
  agentId?: string,
): ToolResult {
  return {
    content: `### Status — FAIL\n**Error:** ${reason}`,
    details: {
      agentId: agentId ?? "qrspi_get_subagent_result",
      status: "failed",
      error: reason,
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
      enum: ["off", "minimal", "low", "medium", "high", "xhigh"],
      description: "Optional thinking level",
    },
    max_turns: {
      type: "number",
      description: "Optional turn limit",
    },
    run_in_background: {
      type: "boolean",
      default: false,
      description:
        "When true, dispatch returns immediately and the caller can later join with qrspi_get_subagent_result.",
    },
  },
  required: ["subagent_type", "prompt", "description"],
};

const GET_SUBAGENT_RESULT_PARAM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    agent_id: {
      type: "string",
      description:
        "Agent ID returned by the native Agent tool when run_in_background is true.",
    },
    wait: {
      type: "boolean",
      default: false,
      description:
        "When true, wait for the background subagent to finish before returning.",
    },
  },
  required: ["agent_id"],
};

const MANAGER_SYMBOL = Symbol.for("pi-subagents:manager");

/**
 * Factory that returns a ToolDefinition for qrspi_dispatch.
 * The returned tool reads `_pi` from module-scope (set by activate())
 * and receives ctx as the last execute parameter.
 */
export function createDispatchTool(): ToolDefinition {
  const execute: ToolDefinition["execute"] = async (
    _toolCallId,
    params,
    signal,
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

    const runInBackground = params.run_in_background === true;

    // 2. Resolve pi-subagents manager
    const manager = Reflect.get(globalThis, MANAGER_SYMBOL) as
      | AgentManagerFacade
      | undefined;

    if (manager == null) {
      return dispatchFailResponse(
        "`@tintinweb/pi-subagents` is not installed. Install it with:\n  pi install npm:@tintinweb/pi-subagents",
      );
    }

    // 3. Guard: extension must be activated
    if (_pi === null) {
      return dispatchFailResponse("Extension not activated.");
    }

    if (requiresRegisteredQrspiAgent(subagentType)) {
      const registration = ensureRegisteredSubagents(ctx.cwd, [subagentType]);
      if (!registration.ok) {
        return dispatchFailResponse(
          registration.error ??
            `QRSPI agent type "${subagentType}" is not registered.`,
        );
      }
    } else {
      const refreshResult = refreshSubagentRegistry(ctx.cwd);
      if (!refreshResult.refreshed && refreshResult.error) {
        console.warn(
          `[pi-deepwork] Unable to refresh pi-subagents agent registry: ${refreshResult.error}`,
        );
      }
    }

    // 4. Resolve optional model override before spawn.
    const resolvedModel = resolveModelOverride(params.model, ctx);
    if (resolvedModel.error) {
      return dispatchFailResponse(resolvedModel.error);
    }

    // 5. Build options bag
    const spawnOpts = buildSpawnOptions(
      params,
      description,
      resolvedModel.model,
      signal,
    );

    if (runInBackground) {
      spawnOpts.isBackground = true;
    }

    // 6. Dispatch path
    try {
      const agentId = manager.spawn(_pi, ctx, subagentType, prompt, spawnOpts);
      if (runInBackground) {
        const record = manager.getRecord(agentId);
        const dispatched = record
          ? toDispatchResult(record)
          : makeSyntheticDispatchResult(agentId);
        const state = record?.status ?? "running";

        if (dispatched.status === "failed") {
          return {
            content: `### Status — FAIL
**Agent:** ${dispatched.agentId}
**Type:** ${subagentType}
**State:** ${state}
**Error:**
${dispatched.error ?? "Unknown error"}`,
            details: dispatched as unknown as Record<string, unknown>,
          };
        }

        if (dispatched.status === "completed") {
          return {
            content: `### Status — PASS
**Agent:** ${dispatched.agentId}
**Type:** ${subagentType}
**State:** ${state}
**Result:**
${dispatched.result ?? ""}`,
            details: dispatched as unknown as Record<string, unknown>,
          };
        }

        return {
          content: `### Status — RUNNING
**Agent:** ${agentId}
**Type:** ${subagentType}
**State:** ${state}
**Note:** Use qrspi_get_subagent_result with this agent ID to poll or wait for the background result.`,
          details: dispatched as unknown as Record<string, unknown>,
        };
      }

      const dispatched = await waitForForegroundDispatch(manager, agentId);

      if (dispatched.status === "running") {
        return {
          content: `### Status — FAIL
**Agent:** ${dispatched.agentId}
**Type:** ${subagentType}
**Error:**
Foreground dispatch did not reach a terminal state.`,
          details: {
            ...dispatched,
            status: "failed",
            error: "Foreground dispatch did not reach a terminal state.",
          } as Record<string, unknown>,
        };
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
    } catch (e: unknown) {
      console.error("qrspi_dispatch: spawn failed", e);
      return dispatchErrorResponse(e);
    }
  };

  return {
    name: "qrspi_dispatch",
    label: "Dispatch Subagent",
    description:
      "Spawn a leaf subagent to perform a scoped task. Use foreground mode to block until completion, or background mode with qrspi_get_subagent_result when the caller needs fire-and-join behavior in child-agent contexts.",
    parameters: DISPATCH_PARAM_SCHEMA,
    execute,
  };
}

// ═══════════════════════════════════════════
// createGetSubagentResultTool
// ═══════════════════════════════════════════

export function createGetSubagentResultTool(): ToolDefinition {
  const execute: ToolDefinition["execute"] = async (
    _toolCallId,
    params,
    _signal,
    _onUpdate,
    _ctx,
  ) => {
    if (!isRecord(params)) {
      return subagentResultFailResponse(
        "Invalid parameters — expected an object.",
      );
    }

    const agentId = params.agent_id;
    if (!isNonEmptyString(agentId)) {
      return subagentResultFailResponse(
        "Missing or empty required parameter: agent_id",
      );
    }

    const manager = Reflect.get(globalThis, MANAGER_SYMBOL) as
      | AgentManagerFacade
      | undefined;

    if (manager == null) {
      return subagentResultFailResponse(
        "`@tintinweb/pi-subagents` is not installed. Install it with:\n  pi install npm:@tintinweb/pi-subagents",
        agentId,
      );
    }

    let record = manager.getRecord(agentId);
    if (record == null) {
      return subagentResultFailResponse(`Agent not found: ${agentId}`, agentId);
    }

    if (params.wait === true && isPendingAgentStatus(record.status)) {
      record.resultConsumed = true;
      record = await waitForBackgroundDispatch(manager, record);
    }

    if (!isPendingAgentStatus(record.status)) {
      record.resultConsumed = true;
    }

    const dispatched = toDispatchResult(record);
    const state = record.status;

    if (dispatched.status === "running") {
      return {
        content: `### Status — RUNNING
**Agent:** ${agentId}
**State:** ${state}
**Note:** Background subagent is still in progress. Re-run qrspi_get_subagent_result or pass wait: true.`,
        details: dispatched as unknown as Record<string, unknown>,
      };
    }

    if (dispatched.status === "failed") {
      return {
        content: `### Status — FAIL
**Agent:** ${agentId}
**State:** ${state}
**Error:**
${dispatched.error ?? "Unknown error"}`,
        details: dispatched as unknown as Record<string, unknown>,
      };
    }

    return {
      content: `### Status — PASS
**Agent:** ${agentId}
**State:** ${state}
**Result:**
${dispatched.result ?? ""}`,
      details: dispatched as unknown as Record<string, unknown>,
    };
  };

  return {
    name: "qrspi_get_subagent_result",
    label: "Get Subagent Result",
    description:
      "Check status or retrieve the result of a background subagent started with the native Agent tool. Use wait: true to block until completion.",
    parameters: GET_SUBAGENT_RESULT_PARAM_SCHEMA,
    execute,
  };
}
