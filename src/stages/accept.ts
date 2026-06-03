import path from "node:path";
import { readFile } from "node:fs/promises";

import { detectSimpleExactFileTask } from "../application/workflow/simple-exact-file-workflow.js";
import type { StageModule, StageOutcome, StageRuntime } from "../types.js";
import { writeArtifact } from "./utils.js";
import { runAcceptanceTesterSubstage } from "./acceptance-tester.js";

export const acceptStage: StageModule = {
  stage: "accept",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const phase = runtime.state.currentPhase;
    const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const actual = await readFile(path.join(runtime.artifacts.workspaceRoot, simpleTask.filePath), "utf8").catch(() => undefined);
      const pass = actual === simpleTask.content;
      const filesWritten = await writeSimpleAcceptanceArtifacts(runtime, phaseDir, simpleTask.filePath, simpleTask.content, pass);
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
  phaseDir: string,
  filePath: string,
  content: string,
  pass: boolean,
): Promise<string[]> {
  const acceptancePath = path.join(phaseDir, "acceptance-results.md");
  const summaryPath = path.join(phaseDir, "stage8-summary.md");
  await writeArtifact(
    acceptancePath,
    [
      "# Acceptance Results",
      "",
      "| # | Criterion | Status | Failure Reason |",
      "| - | --------- | ------ | -------------- |",
      `| 1 | \`${filePath}\` exists with exact content \`${content}\` | ${pass ? "PASS" : "FAIL"} | ${pass ? "none" : "content mismatch or missing file"} |`,
    ].join("\n"),
  );
  await writeArtifact(
    summaryPath,
    [
      "# Stage 8 Summary",
      "",
      pass ? "Acceptance passed for the simple exact-file task." : "Acceptance failed for the simple exact-file task.",
    ].join("\n"),
  );
  return [
    path.relative(runtime.artifacts.runDir, acceptancePath),
    path.relative(runtime.artifacts.runDir, summaryPath),
  ];
}
