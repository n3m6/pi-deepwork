import { isPipelineArtifact, isTestFile } from "../../domain/stage/boundary-policy.js";
import { MAX_ACCEPTANCE_ROUNDS } from "../../domain/run/index.js";
import type { ArtifactId, DispatchRequest, StageOutcome, StageRuntime, VersionControl } from "../port/index.js";
import {
  artifactRelPath,
  dispatchGenericCoding,
  dispatchLeaf,
  parseReviewStatus,
  readArtifact,
  writeArtifact,
} from "./utils.js";

const ACCEPTANCE_PLAN_REVIEWERS = [
  "qrspi-review-accept-spec",
  "qrspi-review-accept-code-quality",
  "qrspi-review-accept-goal-traceability",
] as const;

export async function runAcceptanceTesterSubstage(runtime: StageRuntime): Promise<StageOutcome> {
  const phase = runtime.state.currentPhase;
  const repo = runtime.services.artifactRepo;
  const phaseManifest = await readArtifact(runtime, { kind: "phaseManifest" });
  const executionManifest = (await repo.read({ kind: "phaseFile", phase, name: "execution-manifest.md" })) ?? "None.";
  const goals = await readArtifact(runtime, { kind: "goals" });
  const requirements = await readArtifact(runtime, { kind: "requirements" });
  const design = runtime.state.route === "full" ? await readArtifact(runtime, { kind: "design" }) : "N/A";
  const structure = runtime.state.route === "full" ? await readArtifact(runtime, { kind: "structure" }) : "N/A";

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
      const reviewId: ArtifactId = {
        kind: "reviewFile",
        name: `acceptance-phase-${String(phase).padStart(2, "0")}-plan-${reviewer.replace(/^qrspi-/, "")}-cycle-${String(plannerReviewCycles).padStart(2, "0")}.md`,
      };
      await writeArtifact(runtime, reviewId, result.text);
      reviewArtifacts.push(artifactRelPath(runtime, reviewId));
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
          child_agent_calls: Object.fromEntries(
            ACCEPTANCE_PLAN_REVIEWERS.map((reviewer) => [reviewer, plannerReviewCycles]),
          ),
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

  const coveragePlanId: ArtifactId = { kind: "phaseFile", phase, name: "coverage-plan.md" };
  await writeArtifact(runtime, coveragePlanId, coveragePlan.text);

  const beforeAcceptanceFiles = await workspaceFiles(runtime);
  let implementation: StageOutcome = {
    status: "FAIL",
    filesWritten: [],
    summary: "Acceptance testing did not run.",
  };
  const coveragePlanPath = repo.resolvePath(coveragePlanId);
  const phaseDir = repo.resolvePath({ kind: "phaseFile", phase, name: "" }).replace(/\/$/, "");
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
      { cwd: runtime.workspaceRoot },
    );
    if (implementation.status === "PASS" || round === MAX_ACCEPTANCE_ROUNDS) {
      break;
    }
    round += 1;
  }
  const boundaryViolations = await detectBoundaryViolations(runtime, beforeAcceptanceFiles);
  if (boundaryViolations.length > 0) {
    const boundaryId: ArtifactId = { kind: "phaseFile", phase, name: "boundary-violations.md" };
    await writeArtifact(
      runtime,
      boundaryId,
      ["# Boundary Violations", "", ...boundaryViolations.map((file) => `- ${file}`)].join("\n"),
    );
    const phaseLabel = `phase-${String(phase).padStart(2, "0")}`;
    return {
      status: "FAIL",
      phase,
      filesWritten: [`phases/${phaseLabel}/coverage-plan.md`, ...reviewArtifacts, artifactRelPath(runtime, boundaryId)],
      summary: "Acceptance modified non-test files.",
      telemetry: {
        boundary_violation: true,
        acceptance_loop_rounds: round,
        planner_review_cycles: plannerReviewCycles,
      },
    };
  }

  if (implementation.status === "PASS") {
    const acceptanceResultsId: ArtifactId = { kind: "phaseFile", phase, name: "acceptance-results.md" };
    const stageSummaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage8-summary.md" };
    if (!(await repo.exists(acceptanceResultsId))) {
      await writeArtifact(
        runtime,
        acceptanceResultsId,
        `# Acceptance Results\n\n## Summary\n${implementation.summary}\n\n## Status\nPASS\n`,
      );
    }
    if (!(await repo.exists(stageSummaryId))) {
      await writeArtifact(
        runtime,
        stageSummaryId,
        `### Status — PASS\n\n# Stage 8 Summary\n\n${implementation.summary}\n`,
      );
    }
  }

  const stageSummaryId: ArtifactId = { kind: "phaseFile", phase, name: "stage8-summary.md" };
  const existingStageSummary = (await repo.read(stageSummaryId)) ?? "None.";
  if (!/^### Status\s+[—-]/m.test(existingStageSummary)) {
    await writeArtifact(
      runtime,
      stageSummaryId,
      implementation.status === "PASS" && existingStageSummary !== "None."
        ? `### Status — PASS\n\n${existingStageSummary}`
        : `### Status — ${implementation.status}\n\n# Stage 8 Summary\n\n${implementation.summary}\n`,
    );
  }

  const phaseLabel = `phase-${String(phase).padStart(2, "0")}`;
  return {
    ...implementation,
    filesWritten: [`phases/${phaseLabel}/coverage-plan.md`, ...reviewArtifacts, ...implementation.filesWritten],
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
  const repo = runtime.services.artifactRepo;
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
      (await repo.read({ kind: "phaseFile", phase: options.phase, name: "integration-results.md" })) ?? "None.",
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
    ]
      .filter(Boolean)
      .join("\n"),
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
      cwd: runtime.workspaceRoot,
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

function requireVersionControl(runtime: StageRuntime): VersionControl {
  if (!runtime.services.versionControl) {
    throw new Error("VersionControl port is not wired; ensure the composition root initialises it.");
  }
  return runtime.services.versionControl;
}

async function workspaceFiles(runtime: StageRuntime): Promise<Set<string>> {
  const files = await requireVersionControl(runtime).changedFiles(
    runtime.workspaceRoot,
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
