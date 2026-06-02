import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { runResearchPassSubstage } from "../src/stages/research-pass.js";
import type { DispatchRequest, DispatchResult, Dispatcher, RunArtifacts } from "../src/types.js";
import { TestHarness } from "./support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

test("researchers receive the full question contract and pipeline exclusions", async () => {
  const harness = await TestHarness.create();
  harnesses.push(harness);
  const dispatcher = new RecordingResearchDispatcher(harness.artifacts);
  const questionsMarkdown = renderQuestionsMarkdown();
  await writeFile(harness.artifacts.researchQuestionsFile, questionsMarkdown, "utf8");

  const result = await runResearchPassSubstage(
    {
      ...harness.runtime(),
      services: {
        ...harness.services,
        dispatcher,
      },
    },
    questionsMarkdown,
  );

  assert.equal(result.status, "PASS");
  assert.equal(dispatcher.codebasePrompts.length, 1);
  assert.match(dispatcher.codebasePrompts[0] ?? "", /\*\*Answer shape\*\*: A bounded inventory/);
  assert.match(dispatcher.codebasePrompts[0] ?? "", /Treat `\.pipeline\/`, `\.git\/`, `node_modules\/`/);
});

test("failed research review reruns named question artifacts before summary revision", async () => {
  const harness = await TestHarness.create();
  harnesses.push(harness);
  const dispatcher = new RecordingResearchDispatcher(harness.artifacts, { failFirstReview: true });
  const questionsMarkdown = renderQuestionsMarkdown();
  await writeFile(harness.artifacts.researchQuestionsFile, questionsMarkdown, "utf8");

  const result = await runResearchPassSubstage(
    {
      ...harness.runtime(),
      services: {
        ...harness.services,
        dispatcher,
      },
    },
    questionsMarkdown,
  );

  assert.equal(result.status, "PASS");
  assert.equal(dispatcher.codebasePrompts.length, 2);
  assert.match(dispatcher.codebasePrompts[1] ?? "", /=== REVIEW FEEDBACK ===/);
  assert.deepEqual(dispatcher.summaryRevisionTools, ["read", "bash", "grep", "find", "ls", "write", "edit"]);
});

test("summary-only research review failures do not rerun passing question artifacts", async () => {
  const harness = await TestHarness.create();
  harnesses.push(harness);
  const dispatcher = new RecordingResearchDispatcher(harness.artifacts, { failFirstReviewSummaryOnly: true });
  const questionsMarkdown = renderQuestionsMarkdown();
  await writeFile(harness.artifacts.researchQuestionsFile, questionsMarkdown, "utf8");

  const result = await runResearchPassSubstage(
    {
      ...harness.runtime(),
      services: {
        ...harness.services,
        dispatcher,
      },
    },
    questionsMarkdown,
  );

  assert.equal(result.status, "PASS");
  assert.equal(dispatcher.codebasePrompts.length, 1);
  assert.deepEqual(dispatcher.summaryRevisionTools, ["read", "bash", "grep", "find", "ls", "write", "edit"]);
});

test("research synthesis that does not write summary fails cleanly", async () => {
  const harness = await TestHarness.create();
  harnesses.push(harness);
  const dispatcher = new RecordingResearchDispatcher(harness.artifacts, { skipSummaryWrite: true });
  const questionsMarkdown = renderQuestionsMarkdown();
  await writeFile(harness.artifacts.researchQuestionsFile, questionsMarkdown, "utf8");

  const result = await runResearchPassSubstage(
    {
      ...harness.runtime(),
      services: {
        ...harness.services,
        dispatcher,
      },
    },
    questionsMarkdown,
  );

  assert.equal(result.status, "FAIL");
  assert.equal(result.dispatchFailure, true);
  assert.match(result.summary ?? "", /without writing research\/summary\.md/);
});

test("research synthesis can recover an inline summary artifact", async () => {
  const harness = await TestHarness.create();
  harnesses.push(harness);
  const dispatcher = new RecordingResearchDispatcher(harness.artifacts, { inlineSummaryOnly: true });
  const questionsMarkdown = renderQuestionsMarkdown();
  await writeFile(harness.artifacts.researchQuestionsFile, questionsMarkdown, "utf8");

  const result = await runResearchPassSubstage(
    {
      ...harness.runtime(),
      services: {
        ...harness.services,
        dispatcher,
      },
    },
    questionsMarkdown,
  );

  assert.equal(result.status, "PASS");
});

class RecordingResearchDispatcher implements Dispatcher {
  readonly codebasePrompts: string[] = [];
  summaryRevisionTools: string[] | undefined;
  private reviewCalls = 0;
  private summaryCalls = 0;

  constructor(
    private readonly artifacts: RunArtifacts,
    private readonly options: {
      failFirstReview?: boolean;
      failFirstReviewSummaryOnly?: boolean;
      skipSummaryWrite?: boolean;
      inlineSummaryOnly?: boolean;
    } = {},
  ) {}

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    switch (request.target.name) {
      case "qrspi-codebase-researcher":
        this.codebasePrompts.push(request.prompt);
        return textResult("## Findings for Q1\n\n### Summary\nNo project markdown files exist outside ignored metadata.\n");
      case "qrspi-research-synthesizer":
        this.summaryCalls += 1;
        if (this.summaryCalls > 1) {
          this.summaryRevisionTools = request.tools;
        }
        if (this.options.inlineSummaryOnly) {
          return textResult("# Research Summary\n\n## Overview\nSynthesized findings.\n");
        }
        if (!this.options.skipSummaryWrite) {
          await writeFile(this.artifacts.researchSummaryFile, "# Research Summary\n\n## Overview\nSynthesized findings.\n", "utf8");
        }
        return textResult("### Status — PASS\n### Files Written — research/summary.md\n### Summary — Synthesized findings.");
      case "qrspi-research-reviewer":
        this.reviewCalls += 1;
        if (this.options.failFirstReviewSummaryOnly && this.reviewCalls === 1) {
          return textResult(
            [
              "### Status — FAIL",
              "",
              "### Artifact Findings",
              "| Artifact | Status | Review Area | Notes |",
              "|----------|--------|-------------|-------|",
              "| `research/q1.md` | PASS | Coverage | Complete. |",
              "| `summary.md` | FAIL | Goal-blind compliance | Prescriptive phrasing. |",
              "",
              "### Per-Question Issues",
              "None.",
              "",
              "### Synthesis Issues",
              "1. `summary.md` contains prescriptive language.",
              "",
              "### Fix Guidance",
              "Re-run the synthesizer only.",
              "",
              "### Summary",
              "FAIL — summary.md needs neutral wording.",
            ].join("\n"),
          );
        }
        if (this.options.failFirstReview && this.reviewCalls === 1) {
          return textResult(
            [
              "### Status — FAIL",
              "",
              "### Artifact Findings",
              "| Artifact | Status | Review Area | Notes |",
              "|----------|--------|-------------|-------|",
              "| `research/q1.md` | FAIL | Coverage | Missing requested scope detail |",
              "",
              "### Per-Question Issues",
              "1. `research/q1.md` needs a narrower inventory.",
              "",
              "### Synthesis Issues",
              "None.",
              "",
              "### Fix Guidance",
              "Re-run the researcher for Q1, then re-run the synthesizer.",
              "",
              "### Summary",
              "FAIL — Q1 is incomplete.",
            ].join("\n"),
          );
        }
        return textResult("### Status — PASS\n\n### Summary\nPass.");
      default:
        return textResult("### Status — PASS\n\n### Summary\nPass.");
    }
  }

  async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((request) => this.dispatch(request)));
  }

  async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const request of requests) {
      results.push(await this.dispatch(request));
    }
    return results;
  }
}

function renderQuestionsMarkdown(): string {
  return [
    "# Research Questions",
    "",
    "### Q1: What markdown files currently exist in the repository?",
    "**Tag**: codebase",
    "**Covers**: FR-1 [markdown]",
    "**Answer shape**: A bounded inventory of markdown files outside generated metadata directories.",
    "**Decision unblocked**: Whether a new markdown file would conflict with existing project content.",
  ].join("\n");
}

function textResult(text: string): DispatchResult {
  return {
    text,
    messages: [{ role: "assistant", content: text }],
    customToolCalls: [],
    endReason: "agent_end",
  };
}
