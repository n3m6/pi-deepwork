// Minimal pi extension API types used by this repo.
// Read-only sessionManager access and sendMessage/sendUserMessage are aligned
// with the documented pi extension contract. Command argument typing remains
// repo-local for the current slash-command parser behavior.

export type MessageContent = string | Array<Record<string, unknown>>;

export interface CustomMessage {
  customType: string;
  content: MessageContent;
  display: boolean;
  details?: Record<string, unknown>;
}

export interface SendMessageOptions {
  deliverAs?: "steer" | "followUp" | "nextTurn";
  triggerTurn?: boolean;
}

export interface SendUserMessageOptions {
  deliverAs?: "steer" | "followUp";
}

// Core Extension API
export interface ExtensionAPI {
  registerCommand(name: string, definition: CommandDefinition): void;
  registerTool(definition: ToolDefinition): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  sendMessage(
    message: CustomMessage,
    options?: SendMessageOptions,
  ): void | Promise<void>;
  sendUserMessage(
    content: MessageContent,
    options?: SendUserMessageOptions,
  ): void | Promise<void>;
}

export type ActivateFunction = (pi: ExtensionAPI) => void | Promise<void>;

// Command System
export interface CommandDefinition {
  description: string;
  getArgumentCompletions?: () => Promise<Record<string, string[]>>;
  handler: CommandHandler;
}

export type CommandHandler = (
  args: Record<string, unknown>,
  ctx: ExtensionContext,
) => Promise<void>;

// Tool System
export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: { content: string }) => void,
    ctx: ExtensionContext,
  ): Promise<{ content: string; details?: Record<string, unknown> }>;
}

export type ToolHandler = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  onUpdate: (update: { content: string }) => void,
  ctx: ExtensionContext,
) => Promise<{ content: string; details?: Record<string, unknown> }>;

export interface ReadonlySessionManagerLike {
  getEntries?(): unknown[];
  getBranch?(fromId?: string): unknown[];
  getLeafId?(): string | null | undefined;
  getSessionFile?(): string | undefined;
  getLabel?(id: string): string | undefined;
}

// Extension Context
export interface ExtensionContext {
  ui: {
    confirm(
      title: string,
      message: string,
      opts?: UIConfirmParams,
    ): Promise<boolean>;
    select(
      title: string,
      options: string[],
      opts?: UISelectParams,
    ): Promise<string | undefined>;
  };
  hasUI: boolean;
  cwd: string;
  sessionManager?: ReadonlySessionManagerLike | null;
  modelRegistry: unknown;
  model: string;
  signal: AbortSignal;
  abort(): void;
  shutdown(): void;
}

// UI Parameter Types
export interface UIConfirmParams {
  timeout?: number;
  signal?: AbortSignal;
}

export interface UISelectParams {
  timeout?: number;
  signal?: AbortSignal;
}

// Skill Injection (resources_discover)
export interface ResourcesDiscoverEvent {
  type: "resources_discover";
  cwd: string;
  reason: string;
}

export type SkillInjectionContext = ResourcesDiscoverEvent;

export interface ResourcesDiscoverResult {
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}
