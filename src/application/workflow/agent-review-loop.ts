/**
 * AgentReviewLoop — shared primitive for write → review → rewrite cycles.
 *
 * Caller provides the review step (and optionally the rewrite-on-fail step)
 * as callbacks; this module handles round counting, review-file persistence,
 * and status aggregation.
 */

import { parseReviewStatus, subStageContext, writeArtifact, artifactRelPath } from "../stage/utils.js";
import type { ArtifactId, StageRuntime } from "../port/index.js";

export interface AgentReviewLoopResult {
  status: "PASS" | "FAIL";
  reviewRounds: number;
  filesWritten: string[];
  /** Set when a dispatcher returned a session error rather than review content. */
  dispatchFailure?: true;
  /** Error message from a dispatch failure, or undefined for normal cap-hit FAILs. */
  summary?: string;
}

export interface AgentReviewLoopConfig {
  maxRounds: number;
  /**
   * Name prefix for review artifact files (e.g. "goals" → "goals-review-round-01.md").
   * The full name follows the convention `{stageName}-review-round-NN.md`.
   */
  stageName: string;
  /**
   * Run one review round. Return `{ text }` with the reviewer's output, or
   * `{ failure }` with an error summary if the dispatcher returned a session error.
   */
  runReview: (round: number) => Promise<{ text: string } | { failure: string }>;
  /**
   * Called when the reviewer returns FAIL and there are remaining rounds.
   * Should rewrite the artifact being reviewed (e.g. re-synthesize with feedback).
   * Return `{ failure }` to abort the loop early with a dispatch failure.
   */
  onFail?: (reviewText: string, round: number) => Promise<void | { failure: string }>;
}

export async function runAgentReviewLoop(
  runtime: StageRuntime,
  config: AgentReviewLoopConfig,
): Promise<AgentReviewLoopResult> {
  const filesWritten: string[] = [];
  const ctx = subStageContext(runtime);
  const stage = ctx.stage ?? (config.stageName as import("../port/index.js").StageName);

  for (let round = 1; round <= config.maxRounds; round++) {
    await runtime.services.telemetrySink.record({
      type: "review.round.started",
      stage,
      phase: ctx.phase,
      route: ctx.route,
      reviewRound: round,
      maxRounds: config.maxRounds,
    });

    const reviewResult = await config.runReview(round);

    if ("failure" in reviewResult) {
      await runtime.services.telemetrySink.record({
        type: "review.round.completed",
        stage,
        phase: ctx.phase,
        route: ctx.route,
        reviewRound: round,
        maxRounds: config.maxRounds,
        status: "FAIL",
      });
      return {
        status: "FAIL",
        reviewRounds: round,
        filesWritten,
        dispatchFailure: true,
        summary: reviewResult.failure,
      };
    }

    const reviewId: ArtifactId = {
      kind: "reviewFile",
      name: `${config.stageName}-review-round-${String(round).padStart(2, "0")}.md`,
    };
    await writeArtifact(runtime, reviewId, reviewResult.text);
    filesWritten.push(artifactRelPath(runtime, reviewId));

    const roundStatus = parseReviewStatus(reviewResult.text) === "PASS" ? "PASS" : "FAIL";
    await runtime.services.telemetrySink.record({
      type: "review.round.completed",
      stage,
      phase: ctx.phase,
      route: ctx.route,
      reviewRound: round,
      maxRounds: config.maxRounds,
      status: roundStatus,
    });

    if (roundStatus === "PASS") {
      return { status: "PASS", reviewRounds: round, filesWritten };
    }

    if (round === config.maxRounds) {
      return { status: "FAIL", reviewRounds: round, filesWritten };
    }

    if (config.onFail) {
      const failResult = await config.onFail(reviewResult.text, round);
      if (failResult && "failure" in failResult) {
        return {
          status: "FAIL",
          reviewRounds: round,
          filesWritten,
          dispatchFailure: true,
          summary: failResult.failure,
        };
      }
    }
  }

  return { status: "FAIL", reviewRounds: config.maxRounds, filesWritten };
}
