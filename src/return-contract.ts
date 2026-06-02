import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type {
  BackwardLoopClassification,
  DispatchResult,
  StageOutcome,
  StageStatus,
  StageTelemetryContext,
} from "./types.js";

export const backwardLoopSchema = Type.Object({
  classification: StringEnum(
    ["LOOP_PLAN", "LOOP_STRUCTURE", "LOOP_DESIGN", "LOOP_GOALS", "DEFER_REPLAN", "NO_LOOP"] as const,
    { description: "Backward-loop classification, if remediation should escape the current stage." },
  ),
  summary: Type.String(),
  guidance: Type.Optional(Type.String()),
});

export const stageReturnSchema = Type.Object({
  status: StringEnum(["PASS", "FAIL", "PARTIAL", "SKIP"] as const),
  filesWritten: Type.Array(Type.String()),
  summary: Type.String(),
  route: Type.Optional(Type.String()),
  phase: Type.Optional(Type.Integer()),
  reportContent: Type.Optional(Type.String()),
  telemetry: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  backwardLoop: Type.Optional(backwardLoopSchema),
});

export interface StageReturnPayload {
  status: StageStatus;
  filesWritten: string[];
  summary: string;
  route?: string;
  phase?: number;
  reportContent?: string;
  telemetry?: Record<string, unknown>;
  backwardLoop?: {
    classification: BackwardLoopClassification;
    summary: string;
    guidance?: string;
  };
}

export function createStageReturnTool(sink: StageReturnPayload[]): ToolDefinition<typeof stageReturnSchema, StageReturnPayload> {
  return defineTool({
    name: "stage_return",
    label: "Stage Return",
    description: "Terminate a structured stage-like sub-run with a deterministic result payload.",
    promptSnippet: "Return the final structured result for this stage-like task.",
    parameters: stageReturnSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<StageReturnPayload>> {
      const payload = coerceStageReturnPayload(params);
      sink.push(payload);
      return {
        content: [{ type: "text", text: "Recorded structured stage result." }],
        details: payload,
      };
    },
  });
}

export function normalizeStageReturn(result: DispatchResult, errorMessage?: string): StageOutcome {
  const details = result.customToolCalls.find((toolCall) => toolCall.name === "stage_return")?.result.details;
  const structured = details ? coerceStageReturnPayload(details) : undefined;
  if (structured) {
    return structuredToOutcome(structured);
  }

  const reason = result.endReason ?? "agent_end";
  return {
    status: "FAIL",
    filesWritten: [],
    summary: errorMessage ?? result.errorMessage ?? missingStageReturnSummary(reason),
    telemetry: {
      terminal_review_state: "unclean-cap",
      missing_stage_return: true,
      dispatch_end_reason: reason,
    },
  };
}

export function structuredToOutcome(payload: StageReturnPayload): StageOutcome {
  const outcome: StageOutcome = {
    status: payload.status as StageStatus,
    filesWritten: payload.filesWritten,
    summary: payload.summary,
  };
  if (payload.route === "full" || payload.route === "quick-fix" || payload.route === "unknown") {
    outcome.route = payload.route;
  }
  if (typeof payload.phase === "number") {
    outcome.phase = payload.phase;
  }
  if (payload.reportContent) {
    outcome.reportContent = payload.reportContent;
  }
  if (payload.telemetry) {
    outcome.telemetry = payload.telemetry as StageTelemetryContext;
  }
  if (payload.backwardLoop) {
    outcome.backwardLoop = {
      classification: payload.backwardLoop.classification,
      summary: payload.backwardLoop.summary,
      ...(payload.backwardLoop.guidance ? { guidance: payload.backwardLoop.guidance } : {}),
    };
  }
  return outcome;
}

function coerceStageReturnPayload(input: unknown): StageReturnPayload {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const backwardLoopValue = value.backwardLoop && typeof value.backwardLoop === "object"
    ? (value.backwardLoop as Record<string, unknown>)
    : undefined;

  return {
    status: normalizeStatus(value.status),
    filesWritten: Array.isArray(value.filesWritten) ? value.filesWritten.filter(isString) : [],
    summary: isString(value.summary) ? value.summary : "No summary provided.",
    ...(isString(value.route) ? { route: value.route } : {}),
    ...(typeof value.phase === "number" ? { phase: value.phase } : {}),
    ...(isString(value.reportContent) ? { reportContent: value.reportContent } : {}),
    ...(value.telemetry && typeof value.telemetry === "object" ? { telemetry: value.telemetry as Record<string, unknown> } : {}),
    ...(backwardLoopValue
      ? {
          backwardLoop: {
            classification: normalizeBackwardLoop(backwardLoopValue.classification),
            summary: isString(backwardLoopValue.summary) ? backwardLoopValue.summary : "No backward-loop summary provided.",
            ...(isString(backwardLoopValue.guidance) ? { guidance: backwardLoopValue.guidance } : {}),
          },
        }
      : {}),
  };
}

function normalizeStatus(value: unknown): StageStatus {
  return value === "PASS" || value === "FAIL" || value === "PARTIAL" || value === "SKIP" ? value : "FAIL";
}

function normalizeBackwardLoop(value: unknown): BackwardLoopClassification {
  return value === "LOOP_PLAN" ||
    value === "LOOP_STRUCTURE" ||
    value === "LOOP_DESIGN" ||
    value === "LOOP_GOALS" ||
    value === "DEFER_REPLAN" ||
    value === "NO_LOOP"
    ? value
    : "NO_LOOP";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function missingStageReturnSummary(reason: NonNullable<DispatchResult["endReason"]>): string {
  switch (reason) {
    case "aborted":
      return "Dispatched session was aborted before calling stage_return.";
    case "max_turns":
      return "Dispatched session exhausted its turn budget before calling stage_return.";
    case "timeout":
      return "Dispatched session timed out before calling stage_return.";
    case "session_error":
      return "Dispatched session errored before calling stage_return.";
    case "stage_return":
    case "agent_end":
      return "Dispatched session ended without calling stage_return.";
  }
}
