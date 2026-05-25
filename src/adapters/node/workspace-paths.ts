import * as fs from "node:fs";
import * as path from "node:path";

import {
  getEventsPath,
  getMetricsPath,
  getRunLogPath,
  getStatePath,
  getTelemetryDir,
} from "../../domain/pipeline";

const WORKSPACE_ROOT_MARKERS = [
  "package.json",
  ".git",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  ".pi",
] as const;

/**
 * Returns true when `candidate` contains at least one marker that suggests it
 * is a real project workspace root (rather than e.g. `$HOME` or the directory
 * pi was launched from). Used to guard best-effort activation-time agent
 * mirroring so we never write `.pi/agents/` into a parent directory of the
 * user's actual workspace.
 */
export function looksLikeWorkspaceRoot(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return false;
  }
  for (const marker of WORKSPACE_ROOT_MARKERS) {
    try {
      if (fs.existsSync(path.join(candidate, marker))) {
        return true;
      }
    } catch {
      // ignore and keep checking other markers
    }
  }
  return false;
}

export interface WorkspacePipelinePaths {
  statePath: string;
  telemetryDir: string;
  eventsPath: string;
  runLogPath: string;
  metricsPath: string;
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  filePath: string,
): string {
  return path.resolve(workspaceRoot, filePath);
}

export function resolveWorkspacePaths(
  workspaceRoot: string,
  runId: string,
): WorkspacePipelinePaths {
  return {
    statePath: resolveWorkspacePath(workspaceRoot, getStatePath(runId)),
    telemetryDir: resolveWorkspacePath(workspaceRoot, getTelemetryDir(runId)),
    eventsPath: resolveWorkspacePath(workspaceRoot, getEventsPath(runId)),
    runLogPath: resolveWorkspacePath(workspaceRoot, getRunLogPath(runId)),
    metricsPath: resolveWorkspacePath(workspaceRoot, getMetricsPath(runId)),
  };
}
