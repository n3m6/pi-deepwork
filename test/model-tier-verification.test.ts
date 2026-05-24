import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { createDispatchTool, setPi } from "../src/shared-tools";
import type { ExtensionContext } from "../src/types/pi-extensions";

const projectRoot = process.cwd();
const agentsDir = path.join(projectRoot, "agents");
const managerSymbol = Symbol.for("pi-subagents:manager");

const sonnetLowAgents = [
  "qrspi-goals-synthesizer.md",
  "qrspi-goals.md",
  "qrspi-research-pass.md",
  "qrspi-questions.md",
  "qrspi-research-synthesizer.md",
  "qrspi-research.md",
  "qrspi-design-synthesizer.md",
  "qrspi-design.md",
  "qrspi-structure-mapper.md",
  "qrspi-structure.md",
  "qrspi-plan-writer.md",
  "qrspi-plan.md",
  "qrspi-task-spec-writer.md",
  "qrspi-implement.md",
  "qrspi-accept.md",
  "qrspi-replan.md",
  "qrspi-verify.md",
  "qrspi-report.md",
] as const;

const sonnetMediumAgents = [
  "qrspi-fast-impl-code.md",
  "qrspi-fast-impl-test.md",
  "qrspi-acceptance-tester.md",
  "qrspi-fast-impl-loop.md",
  "qrspi-fast-impl-verify.md",
  "qrspi-verifier.md",
] as const;

const haikuLowAgents = [
  "qrspi-replan-writer.md",
  "qrspi-reporter.md",
  "qrspi-goals-reviewer.md",
  "qrspi-question-leakage-reviewer.md",
  "qrspi-question-quality-reviewer.md",
  "qrspi-research-reviewer.md",
  "qrspi-design-reviewer.md",
  "qrspi-structure-reviewer.md",
  "qrspi-plan-reviewer.md",
  "qrspi-task-spec-reviewer.md",
  "qrspi-replan-reviewer.md",
  "qrspi-review-code-quality.md",
  "qrspi-review-security.md",
  "qrspi-review-silent-failure.md",
  "qrspi-review-accept-goal-traceability.md",
  "qrspi-review-accept-spec.md",
  "qrspi-codebase-researcher.md",
  "qrspi-web-researcher.md",
  "qrspi-question-generator.md",
  "qrspi-coverage-planner.md",
  "qrspi-code-review.md",
  "qrspi-review-test-coverage.md",
  "qrspi-review-test-quality.md",
  "qrspi-review-code-simplifier.md",
  "qrspi-baseline-checker.md",
  "qrspi-baseline-regression-checker.md",
  "qrspi-e2e-regression-checker.md",
  "qrspi-integration-checker.md",
  "qrspi-review-accept-code-quality.md",
  "qrspi-review-goal-traceability.md",
  "qrspi-backward-loop-detector.md",
] as const;

const expectedFiles = new Set([
  ...sonnetLowAgents,
  ...sonnetMediumAgents,
  ...haikuLowAgents,
]);

function parseFrontmatter(filePath: string): Record<string, string> {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `expected YAML frontmatter in ${path.basename(filePath)}`);

  const frontmatter = match[1]!;
  const result: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }

    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function makeCtx(): ExtensionContext {
  return {
    hasUI: false,
    ui: {
      confirm: async () => true,
      select: async () => undefined,
    },
    cwd: projectRoot,
    sessionManager: {},
    modelRegistry: {},
    model: "test-model",
    signal: new AbortController().signal,
    abort: () => {},
    shutdown: () => {},
  } as ExtensionContext;
}

test("agents directory contains exactly the expected 55 agent files", () => {
  const files = fs.readdirSync(agentsDir).filter((name) => name.endsWith(".md")).sort();

  assert.equal(files.length, 55);
  assert.equal(expectedFiles.size, 55);
  assert.deepEqual(new Set(files), expectedFiles);
});

test("every agent frontmatter has model and thinking fields", () => {
  for (const file of expectedFiles) {
    const parsed = parseFrontmatter(path.join(agentsDir, file));
    assert.ok(parsed.model, `${file} is missing model`);
    assert.ok(parsed.thinking, `${file} is missing thinking`);
  }
});

test("all sonnet low agents use sonnet-tier with low thinking", () => {
  for (const file of sonnetLowAgents) {
    const parsed = parseFrontmatter(path.join(agentsDir, file));
    assert.equal(parsed.model, "anthropic/claude-sonnet-4-5", `${file} model mismatch`);
    assert.equal(parsed.thinking, "low", `${file} thinking mismatch`);
  }
});

test("all sonnet medium agents use sonnet-tier with medium thinking", () => {
  for (const file of sonnetMediumAgents) {
    const parsed = parseFrontmatter(path.join(agentsDir, file));
    assert.equal(parsed.model, "anthropic/claude-sonnet-4-5", `${file} model mismatch`);
    assert.equal(parsed.thinking, "medium", `${file} thinking mismatch`);
  }
});

test("all haiku agents use haiku-tier with low thinking", () => {
  for (const file of haikuLowAgents) {
    const parsed = parseFrontmatter(path.join(agentsDir, file));
    assert.equal(parsed.model, "anthropic/claude-haiku-4-5", `${file} model mismatch`);
    assert.equal(parsed.thinking, "low", `${file} thinking mismatch`);
  }
});

test("no agent uses an unexpected model or thinking value", () => {
  const allowedModels = new Set([
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-haiku-4-5",
  ]);
  const allowedThinking = new Set(["low", "medium"]);

  for (const file of expectedFiles) {
    const parsed = parseFrontmatter(path.join(agentsDir, file));
    const model = parsed.model ?? "";
    const thinking = parsed.thinking ?? "";

    assert.ok(allowedModels.has(model), `${file} has unexpected model ${model}`);
    assert.ok(allowedThinking.has(thinking), `${file} has unexpected thinking ${thinking}`);
  }
});

test("qrspi_dispatch returns a clear prerequisite message when pi-subagents is unavailable", async () => {
  const previousManager = Reflect.get(globalThis, managerSymbol);
  Reflect.deleteProperty(globalThis, managerSymbol);
  setPi({} as never);

  try {
    const tool = createDispatchTool();
    const result = await tool.execute(
      "call-1",
      {
        subagent_type: "qrspi-goals",
        prompt: "Do a thing",
        description: "fallback test",
      },
      new AbortController().signal,
      () => {},
      makeCtx()
    );

    assert.match(result.content, /pi-subagents/i);
    assert.match(result.content, /install/i);
  } finally {
    setPi(null);
    if (previousManager === undefined) {
      Reflect.deleteProperty(globalThis, managerSymbol);
    } else {
      Reflect.set(globalThis, managerSymbol, previousManager);
    }
  }
});