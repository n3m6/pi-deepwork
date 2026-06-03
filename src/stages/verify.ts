import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { detectSimpleExactFileTask } from "../application/workflow/simple-exact-file-workflow.js";
import type { StageModule, StageOutcome, StageRuntime, VerifyStatus } from "../types.js";
import { dispatchLeaf, readArtifact, writeArtifact } from "./utils.js";

export const verifyStage: StageModule = {
  stage: "verify",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const simpleTask = await detectSimpleExactFileTask(runtime);
    if (simpleTask && runtime.state.route === "quick-fix") {
      const actual = await readFile(path.join(runtime.artifacts.workspaceRoot, simpleTask.filePath), "utf8").catch(() => undefined);
      const status: VerifyStatus = actual === simpleTask.content ? "PASS" : "FAIL";
      await writeArtifact(
        runtime.artifacts.stage9SummaryFile,
        [
          "## QRSPI Verification",
          "",
          `### Overall Status — ${status}`,
          "",
          `Verified \`${simpleTask.filePath}\` ${status === "PASS" ? "contains" : "does not contain"} exactly \`${simpleTask.content}\`.`,
        ].join("\n"),
      );
      return {
        status,
        filesWritten: ["stage9-summary.md"],
        summary: `Verification ${status}.`,
        telemetry: {
          verify_status: status,
          deterministic_fast_path: "simple-exact-file",
        },
      };
    }

    const executionManifests = await readPhaseArtifacts(runtime, "execution-manifest.md");
    const stage7Summaries = await readPhaseArtifacts(runtime, "stage7-summary.md");
    const regressions = await readPhaseArtifacts(runtime, "regression-results.md");
    const acceptance = await readPhaseArtifacts(runtime, "acceptance-results.md");
    const baseline = await readArtifact(runtime.artifacts.baselineResultsFile);
    const goals = await readArtifact(runtime.artifacts.goalsFile);
    const requirements = await readArtifact(runtime.artifacts.requirementsFile);

    const verification = await dispatchLeaf(
      runtime,
      "qrspi-verifier",
      [
        "=== GOALS ===",
        goals,
        "",
        "=== REQUIREMENTS ===",
        requirements,
        "",
        "=== EXECUTION MANIFESTS ===",
        executionManifests,
        "",
        "=== STAGE 7 SUMMARIES ===",
        stage7Summaries,
        "",
        "=== PHASE REGRESSION RESULTS ===",
        regressions,
        "",
        "=== ACCEPTANCE RESULTS (ALL PHASES) ===",
        acceptance,
        "",
        "=== BASELINE RESULTS ===",
        baseline,
      ].join("\n"),
    );

    await writeArtifact(runtime.artifacts.stage9SummaryFile, verification.text);
    const status = parseOverallStatus(verification.text);
    return {
      status,
      filesWritten: ["stage9-summary.md"],
      summary: `Verification ${status}.`,
      telemetry: {
        verify_status: status as VerifyStatus,
      },
    };
  },
};

async function readPhaseArtifacts(runtime: StageRuntime, fileName: string): Promise<string> {
  const phases = await readdir(runtime.artifacts.phasesDir).catch(() => []);
  const files = phases.filter((entry) => /^phase-\d+$/i.test(entry)).sort();
  const contents: string[] = [];
  for (const phase of files) {
    const filePath = path.join(runtime.artifacts.phasesDir, phase, fileName);
    try {
      const content = await readArtifact(filePath);
      contents.push(`## ${phase}\n${content}`);
    } catch {
      contents.push(`## ${phase}\nNone.`);
    }
  }
  return contents.join("\n\n");
}

export function parseOverallStatus(markdown: string): StageOutcome["status"] {
  const overall = markdown.match(/### Overall Status\s+[—-]\s+(PASS|PARTIAL|FAIL)/i)?.[1]?.toUpperCase();
  if (overall === "PASS" || overall === "PARTIAL" || overall === "FAIL") {
    return overall;
  }
  return /PASS\b/i.test(markdown) ? "PASS" : "FAIL";
}
