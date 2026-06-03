/**
 * InMemoryArtifactRepository — in-process test double for ArtifactRepository.
 *
 * Satisfies the ArtifactRepository port without touching the file system.
 */

import type { ArtifactId, ArtifactRepository, RunArtifacts, StageName } from "../../src/types.js";

export class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly store = new Map<string, string>();

  /** Expose a fake paths bag for tests that inspect artifacts.paths */
  readonly paths: RunArtifacts = {} as RunArtifacts;

  private key(id: ArtifactId): string {
    switch (id.kind) {
      case "taskSpec":
        return `taskSpec:${id.phase}:${id.taskId}`;
      case "taskOutline":
        return `taskOutline:${id.taskId}`;
      case "phaseFile":
        return `phaseFile:${id.phase}:${id.name}`;
      case "reviewFile":
        return `reviewFile:${id.name}`;
      case "feedbackFile":
        return `feedbackFile:${id.name}`;
      default:
        return id.kind;
    }
  }

  seed(id: ArtifactId, content: string): this {
    this.store.set(this.key(id), content);
    return this;
  }

  async read(id: ArtifactId): Promise<string | undefined> {
    return this.store.get(this.key(id));
  }

  async write(id: ArtifactId, content: string): Promise<void> {
    this.store.set(this.key(id), content);
  }

  async exists(id: ArtifactId): Promise<boolean> {
    return this.store.has(this.key(id));
  }

  resolvePath(id: ArtifactId): string {
    return `/memory/${this.key(id)}`;
  }

  async listTaskSpecs(phase?: number): Promise<ArtifactId[]> {
    const results: ArtifactId[] = [];
    for (const key of this.store.keys()) {
      const match = /^taskSpec:(\d+):(.+)$/.exec(key);
      if (match) {
        const p = Number(match[1]);
        if (phase === undefined || p === phase) {
          results.push({ kind: "taskSpec", phase: p, taskId: match[2]! });
        }
      }
    }
    return results;
  }

  async listTaskOutlines(): Promise<ArtifactId[]> {
    const results: ArtifactId[] = [];
    for (const key of this.store.keys()) {
      const match = /^taskOutline:(.+)$/.exec(key);
      if (match) {
        results.push({ kind: "taskOutline", taskId: match[1]! });
      }
    }
    return results;
  }

  async ensureDirectories(): Promise<void> {
    // no-op for in-memory store
  }

  async archiveForBackwardLoop(_classification: string): Promise<{ targetStage: StageName; archived: string[] }> {
    return { targetStage: "goals", archived: [] };
  }
}
