import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = process.cwd();
const agentsDir = path.join(projectRoot, "agents");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Frontmatter {
  [key: string]: string;
}

function parseFrontmatter(filePath: string): Frontmatter | null {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");

  let openIdx = -1;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      if (openIdx === -1) {
        openIdx = i;
      } else {
        closeIdx = i;
        break;
      }
    }
  }

  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return null;
  }

  const fm: Frontmatter = {};
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fm[key] = value;
  }
  return fm;
}

function getBody(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n");

  let dashesSeen = 0;
  let closeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") {
      dashesSeen++;
      if (dashesSeen === 2) {
        closeIdx = i;
        break;
      }
    }
  }

  if (closeIdx === -1) return raw;
  return lines.slice(closeIdx + 1).join("\n");
}

function getField(fm: Frontmatter | null, field: string): string {
  if (!fm) return "";
  return fm[field] ?? "";
}

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const orchestratorPath = path.join(agentsDir, "qrspi-design.md");
const synthesizerPath = path.join(agentsDir, "qrspi-design-synthesizer.md");
const reviewerPath = path.join(agentsDir, "qrspi-design-reviewer.md");

const orchFM = parseFrontmatter(orchestratorPath);
const synthFM = parseFrontmatter(synthesizerPath);
const reviewFM = parseFrontmatter(reviewerPath);

const orchBody = getBody(orchestratorPath);
const synthBody = getBody(synthesizerPath);
const reviewBody = getBody(reviewerPath);

const EXPECTED_FIELDS = ["description", "tools", "model", "thinking", "max_turns", "prompt_mode", "extensions"];

// ---------------------------------------------------------------------------
// Preamble: files exist and have parseable frontmatter
// ---------------------------------------------------------------------------

test("qrspi-design.md exists and has parseable frontmatter", () => {
  assert.ok(orchFM !== null, "qrspi-design.md frontmatter must be parseable");
});

test("qrspi-design-synthesizer.md exists and has parseable frontmatter", () => {
  assert.ok(synthFM !== null, "qrspi-design-synthesizer.md frontmatter must be parseable");
});

test("qrspi-design-reviewer.md exists and has parseable frontmatter", () => {
  assert.ok(reviewFM !== null, "qrspi-design-reviewer.md frontmatter must be parseable");
});

// ---------------------------------------------------------------------------
// qrspi-design.md — Frontmatter: required fields
// ---------------------------------------------------------------------------

test("qrspi-design.md frontmatter has required field: description", () => {
  const val = getField(orchFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-design.md frontmatter has required field: tools", () => {
  const val = getField(orchFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-design.md frontmatter has required field: model", () => {
  const val = getField(orchFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-design.md frontmatter has required field: thinking", () => {
  const val = getField(orchFM, "thinking");
  assert.ok(val.length > 0, "thinking must be non-empty");
});

test("qrspi-design.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(orchFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-design.md frontmatter has required field: prompt_mode", () => {
  const val = getField(orchFM, "prompt_mode");
  assert.ok(val.length > 0, "prompt_mode must be non-empty");
});

test("qrspi-design.md frontmatter has required field: extensions", () => {
  // extensions must be present (may be "false" or "true")
  const val = getField(orchFM, "extensions");
  assert.ok(val.length > 0, "extensions must be non-empty");
});

// ---------------------------------------------------------------------------
// qrspi-design.md — Frontmatter: exact fields and values
// ---------------------------------------------------------------------------

test("qrspi-design.md frontmatter — exact fields (no extra, no missing)", () => {
  const keys = Object.keys(orchFM!).sort();
  assert.deepEqual(keys, [...EXPECTED_FIELDS].sort());
});

test("qrspi-design.md frontmatter — tools field exact value", () => {
  assert.equal(
    getField(orchFM, "tools"),
    "read, bash, grep, find, ls, write, edit, qrspi_dispatch, qrspi_question"
  );
});

test("qrspi-design.md frontmatter — model field", () => {
  assert.equal(getField(orchFM, "model"), "anthropic/claude-sonnet-4-5");
});

test("qrspi-design.md frontmatter — thinking field", () => {
  assert.equal(getField(orchFM, "thinking"), "low");
});

test("qrspi-design.md frontmatter — max_turns field", () => {
  assert.equal(parseInt(getField(orchFM, "max_turns"), 10), 60);
});

test("qrspi-design.md frontmatter — prompt_mode field", () => {
  assert.equal(getField(orchFM, "prompt_mode"), "replace");
});

test("qrspi-design.md frontmatter — extensions field", () => {
  assert.equal(getField(orchFM, "extensions"), "false");
});

test("qrspi-design.md frontmatter — no opencode-only fields (mode, hidden, temperature, steps, permission)", () => {
  const forbidden = ["mode", "hidden", "temperature", "steps", "permission"];
  const keys = Object.keys(orchFM!);
  for (const f of forbidden) {
    assert.ok(!keys.includes(f), `frontmatter must not contain opencode-only field: ${f}`);
  }
});

// ---------------------------------------------------------------------------
// qrspi-design-synthesizer.md — Frontmatter: required fields
// ---------------------------------------------------------------------------

test("qrspi-design-synthesizer.md frontmatter has required field: description", () => {
  const val = getField(synthFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-design-synthesizer.md frontmatter has required field: tools", () => {
  const val = getField(synthFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-design-synthesizer.md frontmatter has required field: model", () => {
  const val = getField(synthFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-design-synthesizer.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(synthFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

// ---------------------------------------------------------------------------
// qrspi-design-synthesizer.md — Frontmatter: exact fields and values
// ---------------------------------------------------------------------------

test("qrspi-design-synthesizer.md frontmatter — exact fields (no extra, no missing)", () => {
  const keys = Object.keys(synthFM!).sort();
  assert.deepEqual(keys, [...EXPECTED_FIELDS].sort());
});

test("qrspi-design-synthesizer.md frontmatter — tools field (read, bash, grep, find, ls, write, edit)", () => {
  assert.equal(
    getField(synthFM, "tools"),
    "read, bash, grep, find, ls, write, edit"
  );
});

test("qrspi-design-synthesizer.md frontmatter — model field", () => {
  assert.equal(getField(synthFM, "model"), "anthropic/claude-sonnet-4-5");
});

test("qrspi-design-synthesizer.md frontmatter — thinking field", () => {
  assert.equal(getField(synthFM, "thinking"), "low");
});

test("qrspi-design-synthesizer.md frontmatter — max_turns field", () => {
  assert.equal(parseInt(getField(synthFM, "max_turns"), 10), 40);
});

test("qrspi-design-synthesizer.md frontmatter — prompt_mode field", () => {
  assert.equal(getField(synthFM, "prompt_mode"), "replace");
});

test("qrspi-design-synthesizer.md frontmatter — extensions field", () => {
  assert.equal(getField(synthFM, "extensions"), "false");
});

test("qrspi-design-synthesizer.md frontmatter — no opencode-only fields (mode, hidden, temperature, steps, permission)", () => {
  const forbidden = ["mode", "hidden", "temperature", "steps", "permission"];
  const keys = Object.keys(synthFM!);
  for (const f of forbidden) {
    assert.ok(!keys.includes(f), `frontmatter must not contain opencode-only field: ${f}`);
  }
});

// ---------------------------------------------------------------------------
// qrspi-design-reviewer.md — Frontmatter: required fields
// ---------------------------------------------------------------------------

test("qrspi-design-reviewer.md frontmatter has required field: description", () => {
  const val = getField(reviewFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-design-reviewer.md frontmatter has required field: tools", () => {
  const val = getField(reviewFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-design-reviewer.md frontmatter has required field: model", () => {
  const val = getField(reviewFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-design-reviewer.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(reviewFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

// ---------------------------------------------------------------------------
// qrspi-design-reviewer.md — Frontmatter: exact fields and values
// ---------------------------------------------------------------------------

test("qrspi-design-reviewer.md frontmatter — exact fields (no extra, no missing)", () => {
  const keys = Object.keys(reviewFM!).sort();
  assert.deepEqual(keys, [...EXPECTED_FIELDS].sort());
});

test("qrspi-design-reviewer.md frontmatter — tools field (read-only: read, bash, grep, find, ls)", () => {
  assert.equal(
    getField(reviewFM, "tools"),
    "read, bash, grep, find, ls"
  );
});

test("qrspi-design-reviewer.md frontmatter — model field", () => {
  assert.equal(getField(reviewFM, "model"), "anthropic/claude-haiku-4-5");
});

test("qrspi-design-reviewer.md frontmatter — thinking field", () => {
  assert.equal(getField(reviewFM, "thinking"), "low");
});

test("qrspi-design-reviewer.md frontmatter — max_turns field", () => {
  assert.equal(parseInt(getField(reviewFM, "max_turns"), 10), 20);
});

test("qrspi-design-reviewer.md frontmatter — prompt_mode field", () => {
  assert.equal(getField(reviewFM, "prompt_mode"), "replace");
});

test("qrspi-design-reviewer.md frontmatter — extensions field", () => {
  assert.equal(getField(reviewFM, "extensions"), "false");
});

test("qrspi-design-reviewer.md frontmatter — no opencode-only fields (mode, hidden, temperature, steps, permission)", () => {
  const forbidden = ["mode", "hidden", "temperature", "steps", "permission"];
  const keys = Object.keys(reviewFM!);
  for (const f of forbidden) {
    assert.ok(!keys.includes(f), `frontmatter must not contain opencode-only field: ${f}`);
  }
});

// ---------------------------------------------------------------------------
// Reviewer read-only constraint — no write/edit/qrspi_dispatch/qrspi_question
// ---------------------------------------------------------------------------

test("qrspi-design-reviewer.md frontmatter tools does not include write, edit, qrspi_dispatch, or qrspi_question", () => {
  const tools = getField(reviewFM, "tools");
  assert.ok(!tools.includes("write"), "reviewer tools must not include write");
  assert.ok(!tools.includes("edit"), "reviewer tools must not include edit");
  assert.ok(!tools.includes("qrspi_dispatch"), "reviewer tools must not include qrspi_dispatch");
  assert.ok(!tools.includes("qrspi_question"), "reviewer tools must not include qrspi_question");
});

// ---------------------------------------------------------------------------
// qrspi-design.md — Body: content sections
// ---------------------------------------------------------------------------

test("qrspi-design.md body is non-empty (system prompt body exists)", () => {
  assert.ok(orchBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

test("qrspi-design.md body — contains Design Criteria section", () => {
  assert.ok(orchBody.includes("Design Criteria"), "body must contain Design Criteria heading");
});

test("qrspi-design.md body — contains Input extraction step", () => {
  assert.ok(orchBody.includes("### Input"), "body must contain Input section");
  assert.ok(orchBody.includes("<run-id>"), "body must reference run-id extraction");
});

test("qrspi-design.md body — contains Step A (Read Inputs)", () => {
  assert.ok(orchBody.includes("Step A"), "body must contain Step A heading");
  assert.ok(orchBody.includes("Read the following files"), "body must reference Read tool");
  assert.ok(orchBody.includes("goals.md"), "body must reference goals.md input");
  assert.ok(orchBody.includes("requirements.md"), "body must reference requirements.md input");
  assert.ok(orchBody.includes("research/summary.md"), "body must reference research/summary.md input");
});

test("qrspi-design.md body — contains Step B (Interactive Design Discussion) with 5 confirmation points", () => {
  assert.ok(orchBody.includes("Step B"), "body must contain Step B heading");
  assert.ok(orchBody.includes("Chosen approach"), "body must mention confirmation point 1: Chosen approach");
  assert.ok(orchBody.includes("Vertical slice decomposition"), "body must mention confirmation point 2: Vertical slice decomposition");
  assert.ok(orchBody.includes("Phase grouping"), "body must mention confirmation point 3: Phase grouping");
  assert.ok(orchBody.includes("Replan gate criteria"), "body must mention confirmation point 4: Replan gate criteria");
  assert.ok(orchBody.includes("Test expectations per slice"), "body must mention confirmation point 5: Test expectations per slice");
});

test("qrspi-design.md body — contains Step C (Dispatch Synthesizer)", () => {
  assert.ok(orchBody.includes("Step C"), "body must contain Step C heading");
  assert.ok(orchBody.includes("=== GOALS ==="), "body must contain GOALS section header for dispatch");
  assert.ok(orchBody.includes("=== REQUIREMENTS ==="), "body must contain REQUIREMENTS section header for dispatch");
  assert.ok(orchBody.includes("=== RESEARCH SUMMARY ==="), "body must contain RESEARCH SUMMARY section header for dispatch");
  assert.ok(orchBody.includes("=== DESIGN DISCUSSION ==="), "body must contain DESIGN DISCUSSION section header for dispatch");
  assert.ok(orchBody.includes("=== INSTRUCTIONS ==="), "body must contain INSTRUCTIONS section header for dispatch");
});

test("qrspi-design.md body — contains Step D (Automated Review Loop) with 5-round cap", () => {
  assert.ok(orchBody.includes("Step D"), "body must contain Step D heading");
  assert.ok(orchBody.includes("review_round"), "body must reference review_round");
  assert.ok(orchBody.includes("review_round < 5"), "body must reference review_round < 5 cap");
  assert.ok(orchBody.includes("review_round = 5") || orchBody.includes("review_round == 5"),
    "body must reference review_round = 5 cap");
  assert.ok(orchBody.includes("unclean-cap"), "body must reference unclean-cap terminal state");
});

test("qrspi-design.md body — Step D three-way loop decision (PASS, FAIL+<5 retry, FAIL+5 unclean-cap)", () => {
  assert.ok(orchBody.includes("PASS"), "Step D must reference PASS terminal state");
  assert.ok(orchBody.includes("FAIL"), "Step D must reference FAIL state");
  assert.ok(orchBody.includes("unclean-cap"), "Step D must reference unclean-cap terminal state");
});

test("qrspi-design.md body — contains Step E (Human Gate) with gate tracking and feedback loop", () => {
  assert.ok(orchBody.includes("Step E"), "body must contain Step E heading");
  assert.ok(orchBody.includes("gate_round_details"), "body must reference gate_round_details tracking");
  assert.ok(orchBody.includes("approve"), "body must mention approve flow");
  assert.ok(orchBody.includes("provide feedback"), "body must reference feedback rejection path");
  assert.ok(orchBody.includes("feedback/design-round-"), "body must specify feedback file path pattern");
  assert.ok(orchBody.includes("FEEDBACK HISTORY"), "body must include FEEDBACK HISTORY for re-dispatch");
});

test("qrspi-design.md body — contains Return contract with required fields", () => {
  assert.ok(orchBody.includes("### Status"), "body must contain Status field");
  assert.ok(orchBody.includes("### Files Written"), "body must contain Files Written field");
  assert.ok(orchBody.includes("### Summary"), "body must contain Summary field");
  assert.ok(orchBody.includes("### Telemetry"), "body must contain Telemetry field");
});

// ---------------------------------------------------------------------------
// qrspi-design-synthesizer.md — Body: content sections
// ---------------------------------------------------------------------------

test("qrspi-design-synthesizer.md body is non-empty (system prompt body exists)", () => {
  assert.ok(synthBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

test("qrspi-design-synthesizer.md body — contains Task section with 7 steps", () => {
  assert.ok(synthBody.includes("## Task"), "body must contain Task section");
  // Verify numbered steps 1-7 exist
  for (let i = 1; i <= 7; i++) {
    assert.ok(
      synthBody.includes(`${i}.`),
      `body must contain task step ${i}`
    );
  }
});

test("qrspi-design-synthesizer.md body — contains 8-section output structure", () => {
  const sections = [
    "## Approach",
    "## Architectural Patterns",
    "## System Diagram",
    "## Vertical Slices",
    "## Phases",
    "## Test Strategy",
    "## Trade-offs Considered",
    "## Key Decisions",
  ];
  for (const section of sections) {
    assert.ok(synthBody.includes(section), `body must contain output section: ${section}`);
  }
});

test("qrspi-design-synthesizer.md body — contains Final Checks with 8 items", () => {
  assert.ok(synthBody.includes("## Final Checks"), "body must contain Final Checks section");
  // Verify 8 checklist items exist (marked with `- [ ]`)
  const checkCount = (synthBody.match(/- \[ \]/g) || []).length;
  assert.ok(checkCount >= 8, `Final Checks must have at least 8 items, got: ${checkCount}`);
});

// ---------------------------------------------------------------------------
// qrspi-design-reviewer.md — Body: content sections
// ---------------------------------------------------------------------------

test("qrspi-design-reviewer.md body is non-empty (system prompt body exists)", () => {
  assert.ok(reviewBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

test("qrspi-design-reviewer.md body — contains Inputs section", () => {
  assert.ok(reviewBody.includes("### Inputs"), "body must contain Inputs section");
  assert.ok(reviewBody.includes("=== GOALS ==="), "body must reference GOALS input section");
  assert.ok(reviewBody.includes("=== RESEARCH SUMMARY ==="), "body must reference RESEARCH SUMMARY input section");
  assert.ok(reviewBody.includes("=== DESIGN ==="), "body must reference DESIGN input section");
});

test("qrspi-design-reviewer.md body — contains Rubric with all 8 review areas", () => {
  assert.ok(reviewBody.includes("### Rubric"), "body must contain Rubric section");
  const rubricAreas = [
    "Goals alignment",
    "Vertical slices",
    "Test strategy",
    "Internal consistency",
    "Research congruence",
    "YAGNI",
    "Phase coherence",
    "Diagram quality",
  ];
  for (const area of rubricAreas) {
    assert.ok(reviewBody.includes(area), `rubric must include area: ${area}`);
  }
});

test("qrspi-design-reviewer.md body — contains Fix Guidance Rules section", () => {
  assert.ok(reviewBody.includes("Fix Guidance"), "body must contain Fix Guidance section");
});

test("qrspi-design-reviewer.md body — contains structured Output section", () => {
  assert.ok(reviewBody.includes("### Output"), "body must contain Output section");
  assert.ok(reviewBody.includes("### Status — PASS"), "body must contain PASS status header");
  assert.ok(reviewBody.includes("### Review Findings"), "body must contain Review Findings header");
  assert.ok(reviewBody.includes("### Fix Guidance"), "body must contain Fix Guidance header in output");
  assert.ok(reviewBody.includes("### Summary"), "body must contain Summary header");
});

// ---------------------------------------------------------------------------
// qrspi-design.md — Dispatch contract adaptation (qrspi_dispatch not task)
// ---------------------------------------------------------------------------

test("qrspi-design.md body — uses qrspi_dispatch (not opencode task) for subagent dispatch", () => {
  assert.ok(orchBody.includes("qrspi_dispatch"), "body must contain qrspi_dispatch");
  // Verify opencode task patterns are absent
  assert.ok(!orchBody.includes("the task tool"), "body must not contain 'the task tool'");
  assert.ok(!/Invoke\s+\S+\s+as a subagent/i.test(orchBody),
    "body must not use opencode 'Invoke <agent> as a subagent' directive");
});

test("qrspi-design.md body — contains subagent_type: 'qrspi-design-synthesizer'", () => {
  assert.ok(
    orchBody.includes('subagent_type: "qrspi-design-synthesizer"'),
    "body must reference subagent_type qrspi-design-synthesizer"
  );
});

test("qrspi-design.md body — contains subagent_type: 'qrspi-design-reviewer'", () => {
  assert.ok(
    orchBody.includes('subagent_type: "qrspi-design-reviewer"'),
    "body must reference subagent_type qrspi-design-reviewer"
  );
});

// ---------------------------------------------------------------------------
// qrspi-design.md — Question adaptation (qrspi_question not opencode question)
// ---------------------------------------------------------------------------

test("qrspi-design.md body — uses qrspi_question (not opencode question) for interactive prompts", () => {
  assert.ok(orchBody.includes("qrspi_question"), "body must contain qrspi_question");
  assert.ok(!orchBody.includes("the question tool"), "body must not reference 'the question tool'");
});

test("qrspi-design.md body — qrspi_question references type: select with header, message, options", () => {
  assert.ok(orchBody.includes('type: "select"'), "body must reference type: select parameter");
  assert.ok(orchBody.includes("header"), "body must reference header parameter");
  assert.ok(orchBody.includes("message"), "body must reference message parameter");
  assert.ok(orchBody.includes("options"), "body must reference options parameter");
});

// ---------------------------------------------------------------------------
// qrspi-design.md — Cat-to-Read adaptation
// ---------------------------------------------------------------------------

test("qrspi-design.md body — uses Read tool (not cat) for artifact reads", () => {
  assert.ok(orchBody.includes("Read .pipeline/") || orchBody.includes("Read the following files"),
    "body must reference Read tool for file reading (not cat)");
  assert.ok(!orchBody.includes("cat .pipeline/"), "body must not use cat for pipeline file reads");
});

test("qrspi-design.md body — uses bash: mkdir -p for directory creation", () => {
  assert.ok(orchBody.includes("mkdir -p"), "body must use mkdir -p for directory creation");
});

// ---------------------------------------------------------------------------
// Cross-file: model tier assignment (sonnet for orchestrator/synthesizer, haiku for reviewer)
// ---------------------------------------------------------------------------

test("Model tier — orchestrator uses sonnet, synthesizer uses sonnet, reviewer uses haiku", () => {
  assert.equal(
    getField(orchFM, "model"),
    "anthropic/claude-sonnet-4-5",
    "orchestrator must use sonnet-tier model"
  );
  assert.equal(
    getField(synthFM, "model"),
    "anthropic/claude-sonnet-4-5",
    "synthesizer must use sonnet-tier model"
  );
  assert.equal(
    getField(reviewFM, "model"),
    "anthropic/claude-haiku-4-5",
    "reviewer must use haiku-tier model"
  );
});

// ---------------------------------------------------------------------------
// Cross-file: no opencode permission system references in any body
// ---------------------------------------------------------------------------

test("All three design agent bodies — no opencode permission system references", () => {
  const forbiddenPatterns = [
    /permission\.edit/,
    /permission\.bash/,
    /permission\.task/,
    /permission\.webfetch/,
    /permission\.question/,
    /permission\.todowrite/,
    /allowed-list/,
    /Rule\s*11/,
  ];

  const allBodies: Record<string, string> = {
    orchestrator: orchBody,
    synthesizer: synthBody,
    reviewer: reviewBody,
  };

  for (const [name, body] of Object.entries(allBodies)) {
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(body),
        `${name} agent body must not contain "${pattern.source}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-file: all three agent files have non-empty model and positive max_turns
// ---------------------------------------------------------------------------

test("All three design agent files have non-empty model strings", () => {
  const fms: [string, Frontmatter | null][] = [
    ["orchestrator", orchFM],
    ["synthesizer", synthFM],
    ["reviewer", reviewFM],
  ];
  for (const [name, fm] of fms) {
    const modelVal = getField(fm, "model");
    assert.ok(
      modelVal.trim().length > 0,
      `${name} model must be a non-empty string`
    );
  }
});

test("All three design agent files have positive integer max_turns", () => {
  const fms: [string, Frontmatter | null][] = [
    ["orchestrator", orchFM],
    ["synthesizer", synthFM],
    ["reviewer", reviewFM],
  ];
  for (const [name, fm] of fms) {
    const val = getField(fm, "max_turns");
    const num = parseInt(val, 10);
    assert.ok(
      !isNaN(num) && num > 0,
      `${name} max_turns must be a positive integer, got: ${val}`
    );
  }
});
