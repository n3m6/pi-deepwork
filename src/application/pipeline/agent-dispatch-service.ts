/**
 * AgentDispatchService — application-layer service that consolidates
 * leaf and generic-coding dispatch from stages/utils.ts.
 */

// eslint-disable-next-line no-restricted-imports -- known tech debt: stage-return-tool should be behind a port
import { createStageReturnTool, normalizeStageReturn } from "../../infrastructure/pi/stage-return-tool.js";
import type {
  DispatchRequest,
  DispatchResult,
  Dispatcher,
  LeafAgentDefinition,
  StageOutcome,
  StageRuntime,
} from "../port/index.js";
// eslint-disable-next-line no-restricted-imports -- known tech debt: stage-return-tool should be behind a port
import type { StageReturnPayload } from "../../infrastructure/pi/stage-return-tool.js";

export class AgentDispatchService {
  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly agentDefinitions: Map<string, LeafAgentDefinition>,
    private readonly defaultCwd: string,
    private readonly signal: AbortSignal | undefined,
  ) {}

  static fromRuntime(runtime: StageRuntime): AgentDispatchService {
    return new AgentDispatchService(
      runtime.services.dispatcher,
      runtime.services.agentDefinitions,
      runtime.artifacts.workspaceRoot,
      runtime.services.eventContext.signal,
    );
  }

  async dispatchLeaf(
    agentName: string,
    prompt: string,
    options?: {
      cwd?: string;
      tools?: string[];
      customTools?: DispatchRequest["customTools"];
      timeoutMs?: number;
    },
  ): Promise<DispatchResult> {
    const target = this.agentDefinitions.get(agentName);
    if (!target) {
      throw new Error(`Missing leaf agent definition: ${agentName}`);
    }
    return this.dispatcher.dispatch({
      target,
      prompt,
      cwd: options?.cwd ?? this.defaultCwd,
      ...(this.signal ? { signal: this.signal } : {}),
      tools: options?.tools ?? readOnlyTools(target.tools),
      ...(options?.customTools ? { customTools: options.customTools } : {}),
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  async dispatchGenericCoding(
    prompt: string,
    options?: {
      cwd?: string;
      tools?: string[];
    },
  ): Promise<StageOutcome> {
    const stageReturns: StageReturnPayload[] = [];
    const result = await this.dispatcher.dispatch({
      target: {
        kind: "generic",
        name: "generic-coding",
        tools: options?.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"],
        thinkingLevel: "high",
      },
      prompt,
      cwd: options?.cwd ?? this.defaultCwd,
      ...(this.signal ? { signal: this.signal } : {}),
      customTools: [createStageReturnTool(stageReturns)],
    });
    return normalizeStageReturn(result);
  }

  async dispatchParallel(requests: Array<{ agentName: string; prompt: string; cwd?: string; tools?: string[] }>): Promise<DispatchResult[]> {
    const dispatchRequests: DispatchRequest[] = requests.map(({ agentName, prompt, cwd, tools }) => {
      const target = this.agentDefinitions.get(agentName);
      if (!target) {
        throw new Error(`Missing leaf agent definition: ${agentName}`);
      }
      return {
        target,
        prompt,
        cwd: cwd ?? this.defaultCwd,
        ...(this.signal ? { signal: this.signal } : {}),
        tools: tools ?? readOnlyTools(target.tools),
      };
    });
    return this.dispatcher.dispatchParallel(dispatchRequests);
  }
}

function readOnlyTools(tools: string[]): string[] {
  return tools.filter((t) => t !== "write" && t !== "edit");
}
