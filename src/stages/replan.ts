import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { parseMarkdownSections } from "../markdown.js";
import type { BackwardLoopClassification, StageModule, StageOutcome, StageRuntime } from "../types.js";
import { dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

export const replanStage: StageModule = {
  stage: "replan",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const phase = runtime.state.currentPhase;
    const phaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`);
    const nextPhase = phase + 1;
    const nextPhaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(nextPhase).padStart(2, "0")}`);

    let reviewRound = 1;
    while (reviewRound <= 3) {
      const writer = await dispatchLeaf(
        runtime,
        "qrspi-replan-writer",
        [
          "=== GOALS ===",
          await readArtifact(runtime.artifacts.goalsFile),
          "",
          "=== DESIGN ===",
          runtime.state.route === "full" ? await readArtifact(runtime.artifacts.designFile) : "N/A",
          "",
          "=== STRUCTURE ===",
          runtime.state.route === "full" ? await readArtifact(runtime.artifacts.structureFile) : "N/A",
          "",
          "=== CURRENT PLAN ===",
          await readArtifact(runtime.artifacts.planFile),
          "",
          "=== CURRENT PHASE MANIFEST ===",
          await readArtifact(runtime.artifacts.phaseManifestFile),
          "",
          "=== EXECUTION MANIFEST ===",
          await safeRead(path.join(phaseDir, "execution-manifest.md")),
          "",
          "=== INTEGRATION RESULTS ===",
          await safeRead(path.join(phaseDir, "integration-results.md")),
          "",
          "=== ACCEPTANCE RESULTS ===",
          await safeRead(path.join(phaseDir, "acceptance-results.md")),
          "",
          "=== STAGE 7 SUMMARY ===",
          await safeRead(path.join(phaseDir, "stage7-summary.md")),
          "",
          "=== STAGE 8 SUMMARY ===",
          await safeRead(path.join(phaseDir, "stage8-summary.md")),
          "",
          "=== COMPLETED PHASE TASK SPECS ===",
          await readPhaseTaskSpecs(phaseDir),
          "",
          "=== CURRENT REMAINING TASK SPECS ===",
          await readRemainingTaskSpecs(runtime),
          "",
          "=== COMPLETED PHASE ===",
          String(phase),
          "",
          "=== DEFERRED REPLAN FEEDBACK ===",
          await safeRead(path.join(runtime.artifacts.feedbackDir, `deferred-replan-${String(phase).padStart(2, "0")}.md`)),
        ].join("\n"),
      );

      const sections = parseMarkdownSections(writer.text);
      const backwardLoopRequest = sections["Backward Loop Request"];
      if (backwardLoopRequest) {
        const affected = backwardLoopRequest.match(/Affected Upstream Stage:\s*(Goals|Design)/i)?.[1]?.toUpperCase();
        const classification: BackwardLoopClassification = affected === "GOALS" ? "LOOP_GOALS" : "LOOP_DESIGN";
        return {
          status: "FAIL",
          filesWritten: [],
          summary: "Replan detected that upstream artifacts must change.",
          backwardLoop: {
            classification,
            summary: sections.Rationale ?? backwardLoopRequest,
            guidance: backwardLoopRequest,
          },
        };
      }

      await writeReplanArtifacts(runtime, phase, nextPhaseDir, sections);

      const changedTaskSpecs = await readRemainingTaskSpecs(runtime);
      const review = await dispatchLeaf(
        runtime,
        "qrspi-replan-reviewer",
        [
          "=== GOALS ===",
          await readArtifact(runtime.artifacts.goalsFile),
          "",
          "=== DESIGN ===",
          runtime.state.route === "full" ? await readArtifact(runtime.artifacts.designFile) : "N/A",
          "",
          "=== STRUCTURE ===",
          runtime.state.route === "full" ? await readArtifact(runtime.artifacts.structureFile) : "N/A",
          "",
          "=== PLAN ===",
          await readArtifact(runtime.artifacts.planFile),
          "",
          "=== PHASE MANIFEST ===",
          await readArtifact(runtime.artifacts.phaseManifestFile),
          "",
          "=== CHANGED TASK SPECS ===",
          changedTaskSpecs,
          "",
          "=== EXECUTION MANIFEST ===",
          await safeRead(path.join(phaseDir, "execution-manifest.md")),
          "",
          "=== ACCEPTANCE RESULTS ===",
          await safeRead(path.join(phaseDir, "acceptance-results.md")),
          "",
          "=== COMPLETED PHASE ===",
          String(phase),
          "",
          "=== REPLAN NOTE ===",
          await safeRead(path.join(phaseDir, "replan", `phase-${String(phase).padStart(2, "0")}-replan.md`)),
        ].join("\n"),
      );

      const reviewFile = path.join(runtime.artifacts.reviewsDir, `replan-review-round-${String(reviewRound).padStart(2, "0")}.md`);
      await writeArtifact(reviewFile, review.text);

      if (parseReviewStatus(review.text) === "PASS") {
        return {
          status: "PASS",
          phase,
          filesWritten: [
            "plan.md",
            "phase-manifest.md",
            path.relative(runtime.artifacts.runDir, reviewFile),
          ],
          summary: "Remaining work was replanned for the next phase.",
          telemetry: {
            review_rounds: reviewRound,
            terminal_review_state: "clean",
          },
        };
      }

      if (reviewRound === 3) {
        return {
          status: "FAIL",
          phase,
          filesWritten: [path.relative(runtime.artifacts.runDir, reviewFile)],
          summary: "Replan review loop reached the unresolved review cap.",
          telemetry: {
            review_rounds: reviewRound,
            terminal_review_state: "unclean-cap",
          },
        };
      }

      reviewRound += 1;
    }

    return {
      status: "FAIL",
      phase,
      filesWritten: [],
      summary: "Replan review did not converge.",
      telemetry: {
        review_rounds: 3,
        terminal_review_state: "unclean-cap",
      },
    };
  },
};

async function writeReplanArtifacts(runtime: StageRuntime, phase: number, nextPhaseDir: string, sections: Record<string, string>) {
  await writeArtifact(runtime.artifacts.planFile, sections["plan.md"] ?? await readArtifact(runtime.artifacts.planFile));
  await writeArtifact(
    runtime.artifacts.phaseManifestFile,
    sections["phase-manifest.md"] ?? await readArtifact(runtime.artifacts.phaseManifestFile),
  );

  await mkdir(path.join(nextPhaseDir, "tasks"), { recursive: true });
  for (const [heading, content] of Object.entries(sections)) {
    if (!/^task-\d+\.md$/i.test(heading)) {
      continue;
    }
    await writeArtifact(path.join(nextPhaseDir, "tasks", heading), content);
  }

  const replanDir = path.join(runtime.artifacts.phasesDir, `phase-${String(phase).padStart(2, "0")}`, "replan");
  await mkdir(replanDir, { recursive: true });
  if (sections["Replan Note"]) {
    await writeArtifact(path.join(replanDir, `phase-${String(phase).padStart(2, "0")}-replan.md`), sections["Replan Note"]);
  }
}

async function readPhaseTaskSpecs(phaseDir: string): Promise<string> {
  try {
    const taskDir = path.join(phaseDir, "tasks");
    const files = (await readdir(taskDir)).filter((entry) => /^task-\d+\.md$/i.test(entry)).sort();
    const contents = await Promise.all(files.map((file) => readArtifact(path.join(taskDir, file))));
    return contents.join("\n\n");
  } catch {
    return "None.";
  }
}

async function readRemainingTaskSpecs(runtime: StageRuntime): Promise<string> {
  const nextPhaseDir = path.join(runtime.artifacts.phasesDir, `phase-${String(runtime.state.currentPhase + 1).padStart(2, "0")}`, "tasks");
  try {
    const files = (await readdir(nextPhaseDir)).filter((entry) => /^task-\d+\.md$/i.test(entry)).sort();
    const contents = await Promise.all(files.map((file) => readArtifact(path.join(nextPhaseDir, file))));
    return contents.join("\n\n");
  } catch {
    return "None.";
  }
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readArtifact(filePath);
  } catch {
    return "None.";
  }
}
