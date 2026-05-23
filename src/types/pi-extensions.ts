// Pi extension API types — assumed from documented pi extension contract. Adjust here if runtime shapes differ.

// Core Extension API
export interface ExtensionAPI {
  registerCommand(name: string, definition: CommandDefinition): void;
  registerTool(definition: ToolDefinition): void;
  on(event: string, handler: (...args: any[]) => any): void;
}

export type ActivateFunction = (pi: ExtensionAPI) => void | Promise<void>;

// Command System
export interface CommandDefinition {
  description: string;
  getArgumentCompletions?: () => Promise<Record<string, string[]>>;
  handler: CommandHandler;
}

export type CommandHandler = (args: Record<string, any>, ctx: ExtensionContext) => Promise<void>;

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
    ctx: ExtensionContext
  ): Promise<{ content: string; details?: Record<string, unknown> }>;
}

export type ToolHandler = (
  toolCallId: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  onUpdate: (update: { content: string }) => void,
  ctx: ExtensionContext
) => Promise<{ content: string; details?: Record<string, unknown> }>;

// Extension Context
export interface ExtensionContext {
  ui: {
    confirm(title: string, message: string, opts?: UIConfirmParams): Promise<boolean>;
    select(title: string, options: string[], opts?: UISelectParams): Promise<string | undefined>;
  };
  hasUI: boolean;
  cwd: string;
  sessionManager: unknown;
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
