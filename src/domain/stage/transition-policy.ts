// Pure stage transition policy — no side effects.
// No node:* or pi imports.

import type { NextStage, Route, StageName, VerifyStatus } from "../value/index.js";

export interface NextStageContext {
  route: Route;
  currentPhase: number;
  totalPhases: number;
  verifyStatus?: VerifyStatus;
}

export function nextStageFor(stage: StageName, context: NextStageContext): NextStage {
  switch (stage) {
    case "goals":
      return "research";
    case "research":
      return context.route === "quick-fix" ? "plan" : "design";
    case "design":
      return "structure";
    case "structure":
      return "plan";
    case "plan":
      return "implement";
    case "implement":
      return "accept";
    case "accept":
      return context.route === "quick-fix" || context.currentPhase >= Math.max(context.totalPhases, 1)
        ? "verify"
        : "replan";
    case "replan":
      return "implement";
    case "verify":
      return context.verifyStatus === "PASS" ? "report" : "implement";
    case "report":
      return "done";
  }
}
