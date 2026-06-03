import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractFixGuidance,
  parseMarkdownSections,
  parseReviewStatus,
  requireMarkdownSection,
} from "../infrastructure/codec/markdown-codec.js";
import { createStageReturnTool, normalizeStageReturn } from "../return-contract.js";
import type { DispatchRequest, DispatchResult, StageOutcome, StageRuntime } from "../types.js";
import type { StageReturnPayload } from "../return-contract.js";

export async function dispatchLeaf(
  runtime: StageRuntime,
  agentName: string,
  prompt: string,
  options?: {
    cwd?: string;
    tools?: string[];
    customTools?: DispatchRequest["customTools"];
    timeoutMs?: number;
  },
): Promise<DispatchResult> {
  const target = runtime.services.agentDefinitions.get(agentName);
  if (!target) {
    throw new Error(`Missing leaf agent definition: ${agentName}`);
  }
  return runtime.services.dispatcher.dispatch({
    target,
    prompt,
    cwd: options?.cwd ?? runtime.artifacts.workspaceRoot,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
    tools: options?.tools ?? readOnlyTools(target.tools),
    ...(options?.customTools ? { customTools: options.customTools } : {}),
    ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
}

export async function dispatchGenericCoding(
  runtime: StageRuntime,
  prompt: string,
  options?: {
    cwd?: string;
    tools?: string[];
  },
): Promise<StageOutcome> {
  const stageReturns: StageReturnPayload[] = [];
  const result = await runtime.services.dispatcher.dispatch({
    target: {
      kind: "generic",
      name: "generic-coding",
      tools: options?.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"],
      thinkingLevel: "high",
    },
    prompt,
    cwd: options?.cwd ?? runtime.artifacts.workspaceRoot,
    ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
    customTools: [createStageReturnTool(stageReturns)],
  });

  return normalizeStageReturn(result);
}

export async function writeArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${content.trimEnd()}\n`, "utf8");
}

export async function readArtifact(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export { requireMarkdownSection };

export function dispatchFailureSummary(result: DispatchResult, label: string): string | undefined {
  if (result.errorMessage) {
    return `${label}: ${result.errorMessage}`;
  }
  switch (result.endReason) {
    case "aborted":
      return `${label}: dispatched session was aborted.`;
    case "max_turns":
      return `${label}: dispatched session exhausted its turn budget.`;
    case "timeout":
      return `${label}: dispatched session timed out before producing output.`;
    case "session_error":
      return `${label}: dispatched session errored before producing output.`;
    default:
      return undefined;
  }
}

export { parseReviewStatus, extractFixGuidance };

function readOnlyTools(tools: string[]): string[] {
  return tools.filter((tool) => tool !== "write" && tool !== "edit");
}
