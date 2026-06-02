import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { readArtifact } from "../src/stages/utils.js";
import { writePlanArtifacts } from "../src/stages/plan.js";
import { TestHarness } from "./support/harness.js";

const harnesses: TestHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

test("writePlanArtifacts recovers loose fenced artifact blocks", async () => {
  const harness = await TestHarness.create({ route: "quick-fix", totalPhases: 1 });
  harnesses.push(harness);

  const filesWritten = await writePlanArtifacts(
    harness.runtime(),
    [
      "```markdown",
      "# Implementation Plan",
      "",
      "## Overview",
      "Create one smoke marker file.",
      "```",
      "",
      "```markdown",
      "---",
      "total_phases: 1",
      "---",
      "",
      "## Phase 1 — Quick-fix",
      "",
      "- **Tasks:** 01",
      "- **Acceptance Criteria:** AC-1",
      "- **Replan Gate:** N/A (single-phase route)",
      "```",
      "",
      "```",
      "Task: 01",
      "Title: Create SMOKE.md marker",
      "Phase: Quick-fix",
      "Route: quick-fix",
      "Slice: quick-fix",
      "Dependencies: None",
      "Scope: Create one file.",
      "Acceptance Criteria: AC-1",
      "NFRs: None",
      "Gate Criteria: None",
      "Files:",
      "  - SMOKE.md (CREATE) — write marker content",
      "```",
    ].join("\n"),
  );

  assert.deepEqual(filesWritten, ["plan.md", "phase-manifest.md", "tasks/outlines/task-01.outline"]);
  assert.equal(await readArtifact(harness.artifacts.planFile), "# Implementation Plan\n\n## Overview\nCreate one smoke marker file.\n");
  assert.match(await readArtifact(harness.artifacts.phaseManifestFile), /^---\ntotal_phases: 1\n---/);
  assert.doesNotMatch(await readArtifact(`${harness.artifacts.outlinesDir}/task-01.outline`), /```/);
});
