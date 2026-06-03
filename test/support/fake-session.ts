import type { AgentSession, SessionFactory } from "../../src/dispatch.js";
import type { DispatchRequest } from "../../src/types.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

export type FakeSessionBehavior =
  | { kind: "agent_end"; text?: string }
  | { kind: "stage_return"; text?: string }
  | { kind: "timeout" }
  | { kind: "throw"; error: Error }
  | { kind: "hang" };

export class FakeSession implements AgentSession {
  readonly messages: unknown[];
  private handlers: Array<(event: { type: string }) => void> = [];
  private _aborted = false;
  private promptResolve: (() => void) | undefined;

  constructor(
    private readonly behavior: FakeSessionBehavior,
    text = "",
  ) {
    this.messages =
      text
        ? [{ role: "assistant", content: text }]
        : [];
  }

  subscribe(handler: (event: { type: string }) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async abort(): Promise<void> {
    this._aborted = true;
    // Yield before resolving so that the branch that triggered abort (e.g. stageReturn)
    // can win the Promise.race before the prompt resolves.
    await Promise.resolve();
    this.promptResolve?.();
  }

  dispose(): void {
    // no-op
  }

  async prompt(_text: string, _options: { source: string }): Promise<void> {
    switch (this.behavior.kind) {
      case "throw":
        throw this.behavior.error;
      case "hang":
        await new Promise<void>((resolve) => {
          this.promptResolve = resolve;
        });
        return;
      case "agent_end":
        for (const handler of this.handlers) {
          handler({ type: "agent_end" });
        }
        return;
      case "stage_return":
        // stage_return is resolved externally via instrumentCustomTools; just hang until abort
        await new Promise<void>((resolve) => {
          this.promptResolve = resolve;
        });
        return;
      case "timeout":
        await new Promise<void>((resolve) => {
          this.promptResolve = resolve;
        });
        return;
    }
  }

  get aborted(): boolean {
    return this._aborted;
  }
}

export interface FakeModelRegistry {
  getAll(): Array<{ id: string; provider: string }>;
  getAvailable(): Array<{ id: string; provider: string }>;
}

export function makeFakeModelRegistry(
  all: Array<{ id: string; provider: string }> = [],
  available: Array<{ id: string; provider: string }> = [],
): FakeModelRegistry {
  return {
    getAll: () => all,
    getAvailable: () => available,
  };
}

export function makeSessionFactory(behavior: FakeSessionBehavior, text = ""): {
  factory: SessionFactory;
  sessions: FakeSession[];
} {
  const sessions: FakeSession[] = [];
  const factory: SessionFactory = async (
    _request: DispatchRequest,
    _customTools: ToolDefinition[],
    _toolAllowlist: string[],
    _model: Model<any> | undefined,
  ): Promise<AgentSession> => {
    const session = new FakeSession(behavior, text);
    sessions.push(session);
    return session;
  };
  return { factory, sessions };
}
