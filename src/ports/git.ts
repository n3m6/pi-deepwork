export interface GitBranchResult {
  ok: boolean;
  error?: string;
}

export interface GitPort {
  isAvailable(): boolean;
  createRunBranch(runId: string, workspaceRoot: string): GitBranchResult;
}
