import type { ExecutableRoute } from "./state";

export const STAGE_NAMES: ReadonlyArray<string> = [
  "goals",
  "research",
  "design",
  "structure",
  "plan",
  "implement",
  "accept",
  "replan",
  "verify",
  "report",
];

export const QUICK_FIX_STAGE_NAMES: ReadonlyArray<string> = [
  "goals",
  "research",
  "plan",
  "implement",
  "accept",
  "verify",
  "report",
];

export function getRouteStages(route: ExecutableRoute): ReadonlyArray<string> {
  return route === "quick-fix" ? QUICK_FIX_STAGE_NAMES : STAGE_NAMES;
}

export function stageNumber(name: string): number {
  const lower = name.toLowerCase();
  const idx = STAGE_NAMES.findIndex((s) => s === lower);
  return idx === -1 ? 0 : idx + 1;
}

export function nextStage(
  currentStage: string,
  route: ExecutableRoute,
): string | null {
  const lower = currentStage.toLowerCase();
  const stageOrder = getRouteStages(route);
  const idx = stageOrder.findIndex((s) => s === lower);
  if (idx === -1) return null;

  if (idx >= stageOrder.length - 1) return null;
  return stageOrder[idx + 1]!;
}
