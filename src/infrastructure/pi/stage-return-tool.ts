// PiStageReturnTool — re-exports from return-contract.ts for the new module layout.

export {
  createStageReturnTool,
  normalizeStageReturn,
  structuredToOutcome,
  backwardLoopSchema,
  stageReturnSchema,
} from "../../return-contract.js";
export type { StageReturnPayload } from "../../return-contract.js";
