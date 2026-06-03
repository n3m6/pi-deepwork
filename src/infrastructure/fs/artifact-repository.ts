import { cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { backwardLoopTarget } from "../../domain/backward-loop/artifact-reset-policy.js";
import type { ArtifactId, ArtifactRepository, BackwardLoopClassification, BackwardLoopRequest, RunArtifacts, StageName } from "../../application/port/index.js";

// ---------------------------------------------------------------------------
// Path layout — builds the RunArtifacts bag for a given run.
// ---------------------------------------------------------------------------

export function getRunArtifacts(workspaceRoot: string, runId: string): RunArtifacts {
  const runDir = path.join(workspaceRoot, ".pipeline", runId);
  const telemetryDir = path.join(runDir, "telemetry");
  const reviewsDir = path.join(runDir, "reviews");
  const feedbackDir = path.join(runDir, "feedback");
  const tasksDir = path.join(runDir, "tasks");
  const outlinesDir = path.join(tasksDir, "outlines");
  const phasesDir = path.join(runDir, "phases");
  const archiveDir = path.join(phasesDir, "archive");
  const researchDir = path.join(runDir, "research");

  return {
    workspaceRoot,
    runDir,
    telemetryDir,
    reviewsDir,
    feedbackDir,
    tasksDir,
    outlinesDir,
    phasesDir,
    archiveDir,
    stateFile: path.join(runDir, "state.json"),
    requirementsFile: path.join(runDir, "requirements.md"),
    goalsFile: path.join(runDir, "goals.md"),
    configFile: path.join(runDir, "config.md"),
    researchDir,
    researchSummaryFile: path.join(researchDir, "summary.md"),
    researchQuestionsFile: path.join(runDir, "questions.md"),
    researchOpenQuestionsFile: path.join(researchDir, "open-questions.md"),
    designFile: path.join(runDir, "design.md"),
    structureFile: path.join(runDir, "structure.md"),
    planFile: path.join(runDir, "plan.md"),
    phaseManifestFile: path.join(runDir, "phase-manifest.md"),
    baselineResultsFile: path.join(runDir, "baseline-results.md"),
    stage9SummaryFile: path.join(runDir, "stage9-summary.md"),
    stage10SummaryFile: path.join(runDir, "stage10-summary.md"),
    eventsFile: path.join(telemetryDir, "events.jsonl"),
    runLogFile: path.join(telemetryDir, "run-log.md"),
    metricsFile: path.join(telemetryDir, "metrics-summary.md"),
  };
}

export async function ensureRunDirectories(artifacts: RunArtifacts): Promise<void> {
  await Promise.all([
    mkdir(artifacts.runDir, { recursive: true }),
    mkdir(artifacts.telemetryDir, { recursive: true }),
    mkdir(artifacts.reviewsDir, { recursive: true }),
    mkdir(artifacts.feedbackDir, { recursive: true }),
    mkdir(artifacts.outlinesDir, { recursive: true }),
    mkdir(artifacts.archiveDir, { recursive: true }),
    mkdir(path.join(artifacts.researchDir, "iterations"), { recursive: true }),
  ]);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Backward-loop artifact management
// ---------------------------------------------------------------------------

export async function resetArtifactsForBackwardLoop(
  artifacts: RunArtifacts,
  classification: BackwardLoopClassification,
): Promise<{ targetStage: StageName; archived: string[] }> {
  const targetStage = backwardLoopTarget(classification);
  if (classification === "NO_LOOP" || classification === "DEFER_REPLAN") {
    return { targetStage, archived: [] };
  }

  const archiveRoot = path.join(
    artifacts.archiveDir,
    `${new Date().toISOString().replaceAll(":", "").replaceAll(".", "")}-${classification.toLowerCase()}`,
  );
  await mkdir(archiveRoot, { recursive: true });

  const archived = new Set<string>();
  const resetPaths = pathsForTargetStage(artifacts, targetStage);
  for (const targetPath of resetPaths) {
    await archiveAndDelete(artifacts.runDir, archiveRoot, targetPath, archived);
  }

  const phaseEntries = await safeReadDir(artifacts.phasesDir);
  for (const entry of phaseEntries) {
    if (entry === "archive") {
      continue;
    }
    await archiveAndDelete(artifacts.runDir, archiveRoot, path.join(artifacts.phasesDir, entry), archived);
  }

  return {
    targetStage,
    archived: [...archived].sort(),
  };
}

export async function writeDeferredReplanFeedback(
  artifacts: RunArtifacts,
  phase: number,
  backwardLoop: BackwardLoopRequest,
): Promise<void> {
  await mkdir(artifacts.feedbackDir, { recursive: true });
  const filePath = path.join(artifacts.feedbackDir, `deferred-replan-${String(phase).padStart(2, "0")}.md`);
  await writeFile(
    filePath,
    [
      `# Deferred Replan Feedback — Phase ${phase}`,
      "",
      `classification: ${backwardLoop.classification}`,
      "",
      "## Summary",
      backwardLoop.summary,
      "",
      "## Guidance",
      backwardLoop.guidance ?? "None.",
      "",
    ].join("\n"),
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// FileSystemArtifactRepository — implements ArtifactRepository using the FS.
// ---------------------------------------------------------------------------

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
      case "researchFile":
        return path.join(p.researchDir, id.name);
      case "taskOutlineFile":
        return path.join(p.outlinesDir, id.name);
      case "runFile":
        return path.join(p.runDir, id.name);
      case "baseTaskSpec":
        return path.join(p.tasksDir, `task-${id.taskId}.md`);
    }
  }

  relPath(id: ArtifactId): string {
    return path.relative(this._paths.runDir, this.resolvePath(id));
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

  async writeDeferredFeedback(phase: number, request: BackwardLoopRequest): Promise<void> {
    return writeDeferredReplanFeedback(this._paths, phase, request);
  }

  async listBaseTaskSpecs(): Promise<ArtifactId[]> {
    const files = await listMdFiles(this._paths.tasksDir);
    return files.flatMap((file) => {
      const match = path.basename(file).match(/^task-(\d+)\.md$/i);
      if (!match || !match[1]) return [];
      return [{ kind: "baseTaskSpec" as const, taskId: match[1] }];
    });
  }

  async listOutlineFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this._paths.outlinesDir);
      return entries.filter((entry) => /^task-\d+\.outline$/i.test(entry)).sort();
    } catch {
      return [];
    }
  }

  async listPhases(): Promise<number[]> {
    try {
      const entries = await readdir(this._paths.phasesDir);
      return entries
        .filter((entry) => /^phase-\d+$/i.test(entry))
        .map((entry) => parseInt(entry.replace(/^phase-0*/, ""), 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  async hasPhaseTaskSpecs(phase: number): Promise<boolean> {
    const dir = path.join(this._paths.phasesDir, `phase-${String(phase).padStart(2, "0")}`, "tasks");
    try {
      const entries = await readdir(dir);
      return entries.some((entry) => /^task-\d+\.md$/i.test(entry));
    } catch {
      return false;
    }
  }

  async ensurePhaseLayout(currentPhase: number, totalPhases: number): Promise<void> {
    const effectiveTotal = Math.max(totalPhases, 1);
    for (let phase = currentPhase; phase <= effectiveTotal; phase += 1) {
      const phaseDir = path.join(this._paths.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
      await mkdir(phaseDir, { recursive: true });
    }
    const phaseOneTasksLink = path.join(this._paths.phasesDir, "phase-01", "tasks");
    if (!(await pathExists(phaseOneTasksLink))) {
      await symlink(
        path.relative(path.join(this._paths.phasesDir, "phase-01"), this._paths.tasksDir),
        phaseOneTasksLink,
        "dir",
      );
    }
  }

  async readWorkspaceFile(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(path.join(this._paths.workspaceRoot, relativePath), "utf8");
    } catch {
      return undefined;
    }
  }

  async writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
    const targetPath = path.join(this._paths.workspaceRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function pathsForTargetStage(artifacts: RunArtifacts, targetStage: StageName): string[] {
  switch (targetStage) {
    case "goals":
      return [
        artifacts.goalsFile,
        artifacts.researchQuestionsFile,
        artifacts.researchDir,
        artifacts.designFile,
        artifacts.structureFile,
        artifacts.planFile,
        artifacts.phaseManifestFile,
        artifacts.tasksDir,
        artifacts.baselineResultsFile,
        artifacts.stage9SummaryFile,
        artifacts.stage10SummaryFile,
      ];
    case "design":
      return [
        artifacts.designFile,
        artifacts.structureFile,
        artifacts.planFile,
        artifacts.phaseManifestFile,
        artifacts.tasksDir,
        artifacts.baselineResultsFile,
        artifacts.stage9SummaryFile,
        artifacts.stage10SummaryFile,
      ];
    case "structure":
      return [
        artifacts.structureFile,
        artifacts.planFile,
        artifacts.phaseManifestFile,
        artifacts.tasksDir,
        artifacts.baselineResultsFile,
        artifacts.stage9SummaryFile,
        artifacts.stage10SummaryFile,
      ];
    case "plan":
      return [
        artifacts.planFile,
        artifacts.phaseManifestFile,
        artifacts.tasksDir,
        artifacts.baselineResultsFile,
        artifacts.stage9SummaryFile,
        artifacts.stage10SummaryFile,
      ];
    default:
      return [];
  }
}

async function archiveAndDelete(runDir: string, archiveRoot: string, targetPath: string, archived: Set<string>): Promise<void> {
  if (!(await pathExists(targetPath))) {
    return;
  }

  const relative = path.relative(runDir, targetPath);
  const archivePath = path.join(archiveRoot, relative);
  await mkdir(path.dirname(archivePath), { recursive: true });
  await cp(targetPath, archivePath, { recursive: true, force: true });
  await rm(targetPath, { recursive: true, force: true });

  if (await pathExists(targetPath)) {
    throw new Error(`Failed to delete stale artifact: ${targetPath}`);
  }
  archived.add(relative);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadDir(targetPath: string): Promise<string[]> {
  try {
    return await readdir(targetPath);
  } catch {
    return [];
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
