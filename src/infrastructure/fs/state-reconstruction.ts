// StateReconstruction — resume or infer the RunState from existing artifacts on disk.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseKeyValueLines } from "../codec/markdown-codec.js";
import { fileExists, getRunArtifacts } from "./artifact-repository.js";
import { loadState } from "./state-repository.js";
import { nextStageFor } from "../../domain/stage/transition-policy.js";
import type { FailurePolicy, InteractionMode, PhaseHistoryEntry, Route, RunArtifacts, RunState, StageName, VerifyStatus } from "../../application/port/index.js";

const STAGE_MARKERS: Array<{ stage: StageName; path: (artifacts: RunArtifacts) => string }> = [
  { stage: "goals", path: (artifacts) => artifacts.goalsFile },
  { stage: "research", path: (artifacts) => artifacts.researchSummaryFile },
  { stage: "design", path: (artifacts) => artifacts.designFile },
  { stage: "structure", path: (artifacts) => artifacts.structureFile },
  { stage: "plan", path: (artifacts) => artifacts.planFile },
  { stage: "verify", path: (artifacts) => artifacts.stage9SummaryFile },
  { stage: "report", path: (artifacts) => artifacts.stage10SummaryFile },
];

export async function resumeOrInferState(options: {
  workspaceRoot: string;
  runId: string;
  interactionMode: InteractionMode;
  failurePolicy: FailurePolicy;
}): Promise<{ state: RunState | undefined; artifacts: RunArtifacts }> {
  const artifacts = getRunArtifacts(options.workspaceRoot, options.runId);
  const state = await loadState(artifacts.stateFile);
  if (state) {
    return {
      state: {
        ...state,
        resumeSource: "resume",
      },
      artifacts,
    };
  }

  const inferred = await inferStateFromArtifacts(artifacts, options.interactionMode, options.failurePolicy);
  return {
    state: inferred,
    artifacts,
  };
}

export async function inferStateFromArtifacts(
  artifacts: RunArtifacts,
  interactionMode: InteractionMode,
  failurePolicy: FailurePolicy,
): Promise<RunState | undefined> {
  const completed: StageName[] = [];
  const phaseHistory: PhaseHistoryEntry[] = [];
  const route = await readRoute(artifacts);
  const totalPhases = await readTotalPhases(artifacts);
  let currentPhase = 1;
  let last: StageName | undefined;
  let verifyStatus: VerifyStatus | undefined;

  const topLevelStages = route === "quick-fix"
    ? STAGE_MARKERS.filter((marker) => marker.stage !== "design" && marker.stage !== "structure")
    : STAGE_MARKERS;

  for (const marker of topLevelStages) {
    if (marker.stage === "verify" || marker.stage === "report") {
      continue;
    }
    if (await pushCompletedMarker(marker.stage, marker.path(artifacts), completed, phaseHistory, 1)) {
      last = marker.stage;
    }
  }

  if (completed.includes("plan")) {
    const phaseResult = await inferPhaseLoop(artifacts, totalPhases, completed, phaseHistory);
    if (phaseResult.last) {
      last = phaseResult.last;
      currentPhase = phaseResult.currentPhase;
    }
  }

  const verifyContent = await readSafe(artifacts.stage9SummaryFile);
  if (verifyContent) {
    const parsedVerifyStatus = parseVerifyStatus(verifyContent);
    if (parsedVerifyStatus) {
      verifyStatus = parsedVerifyStatus;
      appendUnique(completed, "verify");
      mergePhaseHistory(phaseHistory, Math.max(currentPhase, 1), "verify");
      last = "verify";
    }
  }

  if (await pushCompletedMarker("report", artifacts.stage10SummaryFile, completed, phaseHistory, Math.max(currentPhase, 1))) {
    last = "report";
  }

  if (!last) {
    return undefined;
  }

  const nextStage = nextStageFor(last, {
    route,
    currentPhase,
    totalPhases,
    ...(verifyStatus ? { verifyStatus } : {}),
  });
  const now = new Date().toISOString();
  return {
    runId: path.basename(artifacts.runDir),
    route,
    currentPhase,
    totalPhases,
    lastCompletedStage: last,
    nextStage,
    stagesCompleted: completed,
    phaseHistory,
    backwardLoops: 0,
    acceptFixAttempts: 0,
    verifyFixAttempts: 0,
    resumeSource: "artifacts",
    interactionMode,
    failurePolicy,
    ...(verifyStatus ? { verifyStatus } : {}),
    startedAt: now,
    updatedAt: now,
  };
}

async function inferPhaseLoop(
  artifacts: RunArtifacts,
  totalPhases: number,
  completed: StageName[],
  phaseHistory: PhaseHistoryEntry[],
): Promise<{ last: StageName | undefined; currentPhase: number }> {
  const maxPhase = Math.max(totalPhases, await maxExistingPhase(artifacts), 1);
  let last: StageName | undefined;
  let currentPhase = 1;
  for (let phase = 1; phase <= maxPhase; phase += 1) {
    currentPhase = phase;
    const phaseDir = path.join(artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    const implementDone = await pushCompletedMarker("implement", path.join(phaseDir, "stage7-summary.md"), completed, phaseHistory, phase);
    if (!implementDone) {
      return { last, currentPhase };
    }
    last = "implement";

    const acceptDone = await pushCompletedMarker("accept", path.join(phaseDir, "stage8-summary.md"), completed, phaseHistory, phase);
    if (!acceptDone) {
      return { last, currentPhase };
    }
    last = "accept";

    const replanPath = path.join(phaseDir, "replan", `phase-${String(phase).padStart(2, "0")}-replan.md`);
    const replanDone = await pushCompletedMarker("replan", replanPath, completed, phaseHistory, phase);
    if (!replanDone) {
      return { last, currentPhase };
    }
    last = "replan";
    currentPhase = Math.min(phase + 1, maxPhase);
  }
  return { last, currentPhase };
}

async function pushCompletedMarker(
  stage: StageName,
  filePath: string,
  completed: StageName[],
  phaseHistory: PhaseHistoryEntry[],
  phase: number,
): Promise<boolean> {
  if (!(await fileExists(filePath))) {
    return false;
  }
  const content = await readSafe(filePath);
  if (!content || containsFailMarker(content)) {
    return false;
  }
  appendUnique(completed, stage);
  mergePhaseHistory(phaseHistory, phase, stage);
  return true;
}

function containsFailMarker(content: string): boolean {
  return /###\s+(?:Overall\s+)?Status\s+[—-]\s+FAIL\b/i.test(content);
}

async function readRoute(artifacts: RunArtifacts): Promise<Route> {
  const config = await readSafe(artifacts.configFile);
  const route = parseKeyValueLines(config).route;
  return route === "quick-fix" ? "quick-fix" : route === "full" ? "full" : "unknown";
}

async function readTotalPhases(artifacts: RunArtifacts): Promise<number> {
  const manifest = await readSafe(artifacts.phaseManifestFile);
  const parsed = Number.parseInt(parseKeyValueLines(manifest).total_phases ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function maxExistingPhase(artifacts: RunArtifacts): Promise<number> {
  try {
    const entries = await readdir(artifacts.phasesDir);
    return entries
      .map((entry) => Number.parseInt(entry.match(/^phase-(\d+)$/i)?.[1] ?? "", 10))
      .filter((phase) => Number.isFinite(phase))
      .reduce((max, phase) => Math.max(max, phase), 0);
  } catch {
    return 0;
  }
}

function parseVerifyStatus(content: string): VerifyStatus | undefined {
  const status = content.match(/###\s+Overall\s+Status\s+[—-]\s+(PASS|PARTIAL|FAIL)\b/i)?.[1]?.toUpperCase()
    ?? content.match(/###\s+Status\s+[—-]\s+(PASS|PARTIAL|FAIL)\b/i)?.[1]?.toUpperCase();
  return status === "PASS" || status === "PARTIAL" || status === "FAIL" ? status : undefined;
}

function appendUnique(stages: StageName[], stage: StageName): void {
  if (!stages.includes(stage)) {
    stages.push(stage);
  }
}

function mergePhaseHistory(history: PhaseHistoryEntry[], phase: number, stage: StageName): void {
  const existing = history.find((entry) => entry.phase === phase);
  if (!existing) {
    history.push({ phase, completedStages: [stage] });
    return;
  }
  if (!existing.completedStages.includes(stage)) {
    existing.completedStages.push(stage);
  }
}

async function readSafe(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
