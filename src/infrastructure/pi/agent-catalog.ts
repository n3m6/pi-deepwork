// MarkdownAgentCatalog — loads leaf agent definitions from the agents/ directory.

import { loadAgentDefinitions } from "../../agent-defs.js";
import type { AgentCatalog, LeafAgentDefinition } from "../../application/port/index.js";

export class MarkdownAgentCatalog implements AgentCatalog {
  private definitions: Map<string, LeafAgentDefinition>;

  private constructor(definitions: Map<string, LeafAgentDefinition>) {
    this.definitions = definitions;
  }

  static async load(): Promise<MarkdownAgentCatalog> {
    const definitions = await loadAgentDefinitions();
    return new MarkdownAgentCatalog(definitions);
  }

  get(name: string): LeafAgentDefinition | undefined {
    return this.definitions.get(name);
  }

  all(): Map<string, LeafAgentDefinition> {
    return new Map(this.definitions);
  }
}
