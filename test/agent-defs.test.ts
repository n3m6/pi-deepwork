import { test } from "node:test";
import assert from "node:assert/strict";

import { isOrchestrator, loadAgentDefinitions } from "../src/agent-defs.js";

test("loadAgentDefinitions returns retained markdown leaf agents only", async () => {
  const definitions = await loadAgentDefinitions();

  assert.equal(definitions.size, 35);
  assert.ok(definitions.has("qrspi-goals-synthesizer"));
  assert.ok(definitions.has("qrspi-reporter"));
  assert.ok(!definitions.has("qrspi-goals"));
  assert.ok(!definitions.has("qrspi-plan"));

  for (const definition of definitions.values()) {
    assert.equal(isOrchestrator(definition), false);
  }
});
