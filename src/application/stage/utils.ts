import path from "node:path";

import {
  extractFixGuidance,
  parseMarkdownSections,
  parseReviewStatus,
  requireMarkdownSection,
} from "../../infrastructure/codec/markdown-codec.js";
// eslint-disable-next-line no-restricted-imports -- known tech debt: stage-return-tool should be behind a port
import { createStageReturnTool, normalizeStageReturn } from "../../infrastructure/pi/stage-return-tool.js";
import type { ArtifactId, DispatchRequest, DispatchResult, StageOutcome, StageRuntime } from "../port/index.js";
// eslint-disable-next-line no-restricted-imports -- known tech debt: stage-return-tool should be behind a port
import type { StageReturnPayload } from "../../infrastructure/pi/stage-return-tool.js";

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

/** Write a pipeline artifact via the artifact repository. */
export async function writeArtifact(runtime: StageRuntime, id: ArtifactId, content: string): Promise<void> {
  await runtime.services.artifactRepo!.write(id, content);
}

/** Read a pipeline artifact; throws if the artifact does not exist. */
export async function readArtifact(runtime: StageRuntime, id: ArtifactId): Promise<string> {
  const content = await runtime.services.artifactRepo!.read(id);
  if (content === undefined) {
    throw new Error(`Artifact not found: ${JSON.stringify(id)}`);
  }
  return content;
}

/**
 * Read a pipeline artifact, returning `fallback` (default `""`) if it does not exist.
 * Use for optional context artifacts where absence is expected.
 */
export async function safeReadArtifact(runtime: StageRuntime, id: ArtifactId, fallback = ""): Promise<string> {
  return (await runtime.services.artifactRepo!.read(id)) ?? fallback;
}

/**
 * Return the path of an artifact relative to the run directory.
 * Used to populate `filesWritten` in `StageOutcome`.
 */
export function artifactRelPath(runtime: StageRuntime, id: ArtifactId): string {
  return runtime.services.artifactRepo!.relPath(id);
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

export { parseReviewStatus, extractFixGuidance, parseMarkdownSections };

function readOnlyTools(tools: string[]): string[] {
  return tools.filter((tool) => tool !== "write" && tool !== "edit");
}

// Re-export path utilities for stages that need path.relative / path.join
// without a direct node:path import.
export { path };
