import type {
  RuntimeHandoffPort,
  RuntimeHandoffResult,
} from "../../ports/runtime-handoff";
import type { ExtensionAPI } from "../../types/pi-extensions";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handoffToSession(
  pi: ExtensionAPI,
  prompt: string,
): Promise<RuntimeHandoffResult> {
  try {
    await Promise.resolve(pi.sendUserMessage(prompt));
    return { delivered: true };
  } catch (error: unknown) {
    return { delivered: false, error: describeError(error) };
  }
}

export function createPiRuntimeHandoff(pi: ExtensionAPI): RuntimeHandoffPort {
  return {
    handoffToSession: (prompt) => handoffToSession(pi, prompt),
  };
}
