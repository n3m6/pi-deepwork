// PiSessionDispatcher — re-exports from dispatch.ts for the new module layout.
// The actual implementation lives in src/dispatch.ts during the migration phase.

export {
  PiSessionDispatcher,
  waitForPromptCompletion,
  resolveModel,
  mergeToolAllowlist,
  instrumentCustomTools,
  existingPaths,
  extractAssistantText,
  contentToText,
  buildLeafPrompt,
} from "../../dispatch.js";
export type { AgentSession, SessionFactory } from "../../dispatch.js";
