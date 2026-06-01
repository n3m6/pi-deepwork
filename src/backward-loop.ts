import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { BackwardLoopClassification, RunArtifacts, StageName } from "./types.js";

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

function backwardLoopTarget(classification: BackwardLoopClassification): StageName {
  switch (classification) {
    case "LOOP_GOALS":
      return "goals";
    case "LOOP_DESIGN":
      return "design";
    case "LOOP_STRUCTURE":
      return "structure";
    case "LOOP_PLAN":
    case "NO_LOOP":
    default:
      return "plan";
    case "DEFER_REPLAN":
      return "replan";
  }
}

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
