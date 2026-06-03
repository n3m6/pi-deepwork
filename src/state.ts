import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  FailurePolicy,
  InteractionMode,
  NextStage,
  PhaseHistoryEntry,
  Route,
  RunArtifacts,
  RunState,
  StageName,
} from "./types.js";

export function createRunId(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `qrspi-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

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

export function createInitialState(options: {
  runId: string;
  userTask?: string;
  interactionMode: InteractionMode;
  failurePolicy: FailurePolicy;
  route?: Route;
  nextStage?: NextStage;
  now?: string;
}): RunState {
  const timestamp = options.now ?? new Date().toISOString();
  return {
    runId: options.runId,
    route: options.route ?? "unknown",
    currentPhase: 1,
    totalPhases: 0,
    lastCompletedStage: "none",
    nextStage: options.nextStage ?? "goals",
    stagesCompleted: [],
    phaseHistory: [],
    backwardLoops: 0,
    acceptFixAttempts: 0,
    verifyFixAttempts: 0,
    resumeSource: "fresh",
    interactionMode: options.interactionMode,
    failurePolicy: options.failurePolicy,
    startedAt: timestamp,
    updatedAt: timestamp,
    ...(options.userTask ? { userTask: options.userTask } : {}),
  };
}

export async function loadState(stateFile: string): Promise<RunState | undefined> {
  try {
    const raw = await readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw) as RunState;
    return {
      ...parsed,
      acceptFixAttempts: parsed.acceptFixAttempts ?? 0,
      verifyFixAttempts: parsed.verifyFixAttempts ?? 0,
    };
  } catch {
    return undefined;
  }
}

export async function saveState(stateFile: string, state: RunState): Promise<void> {
  const nextState: RunState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

export function markStageCompleted(
  state: RunState,
  stage: StageName,
  nextStage: NextStage,
  options?: {
    route?: Route;
    phase?: number;
    totalPhases?: number;
    verifyStatus?: RunState["verifyStatus"];
  },
): RunState {
  const phase = options?.phase ?? state.currentPhase;
  const phaseHistory = mergePhaseHistory(state.phaseHistory, phase, stage);
  const nextState: RunState = {
    ...state,
    route: options?.route ?? state.route,
    currentPhase: phase,
    totalPhases: options?.totalPhases ?? state.totalPhases,
    lastCompletedStage: stage,
    nextStage,
    stagesCompleted: appendUniqueStage(state.stagesCompleted, stage),
    phaseHistory,
  };
  if (options?.verifyStatus) {
    nextState.verifyStatus = options.verifyStatus;
  }
  return nextState;
}

export function markStageSkipped(state: RunState, stage: StageName, nextStage: NextStage): RunState {
  return {
    ...state,
    lastCompletedStage: state.lastCompletedStage,
    nextStage,
  };
}

export function advancePhase(state: RunState, totalPhases: number): RunState {
  return {
    ...state,
    currentPhase: Math.min(state.currentPhase + 1, Math.max(totalPhases, 1)),
    totalPhases,
  };
}

export function incrementBackwardLoops(state: RunState): RunState {
  return {
    ...state,
    backwardLoops: state.backwardLoops + 1,
  };
}

export function resetCurrentPhase(state: RunState): RunState {
  return {
    ...state,
    currentPhase: 1,
  };
}

export function incrementVerifyFixAttempts(state: RunState): RunState {
  return {
    ...state,
    verifyFixAttempts: state.verifyFixAttempts + 1,
  };
}

export function incrementAcceptFixAttempts(state: RunState): RunState {
  return {
    ...state,
    acceptFixAttempts: state.acceptFixAttempts + 1,
  };
}

export function resetVerifyFixAttempts(state: RunState): RunState {
  return {
    ...state,
    verifyFixAttempts: 0,
  };
}

export function resetAcceptFixAttempts(state: RunState): RunState {
  return {
    ...state,
    acceptFixAttempts: 0,
  };
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function appendUniqueStage(stages: StageName[], stage: StageName): StageName[] {
  return stages.includes(stage) ? stages : [...stages, stage];
}

function mergePhaseHistory(history: PhaseHistoryEntry[], phase: number, stage: StageName): PhaseHistoryEntry[] {
  const existing = history.find((entry) => entry.phase === phase);
  if (!existing) {
    return [...history, { phase, completedStages: [stage] }];
  }

  return history.map((entry) =>
    entry.phase === phase
      ? {
          ...entry,
          completedStages: appendUniqueStage(entry.completedStages, stage),
        }
      : entry,
  );
}
