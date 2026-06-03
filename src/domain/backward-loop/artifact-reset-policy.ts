// Artifact reset policy — maps backward loop classification to a target stage.
// No node:* or pi imports.

import type { BackwardLoopClassification, StageName } from "../value/index.js";

export function backwardLoopTarget(classification: BackwardLoopClassification): StageName {
  switch (classification) {
    case "LOOP_GOALS":
      return "goals";
    case "LOOP_DESIGN":
      return "design";
    case "LOOP_STRUCTURE":
      return "structure";
    case "LOOP_PLAN":
    case "NO_LOOP":
    default:
      return "plan";
    case "DEFER_REPLAN":
      return "replan";
  }
}
