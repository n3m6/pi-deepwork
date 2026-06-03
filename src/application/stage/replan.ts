import { parseMarkdownSections } from "../../infrastructure/codec/markdown-codec.js";
import type { ArtifactId, BackwardLoopClassification, StageModule, StageOutcome, StageRuntime } from "../port/index.js";
import { artifactRelPath, dispatchLeaf, parseReviewStatus, readArtifact, writeArtifact } from "./utils.js";

export const replanStage: StageModule = {
  stage: "replan",
  async run(runtime: StageRuntime): Promise<StageOutcome> {
    const phase = runtime.state.currentPhase;
    const nextPhase = phase + 1;
    const repo = runtime.services.artifactRepo!;

    let reviewRound = 1;
    while (reviewRound <= 3) {
      const writer = await dispatchLeaf(
        runtime,
        "qrspi-replan-writer",
        [
          "=== GOALS ===",
          await readArtifact(runtime, { kind: "goals" }),
          "",
          "=== DESIGN ===",
          runtime.state.route === "full" ? await readArtifact(runtime, { kind: "design" }) : "N/A",
          "",
          "=== STRUCTURE ===",
          runtime.state.route === "full" ? await readArtifact(runtime, { kind: "structure" }) : "N/A",
          "",
          "=== CURRENT PLAN ===",
          await readArtifact(runtime, { kind: "plan" }),
          "",
          "=== CURRENT PHASE MANIFEST ===",
          await readArtifact(runtime, { kind: "phaseManifest" }),
          "",
          "=== EXECUTION MANIFEST ===",
          (await repo.read({ kind: "phaseFile", phase, name: "execution-manifest.md" })) ?? "None.",
          "",
          "=== INTEGRATION RESULTS ===",
          (await repo.read({ kind: "phaseFile", phase, name: "integration-results.md" })) ?? "None.",
          "",
          "=== ACCEPTANCE RESULTS ===",
          (await repo.read({ kind: "phaseFile", phase, name: "acceptance-results.md" })) ?? "None.",
          "",
          "=== STAGE 7 SUMMARY ===",
          (await repo.read({ kind: "phaseFile", phase, name: "stage7-summary.md" })) ?? "None.",
          "",
          "=== STAGE 8 SUMMARY ===",
          (await repo.read({ kind: "phaseFile", phase, name: "stage8-summary.md" })) ?? "None.",
          "",
          "=== COMPLETED PHASE TASK SPECS ===",
          await readPhaseTaskSpecs(runtime, phase),
          "",
          "=== CURRENT REMAINING TASK SPECS ===",
          await readRemainingTaskSpecs(runtime, nextPhase),
          "",
          "=== COMPLETED PHASE ===",
          String(phase),
          "",
          "=== DEFERRED REPLAN FEEDBACK ===",
          (await repo.read({ kind: "feedbackFile", name: `deferred-replan-${String(phase).padStart(2, "0")}.md` })) ?? "None.",
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

      await writeReplanArtifacts(runtime, phase, nextPhase, sections);

      const changedTaskSpecs = await readRemainingTaskSpecs(runtime, nextPhase);
      const review = await dispatchLeaf(
        runtime,
        "qrspi-replan-reviewer",
        [
          "=== GOALS ===",
          await readArtifact(runtime, { kind: "goals" }),
          "",
          "=== DESIGN ===",
          runtime.state.route === "full" ? await readArtifact(runtime, { kind: "design" }) : "N/A",
          "",
          "=== STRUCTURE ===",
          runtime.state.route === "full" ? await readArtifact(runtime, { kind: "structure" }) : "N/A",
          "",
          "=== PLAN ===",
          await readArtifact(runtime, { kind: "plan" }),
          "",
          "=== PHASE MANIFEST ===",
          await readArtifact(runtime, { kind: "phaseManifest" }),
          "",
          "=== CHANGED TASK SPECS ===",
          changedTaskSpecs,
          "",
          "=== EXECUTION MANIFEST ===",
          (await repo.read({ kind: "phaseFile", phase, name: "execution-manifest.md" })) ?? "None.",
          "",
          "=== ACCEPTANCE RESULTS ===",
          (await repo.read({ kind: "phaseFile", phase, name: "acceptance-results.md" })) ?? "None.",
          "",
          "=== COMPLETED PHASE ===",
          String(phase),
          "",
          "=== REPLAN NOTE ===",
          (await repo.read({ kind: "phaseFile", phase, name: `replan/phase-${String(phase).padStart(2, "0")}-replan.md` })) ?? "None.",
        ].join("\n"),
      );

      const reviewId: ArtifactId = { kind: "reviewFile", name: `replan-review-round-${String(reviewRound).padStart(2, "0")}.md` };
      await writeArtifact(runtime, reviewId, review.text);

      if (parseReviewStatus(review.text) === "PASS") {
        return {
          status: "PASS",
          phase,
          filesWritten: [
            "plan.md",
            "phase-manifest.md",
            artifactRelPath(runtime, reviewId),
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
          filesWritten: [artifactRelPath(runtime, reviewId)],
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

async function writeReplanArtifacts(runtime: StageRuntime, phase: number, nextPhase: number, sections: Record<string, string>) {
  const repo = runtime.services.artifactRepo!;
  await writeArtifact(runtime, { kind: "plan" }, sections["plan.md"] ?? await readArtifact(runtime, { kind: "plan" }));
  await writeArtifact(
    runtime,
    { kind: "phaseManifest" },
    sections["phase-manifest.md"] ?? await readArtifact(runtime, { kind: "phaseManifest" }),
  );

  for (const [heading, content] of Object.entries(sections)) {
    if (!/^task-\d+\.md$/i.test(heading)) {
      continue;
    }
    const taskId = heading.match(/^task-(\d+)\.md$/i)?.[1];
    if (!taskId) continue;
    await repo.write({ kind: "taskSpec", phase: nextPhase, taskId }, content);
  }

  const phasePad = String(phase).padStart(2, "0");
  if (sections["Replan Note"]) {
    await repo.write({ kind: "phaseFile", phase, name: `replan/phase-${phasePad}-replan.md` }, sections["Replan Note"]);
  }
}

async function readPhaseTaskSpecs(runtime: StageRuntime, phase: number): Promise<string> {
  try {
    const repo = runtime.services.artifactRepo!;
    const ids = await repo.listTaskSpecs(phase);
    const contents = await Promise.all(ids.map((id) => repo.read(id)));
    return contents.filter(Boolean).join("\n\n") || "None.";
  } catch {
    return "None.";
  }
}

async function readRemainingTaskSpecs(runtime: StageRuntime, nextPhase: number): Promise<string> {
  try {
    const repo = runtime.services.artifactRepo!;
    const ids = await repo.listTaskSpecs(nextPhase);
    const contents = await Promise.all(ids.map((id) => repo.read(id)));
    return contents.filter(Boolean).join("\n\n") || "None.";
  } catch {
    return "None.";
  }
}
