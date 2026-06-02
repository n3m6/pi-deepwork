import { test } from "node:test";
import assert from "node:assert/strict";

import { buildGoalInventory } from "../src/stages/questions.js";

test("buildGoalInventory extracts requirements from Goals h2 sections", () => {
  const inventory = buildGoalInventory([
    "# Goals",
    "",
    "## Functional Requirements",
    "- A file named `SMOKE.md` exists in the project root.",
    "- The file contains exactly one sentence: `Deepwork smoke test.`",
    "",
    "## Non-Functional Requirements",
    "None specified.",
    "",
    "## Constraints",
    "None specified.",
    "",
    "## Acceptance Criteria",
    "1. `SMOKE.md` exists in the project root.",
    "2. The content of `SMOKE.md` is exactly `Deepwork smoke test.`",
  ].join("\n"));

  assert.match(inventory, /FR-1: A file named `SMOKE\.md` exists in the project root\./);
  assert.match(inventory, /FR-2: The file contains exactly one sentence: `Deepwork smoke test\.`/);
  assert.match(inventory, /AC-1: `SMOKE\.md` exists in the project root\./);
  assert.match(inventory, /AC-2: The content of `SMOKE\.md` is exactly `Deepwork smoke test\.`/);
});
