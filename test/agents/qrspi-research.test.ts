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

const orchestratorPath = path.join(agentsDir, "qrspi-research.md");
const researchPassPath = path.join(agentsDir, "qrspi-research-pass.md");
const questionsPath = path.join(agentsDir, "qrspi-questions.md");
const codebaseResearcherPath = path.join(agentsDir, "qrspi-codebase-researcher.md");
const webResearcherPath = path.join(agentsDir, "qrspi-web-researcher.md");
const synthesizerPath = path.join(agentsDir, "qrspi-research-synthesizer.md");
const reviewerPath = path.join(agentsDir, "qrspi-research-reviewer.md");

const orchFM = parseFrontmatter(orchestratorPath);
const researchPassFM = parseFrontmatter(researchPassPath);
const questionsFM = parseFrontmatter(questionsPath);
const cbFM = parseFrontmatter(codebaseResearcherPath);
const webFM = parseFrontmatter(webResearcherPath);
const synthFM = parseFrontmatter(synthesizerPath);
const reviewFM = parseFrontmatter(reviewerPath);

const orchBody = getBody(orchestratorPath);
const researchPassBody = getBody(researchPassPath);
const questionsBody = getBody(questionsPath);
const cbBody = getBody(codebaseResearcherPath);
const webBody = getBody(webResearcherPath);
const synthBody = getBody(synthesizerPath);
const reviewBody = getBody(reviewerPath);

const EXPECTED_FIELDS = ["description", "tools", "model", "thinking", "max_turns", "prompt_mode", "extensions"];
const EXPECTED_FIELDS_SORTED = [...EXPECTED_FIELDS].sort();

// ---------------------------------------------------------------------------
// Preamble: files exist and have parseable frontmatter
// ---------------------------------------------------------------------------

test("qrspi-research.md exists and has parseable frontmatter", () => {
  assert.ok(orchFM !== null, "qrspi-research.md frontmatter must be parseable");
});

test("qrspi-research-pass.md exists and has parseable frontmatter", () => {
  assert.ok(researchPassFM !== null, "qrspi-research-pass.md frontmatter must be parseable");
});

test("qrspi-questions.md exists and has parseable frontmatter", () => {
  assert.ok(questionsFM !== null, "qrspi-questions.md frontmatter must be parseable");
});

test("qrspi-codebase-researcher.md exists and has parseable frontmatter", () => {
  assert.ok(cbFM !== null, "qrspi-codebase-researcher.md frontmatter must be parseable");
});

test("qrspi-web-researcher.md exists and has parseable frontmatter", () => {
  assert.ok(webFM !== null, "qrspi-web-researcher.md frontmatter must be parseable");
});

test("qrspi-research-synthesizer.md exists and has parseable frontmatter", () => {
  assert.ok(synthFM !== null, "qrspi-research-synthesizer.md frontmatter must be parseable");
});

test("qrspi-research-reviewer.md exists and has parseable frontmatter", () => {
  assert.ok(reviewFM !== null, "qrspi-research-reviewer.md frontmatter must be parseable");
});

// ---------------------------------------------------------------------------
// Frontmatter — exact fields (all 7 required)
// ---------------------------------------------------------------------------

test("qrspi-research.md frontmatter — exact 7 required fields, no extras", () => {
  const keys = Object.keys(orchFM!).sort();
  assert.deepEqual(keys, EXPECTED_FIELDS_SORTED);
});

test("qrspi-codebase-researcher.md frontmatter — exact 7 required fields, no extras", () => {
  const keys = Object.keys(cbFM!).sort();
  assert.deepEqual(keys, EXPECTED_FIELDS_SORTED);
});

test("qrspi-web-researcher.md frontmatter — exact 7 required fields, no extras", () => {
  const keys = Object.keys(webFM!).sort();
  assert.deepEqual(keys, EXPECTED_FIELDS_SORTED);
});

test("qrspi-research-synthesizer.md frontmatter — exact 7 required fields, no extras", () => {
  const keys = Object.keys(synthFM!).sort();
  assert.deepEqual(keys, EXPECTED_FIELDS_SORTED);
});

test("qrspi-research-reviewer.md frontmatter — exact 7 required fields, no extras", () => {
  const keys = Object.keys(reviewFM!).sort();
  assert.deepEqual(keys, EXPECTED_FIELDS_SORTED);
});

// ---------------------------------------------------------------------------
// Frontmatter — model tiers (AC-7)
// ---------------------------------------------------------------------------

test("qrspi-research.md model is anthropic/claude-sonnet-4-5", () => {
  assert.equal(getField(orchFM, "model"), "anthropic/claude-sonnet-4-5");
});

test("qrspi-codebase-researcher.md model is anthropic/claude-haiku-4-5", () => {
  assert.equal(getField(cbFM, "model"), "anthropic/claude-haiku-4-5");
});

test("qrspi-web-researcher.md model is anthropic/claude-haiku-4-5", () => {
  assert.equal(getField(webFM, "model"), "anthropic/claude-haiku-4-5");
});

test("qrspi-research-synthesizer.md model is anthropic/claude-sonnet-4-5", () => {
  assert.equal(getField(synthFM, "model"), "anthropic/claude-sonnet-4-5");
});

test("qrspi-research-reviewer.md model is anthropic/claude-haiku-4-5", () => {
  assert.equal(getField(reviewFM, "model"), "anthropic/claude-haiku-4-5");
});

// ---------------------------------------------------------------------------
// Frontmatter — tool sets
// ---------------------------------------------------------------------------

test("qrspi-research.md tools matches spec: read, bash, grep, find, ls, write, edit, qrspi_dispatch", () => {
  assert.equal(
    getField(orchFM, "tools"),
    "read, bash, grep, find, ls, write, edit, qrspi_dispatch"
  );
});

test("qrspi-codebase-researcher.md tools matches spec: read, bash, grep, find, ls", () => {
  assert.equal(
    getField(cbFM, "tools"),
    "read, bash, grep, find, ls"
  );
});

test("qrspi-web-researcher.md tools matches spec: read, bash", () => {
  assert.equal(
    getField(webFM, "tools"),
    "read, bash"
  );
});

test("qrspi-research-synthesizer.md tools matches spec: read, bash, grep, find, ls, write, edit", () => {
  assert.equal(
    getField(synthFM, "tools"),
    "read, bash, grep, find, ls, write, edit"
  );
});

test("qrspi-research-reviewer.md tools matches spec: read, bash, grep, find, ls", () => {
  assert.equal(
    getField(reviewFM, "tools"),
    "read, bash, grep, find, ls"
  );
});

test("qrspi-research-pass.md tools include background result joins for multi-researcher batches", () => {
  assert.equal(
    getField(researchPassFM, "tools"),
    "read, bash, grep, find, ls, write, edit, qrspi_dispatch, qrspi_get_subagent_result"
  );
});

test("qrspi-questions.md tools include background result joins for reviewer batches", () => {
  assert.equal(
    getField(questionsFM, "tools"),
    "read, bash, grep, find, ls, write, edit, qrspi_dispatch, qrspi_get_subagent_result"
  );
});

// ---------------------------------------------------------------------------
// Frontmatter — turn limits
// ---------------------------------------------------------------------------

test("qrspi-research.md max_turns is 70", () => {
  assert.equal(parseInt(getField(orchFM, "max_turns"), 10), 70);
});

test("qrspi-codebase-researcher.md max_turns is 15", () => {
  assert.equal(parseInt(getField(cbFM, "max_turns"), 10), 15);
});

test("qrspi-web-researcher.md max_turns is 15", () => {
  assert.equal(parseInt(getField(webFM, "max_turns"), 10), 15);
});

test("qrspi-research-synthesizer.md max_turns is 30", () => {
  assert.equal(parseInt(getField(synthFM, "max_turns"), 10), 30);
});

test("qrspi-research-reviewer.md max_turns is 20", () => {
  assert.equal(parseInt(getField(reviewFM, "max_turns"), 10), 20);
});

// ---------------------------------------------------------------------------
// Frontmatter — prompt_mode: replace, extensions: false, thinking: low
// ---------------------------------------------------------------------------

const ALL_FMS: [string, Frontmatter | null][] = [
  ["qrspi-research (orchestrator)", orchFM],
  ["qrspi-codebase-researcher", cbFM],
  ["qrspi-web-researcher", webFM],
  ["qrspi-research-synthesizer", synthFM],
  ["qrspi-research-reviewer", reviewFM],
];

test("all five agents have prompt_mode: replace", () => {
  for (const [name, fm] of ALL_FMS) {
    assert.equal(getField(fm, "prompt_mode"), "replace", `${name} prompt_mode must be "replace"`);
  }
});

test("all five agents have extensions: false", () => {
  for (const [name, fm] of ALL_FMS) {
    assert.equal(getField(fm, "extensions"), "false", `${name} extensions must be "false"`);
  }
});

test("all five agents have thinking: low", () => {
  for (const [name, fm] of ALL_FMS) {
    assert.equal(getField(fm, "thinking"), "low", `${name} thinking must be "low"`);
  }
});

// ---------------------------------------------------------------------------
// Body — all five agents have non-empty body
// ---------------------------------------------------------------------------

test("all five agents have non-empty system prompt body", () => {
  const bodies: [string, string][] = [
    ["orchestrator", orchBody],
    ["codebase-researcher", cbBody],
    ["web-researcher", webBody],
    ["synthesizer", synthBody],
    ["reviewer", reviewBody],
  ];
  for (const [name, body] of bodies) {
    assert.ok(body.trim().length > 0, `${name} body must not be empty`);
  }
});

test("merged research child agents have non-empty system prompt bodies", () => {
  const bodies: [string, string][] = [
    ["research-pass", researchPassBody],
    ["questions", questionsBody],
  ];
  for (const [name, body] of bodies) {
    assert.ok(body.trim().length > 0, `${name} body must not be empty`);
  }
});

// ---------------------------------------------------------------------------
// Body — orchestrator: goal-blind constraint
// ---------------------------------------------------------------------------

test("qrspi-research.md body — contains goal-blind constraint phrase 'Goal-blind. Facts only.'", () => {
  assert.ok(
    orchBody.includes("Goal-blind. Facts only."),
    "orchestrator body must contain 'Goal-blind. Facts only.'"
  );
});

test("qrspi-research.md body — goal-blind phrase appears in context of child agent dispatch instructions", () => {
  // The constraint is injected verbatim into every child prompt (Standard Research Constraints)
  assert.ok(
    orchBody.includes("Goal-blind. Facts only. No opinions, recommendations, or design suggestions"),
    "orchestrator body must contain full goal-blind constraint text"
  );
});

// ---------------------------------------------------------------------------
// Body — orchestrator: return contract
// ---------------------------------------------------------------------------

test("qrspi-research.md body — contains ### Status — PASS", () => {
  assert.ok(orchBody.includes("### Status — PASS"), "orchestrator body must contain PASS return template");
});

test("qrspi-research.md body — contains ### Status — FAIL", () => {
  assert.ok(orchBody.includes("### Status — FAIL"), "orchestrator body must contain FAIL return template");
});

test("qrspi-research.md body — contains ### Files Written in structured output", () => {
  assert.ok(orchBody.includes("### Files Written"), "orchestrator body must contain Files Written field");
});

test("qrspi-research.md body — contains ### Summary in structured output", () => {
  assert.ok(orchBody.includes("### Summary"), "orchestrator body must contain Summary field");
});

// ---------------------------------------------------------------------------
// Body — orchestrator: dispatch references use qrspi_dispatch, not opencode task
// ---------------------------------------------------------------------------

test("qrspi-research.md body — uses qrspi_dispatch for all child agent dispatch", () => {
  assert.ok(orchBody.includes("qrspi_dispatch"), "orchestrator body must reference qrspi_dispatch");
});

test("qrspi-research.md body — does not contain opencode 'task' dispatch references", () => {
  // "the task tool" and "via task" are opencode-isms
  assert.ok(!orchBody.includes("the task tool"), "body must not contain 'the task tool'");
  assert.ok(!/via\s+task\b/i.test(orchBody), "body must not use 'via task' dispatch reference");
});

test("qrspi-research.md body — contains subagent_type: 'qrspi-questions'", () => {
  assert.ok(orchBody.includes('subagent_type: "qrspi-questions"'));
});

test("qrspi-research.md body — contains subagent_type: 'qrspi-research-pass'", () => {
  assert.ok(orchBody.includes('subagent_type: "qrspi-research-pass"'));
});

test("qrspi-research.md body — contains subagent_type: 'qrspi-research-synthesizer'", () => {
  assert.ok(orchBody.includes('subagent_type: "qrspi-research-synthesizer"'));
});

test("qrspi-research.md body — contains subagent_type: 'qrspi-research-reviewer'", () => {
  assert.ok(orchBody.includes('subagent_type: "qrspi-research-reviewer"'));
});

test("qrspi-research-pass.md body — contains subagent_type: 'qrspi-codebase-researcher'", () => {
  assert.ok(researchPassBody.includes('subagent_type: "qrspi-codebase-researcher"'));
});

test("qrspi-research-pass.md body — contains subagent_type: 'qrspi-web-researcher'", () => {
  assert.ok(researchPassBody.includes('subagent_type: "qrspi-web-researcher"'));
});

test("qrspi-research-pass.md body — uses background join contract for hybrid research", () => {
  assert.ok(researchPassBody.includes("run_in_background: true"));
  assert.ok(researchPassBody.includes("qrspi_get_subagent_result"));
});

test("qrspi-questions.md body — supports initial and follow-up modes", () => {
  assert.ok(questionsBody.includes("MODE ===") && questionsBody.includes("initial") && questionsBody.includes("follow-up"));
  assert.ok(questionsBody.includes("QUESTION BATCH FILE"), "questions child must accept a round-local batch path");
});

test("qrspi-questions.md body — uses background join contract for reviewer batches", () => {
  assert.ok(questionsBody.includes("run_in_background: true"));
  assert.ok(questionsBody.includes("qrspi_get_subagent_result"));
});

// ---------------------------------------------------------------------------
// Body — orchestrator: read tool convention (Read .pipeline/, not cat .pipeline/)
// ---------------------------------------------------------------------------

test("qrspi-research.md body — uses 'Read .pipeline/' not 'cat .pipeline/'", () => {
  assert.ok(orchBody.includes("Read .pipeline/"), "orchestrator body must contain 'Read .pipeline/'");
  assert.ok(!orchBody.includes("cat .pipeline/"), "orchestrator body must not contain 'cat .pipeline/'");
});

// ---------------------------------------------------------------------------
// Body — synthesizer: output target and required sections
// ---------------------------------------------------------------------------

test("qrspi-research-synthesizer.md body — specifies output to .pipeline/<run-id>/research/summary.md", () => {
  assert.ok(
    synthBody.includes(".pipeline/") && synthBody.includes("research/summary.md"),
    "synthesizer body must specify output to .pipeline/<run-id>/research/summary.md"
  );
});

test("qrspi-research-synthesizer.md body — required sections: Overview", () => {
  assert.ok(synthBody.includes("Overview"), "synthesizer body must specify Overview section");
});

test("qrspi-research-synthesizer.md body — required sections: Per-Question Findings (table)", () => {
  assert.ok(synthBody.includes("Per-Question Findings"), "synthesizer body must specify Per-Question Findings section");
});

test("qrspi-research-synthesizer.md body — required sections: Integrated Analysis", () => {
  assert.ok(synthBody.includes("Integrated Analysis"), "synthesizer body must specify Integrated Analysis section");
});

test("qrspi-research-synthesizer.md body — required sections: Gap/Conflict Index", () => {
  assert.ok(synthBody.includes("Gap/Conflict Index"), "synthesizer body must specify Gap/Conflict Index section");
});

test("qrspi-research-synthesizer.md body — required sections: Sources", () => {
  assert.ok(synthBody.includes("Sources"), "synthesizer body must specify Sources section");
});

// ---------------------------------------------------------------------------
// Body — reviewer: goal-blind compliance checking
// ---------------------------------------------------------------------------

test("qrspi-research-reviewer.md body — flags solution recommendations, evaluative language, ranking, preferred approaches", () => {
  assert.ok(
    reviewBody.includes("evaluates") || reviewBody.includes("recommends") || reviewBody.includes("ranks"),
    "reviewer body must reference detecting solution recommendations/evaluative language/ranking"
  );
  assert.ok(
    reviewBody.includes("preferred approach") || reviewBody.includes("preferred approaches"),
    "reviewer body must flag preferred approaches"
  );
});

test("qrspi-research-reviewer.md body — reports goal-blind violations with exact text and line reference", () => {
  assert.ok(
    reviewBody.includes("exact text") && reviewBody.includes("line reference"),
    "reviewer body must require exact text and line reference for violations"
  );
});

// ---------------------------------------------------------------------------
// Body — reviewer: return contract with Fix Guidance on FAIL
// ---------------------------------------------------------------------------

test("qrspi-research-reviewer.md body — contains ### Status — PASS or FAIL", () => {
  assert.ok(
    reviewBody.includes("### Status — PASS or FAIL"),
    "reviewer body must contain Status header with PASS or FAIL"
  );
});

test("qrspi-research-reviewer.md body — contains ### Fix Guidance section", () => {
  assert.ok(reviewBody.includes("### Fix Guidance"), "reviewer body must contain Fix Guidance section");
});

test("qrspi-research-reviewer.md body — Fix Guidance is required on FAIL", () => {
  assert.ok(
    reviewBody.includes("### Fix Guidance") &&
    (reviewBody.includes("FAIL") || reviewBody.includes("Fail")),
    "reviewer body must associate Fix Guidance with FAIL state"
  );
});

// ---------------------------------------------------------------------------
// Body — reviewer: read-only constraint
// ---------------------------------------------------------------------------

test("qrspi-research-reviewer.md body — reviewers are read-only (no write/edit tools)", () => {
  const tools = getField(reviewFM, "tools");
  assert.ok(!tools.includes("write"), "reviewer tools must not include write");
  assert.ok(!tools.includes("edit"), "reviewer tools must not include edit");
});

// ---------------------------------------------------------------------------
// Body — codebase researcher: evidence requirements
// ---------------------------------------------------------------------------

test("qrspi-codebase-researcher.md body — requires file:line references for claims", () => {
  assert.ok(cbBody.includes("file:line"), "codebase researcher body must require file:line references");
});

// ---------------------------------------------------------------------------
// Body — web researcher: source URL requirements
// ---------------------------------------------------------------------------

test("qrspi-web-researcher.md body — requires source URLs for claims", () => {
  assert.ok(webBody.includes("URL"), "web researcher body must reference source URLs");
});

// ---------------------------------------------------------------------------
// Cross-file: no opencode patterns (webfetch, websearch, cat .pipeline/, permission system)
// ---------------------------------------------------------------------------

test("Research agents — no opencode webfetch/websearch references in any body", () => {
  const bodies: [string, string][] = [
    ["orchestrator", orchBody],
    ["codebase-researcher", cbBody],
    ["web-researcher", webBody],
    ["synthesizer", synthBody],
    ["reviewer", reviewBody],
  ];
  for (const [name, body] of bodies) {
    assert.ok(!body.includes("webfetch"), `${name} body must not contain webfetch`);
    assert.ok(!body.includes("websearch"), `${name} body must not contain websearch`);
  }
});

test("Research agents — no opencode cat .pipeline/ in any body", () => {
  const bodies: [string, string][] = [
    ["orchestrator", orchBody],
    ["codebase-researcher", cbBody],
    ["web-researcher", webBody],
    ["synthesizer", synthBody],
    ["reviewer", reviewBody],
  ];
  for (const [name, body] of bodies) {
    assert.ok(!body.includes("cat .pipeline/"), `${name} body must not contain "cat .pipeline/"`);
  }
});

test("Research agents — no opencode permission system references", () => {
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
  const bodies: [string, string][] = [
    ["orchestrator", orchBody],
    ["codebase-researcher", cbBody],
    ["web-researcher", webBody],
    ["synthesizer", synthBody],
    ["reviewer", reviewBody],
  ];
  for (const [name, body] of bodies) {
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(body),
        `${name} body must not contain "${pattern.source}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-file: model tier strategy (Sonnet for orchestrator+synthesizer, Haiku for leaves+reviewer)
// ---------------------------------------------------------------------------

test("Model tier strategy: orchestrator and synthesizer use Sonnet; leaves and reviewer use Haiku", () => {
  assert.equal(getField(orchFM, "model"), "anthropic/claude-sonnet-4-5");
  assert.equal(getField(synthFM, "model"), "anthropic/claude-sonnet-4-5");
  assert.equal(getField(cbFM, "model"), "anthropic/claude-haiku-4-5");
  assert.equal(getField(webFM, "model"), "anthropic/claude-haiku-4-5");
  assert.equal(getField(reviewFM, "model"), "anthropic/claude-haiku-4-5");
});

// ---------------------------------------------------------------------------
// Cross-file: read .pipeline/ convention in bodies that reference pipeline artifacts
// ---------------------------------------------------------------------------

test("agents that reference .pipeline/ use 'Read .pipeline/' not 'cat .pipeline/'", () => {
  const bodies: [string, string][] = [
    ["orchestrator", orchBody],
    ["synthesizer", synthBody],
    ["reviewer", reviewBody],
    ["codebase-researcher", cbBody],
    ["web-researcher", webBody],
  ];
  for (const [name, body] of bodies) {
    if (body.includes(".pipeline/")) {
      assert.ok(
        !body.includes("cat .pipeline/"),
        `${name} references .pipeline/ but must not use 'cat .pipeline/'`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-file: all five agents have all 7 required fields non-empty
// ---------------------------------------------------------------------------

test("all five agents have non-empty description in frontmatter", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "description");
    assert.ok(val.length > 0, `${name} description must be non-empty`);
  }
});

test("all five agents have non-empty tools in frontmatter", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "tools");
    assert.ok(val.length > 0, `${name} tools must be non-empty`);
  }
});

test("all five agents have non-empty model in frontmatter", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "model");
    assert.ok(val.length > 0, `${name} model must be non-empty`);
  }
});

test("all five agents have positive integer max_turns", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "max_turns");
    const num = parseInt(val, 10);
    assert.ok(!isNaN(num) && num > 0, `${name} max_turns must be positive integer, got: ${val}`);
  }
});

test("all five agents have non-empty thinking field", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "thinking");
    assert.ok(val.length > 0, `${name} thinking must be non-empty`);
  }
});

test("all five agents have non-empty prompt_mode field", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "prompt_mode");
    assert.ok(val.length > 0, `${name} prompt_mode must be non-empty`);
  }
});

test("all five agents have non-empty extensions field", () => {
  for (const [name, fm] of ALL_FMS) {
    const val = getField(fm, "extensions");
    assert.ok(val.length > 0, `${name} extensions must be non-empty`);
  }
});

// ---------------------------------------------------------------------------
// Boundary: reviewer must not use qrspi_dispatch (reads artifacts only)
// ---------------------------------------------------------------------------

test("qrspi-research-reviewer.md tools does not include qrspi_dispatch", () => {
  const tools = getField(reviewFM, "tools");
  assert.ok(!tools.includes("qrspi_dispatch"), "reviewer must not have qrspi_dispatch (read-only reviewer)");
});
