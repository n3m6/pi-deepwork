import path from "node:path";

import { isPipelineArtifact, isTestFile } from "../domain/stage/boundary-policy.js";
import type { DispatchRequest, StageOutcome, StageRuntime, VersionControl } from "../types.js";
import { dispatchGenericCoding, dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

const ACCEPTANCE_PLAN_REVIEWERS = [
  "qrspi-review-accept-spec",
  "qrspi-review-accept-code-quality",
  "qrspi-review-accept-goal-traceability",
] as const;

export async function runAcceptanceTesterSubstage(runtime: StageRuntime): Promise<StageOutcome> {
  const phase = runtime.state.currentPhase;
  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
  const phaseManifest = await readArtifact(runtime.artifacts.phaseManifestFile);
  const executionManifest = await readArtifact(path.join(phaseDir, "execution-manifest.md"));
  const goals = await readArtifact(runtime.artifacts.goalsFile);
  const requirements = await readArtifact(runtime.artifacts.requirementsFile);
  const design = runtime.state.route === "full" ? await readArtifact(runtime.artifacts.designFile) : "N/A";
  const structure = runtime.state.route === "full" ? await readArtifact(runtime.artifacts.structureFile) : "N/A";

  let coveragePlan = await dispatchCoveragePlanner(runtime, {
    phase,
    goals,
    requirements,
    executionManifest,
    phaseManifest,
    design,
    structure,
    round: 1,
  });
  let plannerReviewCycles = 0;
  const reviewArtifacts: string[] = [];
  while (plannerReviewCycles < 3) {
    plannerReviewCycles += 1;
    const reviewResults = await dispatchAcceptancePlanReviewers(runtime, coveragePlan.text, {
      phase,
      goals,
      requirements,
      executionManifest,
      phaseManifest,
    });
    const blocking = [];
    for (const [index, result] of reviewResults.entries()) {
      const reviewer = ACCEPTANCE_PLAN_REVIEWERS[index];
      if (!reviewer) {
        continue;
      }
      const reviewPath = path.join(runtime.artifacts.reviewsDir, `acceptance-phase-${String(phase).padStart(2, "0")}-plan-${reviewer.replace(/^qrspi-/, "")}-cycle-${String(plannerReviewCycles).padStart(2, "0")}.md`);
      await writeArtifact(reviewPath, result.text);
      reviewArtifacts.push(path.relative(runtime.artifacts.runDir, reviewPath));
      if (parseReviewStatus(result.text) === "FAIL") {
        blocking.push(result.text);
      }
    }
    if (blocking.length === 0) {
      break;
    }
    if (plannerReviewCycles === 3) {
      return {
        status: "FAIL",
        phase,
        filesWritten: reviewArtifacts,
        summary: "Acceptance coverage plan reviewers did not converge.",
        telemetry: {
          planner_review_cycles: plannerReviewCycles,
          terminal_review_state: "unclean-cap",
          child_agent_calls: Object.fromEntries(ACCEPTANCE_PLAN_REVIEWERS.map((reviewer) => [reviewer, plannerReviewCycles])),
        },
      };
    }
    coveragePlan = await dispatchCoveragePlanner(runtime, {
      phase,
      goals,
      requirements,
      executionManifest,
      phaseManifest,
      design,
      structure,
      round: plannerReviewCycles + 1,
      reviewFeedback: blocking.join("\n\n"),
    });
  }

  const coveragePlanPath = path.join(phaseDir, "coverage-plan.md");
  await writeArtifact(coveragePlanPath, coveragePlan.text);

  const beforeAcceptanceFiles = await workspaceFiles(runtime);
  let implementation: StageOutcome = {
    status: "FAIL",
    filesWritten: [],
    summary: "Acceptance testing did not run.",
  };
  let round = 1;
  while (round <= 3) {
    implementation = await dispatchGenericCoding(
    runtime,
    [
      "You are running Stage 7 acceptance testing for the current phase.",
      "Only create or update acceptance/integration/e2e test files. Do not modify production code.",
      "Use the coverage plan, task specs, goals, and phase manifest as the contract.",
      "Run the relevant project tests needed to validate the current phase, then return with stage_return.",
      "",
      "Required outputs:",
      "- Write any needed test files under the workspace.",
      "- Summarize the results in `.pipeline/<run-id>/phases/phase-NN/acceptance-results.md` and `.pipeline/<run-id>/phases/phase-NN/stage8-summary.md` if they do not already exist.",
      "",
      `Run ID: ${runtime.state.runId}`,
      `Phase: ${phase}`,
      `Coverage plan path: ${coveragePlanPath}`,
      `Phase directory: ${phaseDir}`,
      "",
      "Return telemetry.evidence_quality with counts for deterministic, flaky, harnessNoisy, ambiguous, redundant, noTestTasks, and noTestAuditOverrides.",
    ].join("\n"),
    { cwd: runtime.artifacts.workspaceRoot },
    );
    if (implementation.status === "PASS" || round === 3) {
      break;
    }
    round += 1;
  }
  const boundaryViolations = await detectBoundaryViolations(runtime, beforeAcceptanceFiles);
  if (boundaryViolations.length > 0) {
    const boundaryPath = path.join(phaseDir, "boundary-violations.md");
    await writeArtifact(boundaryPath, ["# Boundary Violations", "", ...boundaryViolations.map((file) => `- ${file}`)].join("\n"));
    return {
      status: "FAIL",
      phase,
      filesWritten: [
        "phases/phase-NN/coverage-plan.md".replace("NN", String(phase).padStart(2, "0")),
        ...reviewArtifacts,
        path.relative(runtime.artifacts.runDir, boundaryPath),
      ],
      summary: "Acceptance modified non-test files.",
      telemetry: {
        boundary_violation: true,
        acceptance_loop_rounds: round,
        planner_review_cycles: plannerReviewCycles,
      },
    };
  }

  if (implementation.status === "PASS") {
    const acceptanceResultsPath = path.join(phaseDir, "acceptance-results.md");
    const stageSummaryPath = path.join(phaseDir, "stage8-summary.md");
    if (!(await fileExists(acceptanceResultsPath))) {
      await writeArtifact(
        acceptanceResultsPath,
        `# Acceptance Results\n\n## Summary\n${implementation.summary}\n\n## Status\nPASS\n`,
      );
    }
    if (!(await fileExists(stageSummaryPath))) {
      await writeArtifact(stageSummaryPath, `### Status — PASS\n\n# Stage 8 Summary\n\n${implementation.summary}\n`);
    }
  }

  const stageSummaryPath = path.join(phaseDir, "stage8-summary.md");
  const existingStageSummary = await safeRead(stageSummaryPath);
  if (!/^### Status\s+[—-]/m.test(existingStageSummary)) {
    await writeArtifact(
      stageSummaryPath,
      implementation.status === "PASS" && existingStageSummary !== "None."
        ? `### Status — PASS\n\n${existingStageSummary}`
        : `### Status — ${implementation.status}\n\n# Stage 8 Summary\n\n${implementation.summary}\n`,
    );
  }

  return {
    ...implementation,
    filesWritten: [
      "phases/phase-NN/coverage-plan.md".replace("NN", String(phase).padStart(2, "0")),
      ...reviewArtifacts,
      ...implementation.filesWritten,
    ],
    telemetry: {
      ...implementation.telemetry,
      acceptance_loop_rounds: round,
      planner_review_cycles: plannerReviewCycles,
      child_agent_calls: {
        "qrspi-coverage-planner": plannerReviewCycles,
        ...Object.fromEntries(ACCEPTANCE_PLAN_REVIEWERS.map((reviewer) => [reviewer, plannerReviewCycles])),
      },
    },
  };
}

async function dispatchCoveragePlanner(
  runtime: StageRuntime,
  options: {
    phase: number;
    goals: string;
    requirements: string;
    executionManifest: string;
    phaseManifest: string;
    design: string;
    structure: string;
    round: number;
    reviewFeedback?: string;
  },
) {
  const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(options.phase).padStart(2, "0")}`);
  return dispatchLeaf(
    runtime,
    "qrspi-coverage-planner",
    [
      "=== GOALS ===",
      options.goals,
      "",
      "=== REQUIREMENTS ===",
      options.requirements,
      "",
      "=== EXECUTION MANIFEST ===",
      options.executionManifest,
      "",
      "=== PHASE MANIFEST ===",
      options.phaseManifest,
      "",
      "=== CURRENT PHASE ===",
      String(options.phase),
      "",
      "=== INTEGRATION RESULTS ===",
      await safeRead(path.join(phaseDir, "integration-results.md")),
      "",
      "=== DESIGN CONTEXT ===",
      options.design,
      "",
      "=== STRUCTURE CONTEXT ===",
      options.structure,
      "",
      "=== PHASE-SCOPED CRITERIA ===",
      extractPhaseSection(options.phaseManifest, options.phase),
      "",
      "=== ROUND ===",
      String(options.round),
      options.reviewFeedback ? "\n=== PLAN REVIEW FEEDBACK ===" : "",
      options.reviewFeedback ?? "",
    ].filter(Boolean).join("\n"),
  );
}

async function dispatchAcceptancePlanReviewers(
  runtime: StageRuntime,
  coveragePlan: string,
  context: {
    phase: number;
    goals: string;
    requirements: string;
    executionManifest: string;
    phaseManifest: string;
  },
) {
  const requests: DispatchRequest[] = ACCEPTANCE_PLAN_REVIEWERS.map((agentName) => {
    const target = runtime.services.agentDefinitions.get(agentName);
    if (!target) {
      throw new Error(`Missing leaf agent definition: ${agentName}`);
    }
    return {
      target,
      cwd: runtime.artifacts.workspaceRoot,
      ...(runtime.services.eventContext.signal ? { signal: runtime.services.eventContext.signal } : {}),
      prompt: [
        "Review the Stage 7 acceptance coverage plan before tests are authored.",
        "",
        "=== GOALS ===",
        context.goals,
        "",
        "=== REQUIREMENTS ===",
        context.requirements,
        "",
        "=== EXECUTION MANIFEST ===",
        context.executionManifest,
        "",
        "=== PHASE MANIFEST ===",
        context.phaseManifest,
        "",
        "=== CURRENT PHASE ===",
        String(context.phase),
        "",
        "=== COVERAGE PLAN ===",
        coveragePlan,
      ].join("\n"),
    };
  });
  return runtime.services.dispatcher.dispatchParallel(requests);
}

function extractPhaseSection(manifest: string, phase: number): string {
  const regex = new RegExp(`## Phase ${phase}[^]*?(?=\\n## Phase \\d|$)`, "m");
  return manifest.match(regex)?.[0] ?? manifest;
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "None.";
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readArtifact(filePath);
    return true;
  } catch {
    return false;
  }
}

function requireVersionControl(runtime: StageRuntime): VersionControl {
  if (!runtime.services.versionControl) {
    throw new Error("VersionControl port is not wired; ensure the composition root initialises it.");
  }
  return runtime.services.versionControl;
}

async function workspaceFiles(runtime: StageRuntime): Promise<Set<string>> {
  const files = await requireVersionControl(runtime).changedFiles(
    runtime.artifacts.workspaceRoot,
    runtime.services.eventContext.signal,
  );
  return new Set(files);
}

async function detectBoundaryViolations(runtime: StageRuntime, before: Set<string>): Promise<string[]> {
  const after = await workspaceFiles(runtime);
  return [...after]
    .filter((file) => !before.has(file))
    .filter((file) => !isPipelineArtifact(file))
    .filter((file) => !isTestFile(file));
}

export { isPipelineArtifact, isTestFile };
