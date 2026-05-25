import type {
  ExecutableRoute,
  FailurePolicy,
  InteractionMode,
} from "../domain/pipeline";

export function parseDryRunArg(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" ||
      normalized === "1" ||
      normalized === "yes" ||
      normalized === "on"
    );
  }

  return false;
}

export function parseRouteArg(value: unknown): ExecutableRoute | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "full" || normalized === "quick-fix") {
    return normalized;
  }

  return null;
}

export function parseInteractionModeArg(
  value: unknown,
): InteractionMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "interactive" || normalized === "automated") {
    return normalized;
  }

  return null;
}

export function parseFailurePolicyArg(value: unknown): FailurePolicy | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "fail-closed" || normalized === "best-effort") {
    return normalized;
  }

  return null;
}
