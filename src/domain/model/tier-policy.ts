// Pure domain tier policy — no node:* or pi imports allowed.

import type { ModelTier } from "../value/index.js";

/**
 * Maps each leaf agent name to its model tier.
 *
 * architect — frontier synthesis work whose artifacts cascade downstream.
 * coding    — the generic agentic coder that writes/tests/verifies code.
 * review    — adversarial read-only critique; high fan-out per task.
 * utility   — cheap mechanical work: extraction, search, formatting.
 */
export const AGENT_TIERS: Record<string, ModelTier> = {
  // --- architect -----------------------------------------------------------
  "qrspi-goals-synthesizer": "architect",
  "qrspi-goals-interviewer": "architect",
  "qrspi-research-synthesizer": "architect",
  "qrspi-design-synthesizer": "architect",
  "qrspi-structure-mapper": "architect",
  "qrspi-plan-writer": "architect",
  "qrspi-task-spec-writer": "architect",
  "qrspi-replan-writer": "architect",

  // --- review --------------------------------------------------------------
  "qrspi-goals-reviewer": "review",
  "qrspi-research-reviewer": "review",
  "qrspi-design-reviewer": "review",
  "qrspi-structure-reviewer": "review",
  "qrspi-plan-reviewer": "review",
  "qrspi-task-spec-reviewer": "review",
  "qrspi-replan-reviewer": "review",
  "qrspi-review-security": "review",
  "qrspi-review-silent-failure": "review",
  "qrspi-review-code-quality": "review",
  "qrspi-review-code-simplifier": "review",
  "qrspi-review-test-quality": "review",
  "qrspi-review-test-coverage": "review",
  "qrspi-review-goal-traceability": "review",
  "qrspi-review-accept-spec": "review",
  "qrspi-review-accept-code-quality": "review",
  "qrspi-review-accept-goal-traceability": "review",
  "qrspi-integration-checker": "review",
  "qrspi-backward-loop-detector": "review",
  "qrspi-verifier": "review",

  // --- utility -------------------------------------------------------------
  "qrspi-question-generator": "utility",
  "qrspi-question-leakage-reviewer": "utility",
  "qrspi-question-quality-reviewer": "utility",
  "qrspi-codebase-researcher": "utility",
  "qrspi-web-researcher": "utility",
  "qrspi-coverage-planner": "utility",
  "qrspi-baseline-checker": "utility",
  "qrspi-reporter": "utility",
};

/**
 * Returns the tier for a named leaf agent.
 * Unknown names (e.g. future agents not yet in the map) fall back to "utility"
 * so they use the cheapest model rather than silently consuming a more expensive one.
 */
export function tierForAgentName(name: string): ModelTier {
  return AGENT_TIERS[name] ?? "utility";
}
