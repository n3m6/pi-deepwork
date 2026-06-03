// FileSystemArtifactRepository — implements ArtifactRepository using the local FS.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resetArtifactsForBackwardLoop } from "../../backward-loop.js";
import { getRunArtifacts, fileExists } from "../../state.js";
import type { ArtifactId, ArtifactRepository, BackwardLoopClassification, RunArtifacts, StageName } from "../../application/port/index.js";

export class FileSystemArtifactRepository implements ArtifactRepository {
  private readonly _paths: RunArtifacts;

  private constructor(paths: RunArtifacts) {
    this._paths = paths;
  }

  static create(workspaceRoot: string, runId: string): FileSystemArtifactRepository {
    return new FileSystemArtifactRepository(getRunArtifacts(workspaceRoot, runId));
  }

  static fromPaths(paths: RunArtifacts): FileSystemArtifactRepository {
    return new FileSystemArtifactRepository(paths);
  }

  get paths(): RunArtifacts {
    return this._paths;
  }

  resolvePath(id: ArtifactId): string {
    const p = this._paths;
    switch (id.kind) {
      case "requirements":
        return p.requirementsFile;
      case "goals":
        return p.goalsFile;
      case "config":
        return p.configFile;
      case "questions":
        return p.researchQuestionsFile;
      case "researchSummary":
        return p.researchSummaryFile;
      case "researchOpenQuestions":
        return p.researchOpenQuestionsFile;
      case "design":
        return p.designFile;
      case "structure":
        return p.structureFile;
      case "plan":
        return p.planFile;
      case "phaseManifest":
        return p.phaseManifestFile;
      case "baselineResults":
        return p.baselineResultsFile;
      case "stage9Summary":
        return p.stage9SummaryFile;
      case "stage10Summary":
        return p.stage10SummaryFile;
      case "taskSpec":
        return path.join(p.phasesDir, `phase-${String(id.phase).padStart(2, "0")}`, "tasks", `task-${id.taskId}.md`);
      case "taskOutline":
        return path.join(p.outlinesDir, `task-${id.taskId}.md`);
      case "phaseFile":
        return path.join(p.phasesDir, `phase-${String(id.phase).padStart(2, "0")}`, id.name);
      case "reviewFile":
        return path.join(p.reviewsDir, id.name);
      case "feedbackFile":
        return path.join(p.feedbackDir, id.name);
    }
  }

  async read(id: ArtifactId): Promise<string | undefined> {
    try {
      return await readFile(this.resolvePath(id), "utf8");
    } catch {
      return undefined;
    }
  }

  async write(id: ArtifactId, content: string): Promise<void> {
    const filePath = this.resolvePath(id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${content.trimEnd()}\n`, "utf8");
  }

  async exists(id: ArtifactId): Promise<boolean> {
    return fileExists(this.resolvePath(id));
  }

  async listTaskSpecs(phase?: number): Promise<ArtifactId[]> {
    const dir =
      phase !== undefined
        ? path.join(this._paths.phasesDir, `phase-${String(phase).padStart(2, "0")}`, "tasks")
        : this._paths.tasksDir;
    const files = await listMdFiles(dir);
    return files.flatMap((file) => {
      const match = path.basename(file).match(/^task-(\d+)\.md$/i);
      if (!match || !match[1]) {
        return [];
      }
      const taskId = match[1];
      return [phase !== undefined ? { kind: "taskSpec" as const, phase, taskId } : { kind: "taskOutline" as const, taskId }];
    });
  }

  async listTaskOutlines(): Promise<ArtifactId[]> {
    const files = await listMdFiles(this._paths.outlinesDir);
    return files.flatMap((file) => {
      const match = path.basename(file).match(/^task-(\d+)\.md$/i);
      if (!match || !match[1]) {
        return [];
      }
      return [{ kind: "taskOutline" as const, taskId: match[1] }];
    });
  }

  async ensureDirectories(): Promise<void> {
    const dirs = [
      this._paths.runDir,
      this._paths.telemetryDir,
      this._paths.reviewsDir,
      this._paths.feedbackDir,
      this._paths.tasksDir,
      this._paths.outlinesDir,
      this._paths.phasesDir,
      this._paths.archiveDir,
      this._paths.researchDir,
    ];
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
    }
  }

  async archiveForBackwardLoop(classification: BackwardLoopClassification): Promise<{ targetStage: StageName; archived: string[] }> {
    return resetArtifactsForBackwardLoop(this._paths, classification);
  }
}

async function listMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => entry.endsWith(".md")).map((entry) => path.join(dir, entry));
  } catch {
    return [];
  }
}
