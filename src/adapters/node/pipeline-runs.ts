import { readDirectoryNames } from "./file-system";

export function scanPipelineRunIds(pipelineRoot = ".pipeline"): string[] {
  try {
    const entries = readDirectoryNames(pipelineRoot);
    return entries.filter((name) => name.startsWith("qrspi-"));
  } catch {
    return [];
  }
}
