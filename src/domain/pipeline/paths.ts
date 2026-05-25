export interface PipelinePaths {
  pipelineDir: string;
  gitBranch: string;
  statePath: string;
  telemetryDir: string;
  eventsPath: string;
  runLogPath: string;
  metricsPath: string;
}

export function generateRunId(): string {
  const now = new Date();
  const Y = now.getUTCFullYear().toString();
  const M = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const D = now.getUTCDate().toString().padStart(2, "0");
  const h = now.getUTCHours().toString().padStart(2, "0");
  const m = now.getUTCMinutes().toString().padStart(2, "0");
  const s = now.getUTCSeconds().toString().padStart(2, "0");
  return `qrspi-${Y}${M}${D}-${h}${m}${s}`;
}

export function getPipelineDir(runId: string): string {
  return `.pipeline/${runId}`;
}

export function getGitBranch(runId: string): string {
  return `qrspi/${runId}`;
}

export function getStatePath(runId: string): string {
  return `${getPipelineDir(runId)}/state.md`;
}

export function getTelemetryDir(runId: string): string {
  return `${getPipelineDir(runId)}/telemetry`;
}

export function getEventsPath(runId: string): string {
  return `${getTelemetryDir(runId)}/events.jsonl`;
}

export function getRunLogPath(runId: string): string {
  return `${getTelemetryDir(runId)}/run-log.md`;
}

export function getMetricsPath(runId: string): string {
  return `${getTelemetryDir(runId)}/metrics-summary.md`;
}

export function getPipelinePaths(runId: string): PipelinePaths {
  return {
    pipelineDir: getPipelineDir(runId),
    gitBranch: getGitBranch(runId),
    statePath: getStatePath(runId),
    telemetryDir: getTelemetryDir(runId),
    eventsPath: getEventsPath(runId),
    runLogPath: getRunLogPath(runId),
    metricsPath: getMetricsPath(runId),
  };
}
