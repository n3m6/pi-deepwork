import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createAskHumanTool,
  DefaultGateManager,
  determineInteractionMode,
  parseExplicitRunOptions,
} from "../../src/infrastructure/pi/human-gate.js";
import { createGoalsReturnTool } from "../../src/infrastructure/pi/stage-return-tool.js";

test("parseExplicitRunOptions reads mode failure and run-id flags", () => {
  const options = parseExplicitRunOptions("resume run-id:qrspi-20260601-123456 mode:automated failure:best-effort");
  assert.equal(options.mode, "automated");
  assert.equal(options.failurePolicy, "best-effort");
  assert.equal(options.resumeRunId, "qrspi-20260601-123456");
});

test("determineInteractionMode defaults to automated without UI", () => {
  const result = determineInteractionMode({ hasUI: false } as never, "ship it");
  assert.equal(result.interactionMode, "automated");
  assert.equal(result.failurePolicy, "best-effort");
});

test("ask_human returns no answer when the gate manager cannot prompt", async () => {
  const tool = createAskHumanTool({
    interactionMode: "automated",
    failurePolicy: "best-effort",
    async askText() {
      return undefined;
    },
    async choose() {
      return undefined;
    },
    async confirm() {
      return false;
    },
    createAskHumanTool() {
      return createAskHumanTool(this);
    },
    createGoalsReturnTool() {
      return createGoalsReturnTool();
    },
  });

  const result = await tool.execute(
    "tool-1",
    {
      title: "Clarify",
      question: "What should happen?",
    },
    undefined,
    undefined,
    {} as never,
  );

  assert.deepEqual(result.details, {});
});

test("DefaultGateManager choose falls back to confirm when select is unavailable", async () => {
  const ctx = {
    hasUI: true,
    ui: {
      confirm: async (_title: string, message: string) => message.includes("first"),
      input: async () => undefined,
    },
  } as never;
  const gates = new DefaultGateManager(ctx, {
    interactionMode: "interactive",
    failurePolicy: "fail-closed",
  });

  const choice = await gates.choose("Pick", [
    { value: "first", label: "first option" },
    { value: "second", label: "second option" },
  ]);

  assert.equal(choice?.value, "first");
});
