// Fix-routing policy — determines whether a failing stage should loop back.
// No node:* or pi imports.

import type { StageOutcome } from "../value/index.js";

export function isImplementationRepairableAcceptFailure(outcome: StageOutcome): boolean {
  return outcome.telemetry?.terminal_review_state !== "unclean-cap" && outcome.telemetry?.boundary_violation !== true;
}
