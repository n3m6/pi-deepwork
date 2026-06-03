// Stage barrel — re-exports all stage modules during migration.
// Once src/stages/*.ts are deleted, this file will contain the actual implementations.

export { goalsStage } from "../../stages/goals.js";
export { runQuestionsSubstage } from "../../stages/questions.js";
export { researchStage } from "../../stages/research.js";
export { designStage } from "../../stages/design.js";
export { structureStage } from "../../stages/structure.js";
export { planStage } from "../../stages/plan.js";
export { implementStage } from "../../stages/implement.js";
export { acceptStage } from "../../stages/accept.js";
export { replanStage } from "../../stages/replan.js";
export { verifyStage } from "../../stages/verify.js";
export { reportStage } from "../../stages/report.js";
