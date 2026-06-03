import { detectSimpleExactFileTask } from "../workflow/simple-exact-file-workflow.js";
import type { StageModule, StageOutcome, StageRuntime, VerifyStatus } from "../port/index.js";
import { dispatchLeaf, readArtifact, writeArtifact } from "./utils.js";

export const verifyStage: StageModule = {
  stage: "verify",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const simpleTask = await detectSimpleExactFileTask(runtime);
    const repo = runtime.services.artifactRepo;
    if (simpleTask && runtime.state.route === "quick-fix") {
      const actual = await repo.readWorkspaceFile(simpleTask.filePath);
      const status: VerifyStatus = actual === simpleTask.content ? "PASS" : "FAIL";
      await writeArtifact(
        runtime,
        { kind: "stage9Summary" },
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
    const baseline = await readArtifact(runtime, { kind: "baselineResults" });
    const goals = await readArtifact(runtime, { kind: "goals" });
    const requirements = await readArtifact(runtime, { kind: "requirements" });

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

    await writeArtifact(runtime, { kind: "stage9Summary" }, verification.text);
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
  const repo = runtime.services.artifactRepo;
  const phases = await repo.listPhases();
  const contents: string[] = [];
  for (const phase of phases) {
    const content = await repo.read({ kind: "phaseFile", phase, name: fileName });
    const label = `phase-${String(phase).padStart(2, "0")}`;
    contents.push(`## ${label}\n${content ?? "None."}`);
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
