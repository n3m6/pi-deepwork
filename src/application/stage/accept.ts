import { detectSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import type { ArtifactId, StageModule, StageOutcome, StageRuntime } from "../port/index.js";
import { artifactRelPath, writeArtifact } from "./utils.js";
import { runAcceptanceTesterSubstage } from "./acceptance-tester.js";

export const acceptStage: StageModule = {
  stage: "accept",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const phase = runtime.state.currentPhase;
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const actual = await runtime.services.artifactRepo.readWorkspaceFile(simpleTask.filePath);
      const pass = actual === simpleTask.content;
      const filesWritten = await writeSimpleAcceptanceArtifacts(runtime, phase, simpleTask.filePath, simpleTask.content, pass);
      return {
        status: pass ? "PASS" : "FAIL",
        phase,
        filesWritten,
        summary: pass ? "Simple exact-file acceptance passed." : "Simple exact-file acceptance failed.",
        telemetry: {
          deterministic_fast_path: "simple-exact-file",
          evidence_quality: {
            deterministic: pass ? 1 : 0,
            flaky: 0,
            harnessNoisy: 0,
            ambiguous: 0,
            redundant: 0,
            noTestTasks: 0,
            noTestAuditOverrides: 0,
          },
        },
      };
    }

    const acceptance = await runAcceptanceTesterSubstage(runtime);

    if (acceptance.status === "PASS") {
      return {
        status: "PASS",
        phase,
        filesWritten: acceptance.filesWritten,
        summary: "Acceptance coverage and phase validation succeeded.",
        telemetry: {
          ...acceptance.telemetry,
          child_agent_calls: {
            "qrspi-coverage-planner": 1,
          },
        },
      };
    }

    return {
      status: "FAIL",
      phase,
      filesWritten: acceptance.filesWritten,
      summary: acceptance.summary,
      ...(acceptance.telemetry ? { telemetry: acceptance.telemetry } : {}),
    };
  },
};

async function writeSimpleAcceptanceArtifacts(
  runtime: StageRuntime,
  phase: number,
  filePath: string,
  content: string,
  pass: boolean,
): Promise<string[]> {
  const acceptanceId: ArtifactId = { kind: "phaseFile", phase, name: "acceptance-results.md" };
  const summaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage8-summary.md" };
  await writeArtifact(
    runtime,
    acceptanceId,
    [
      "# Acceptance Results",
      "",
      "| # | Criterion | Status | Failure Reason |",
      "| - | --------- | ------ | -------------- |",
      `| 1 | \`${filePath}\` exists with exact content \`${content}\` | ${pass ? "PASS" : "FAIL"} | ${pass ? "none" : "content mismatch or missing file"} |`,
    ].join("\n"),
  );
  await writeArtifact(
    runtime,
    summaryId,
    [
      "# Stage 8 Summary",
      "",
      pass ? "Acceptance passed for the simple exact-file task." : "Acceptance failed for the simple exact-file task.",
    ].join("\n"),
  );
  return [
    artifactRelPath(runtime, acceptanceId),
    artifactRelPath(runtime, summaryId),
  ];
}
