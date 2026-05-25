import * as path from "node:path";

import {
  getEventsPath,
  getMetricsPath,
  getRunLogPath,
  getStatePath,
  getTelemetryDir,
} from "../../domain/pipeline";

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
