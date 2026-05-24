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

const orchestratorPath = path.join(agentsDir, "qrspi-structure.md");
const mapperPath = path.join(agentsDir, "qrspi-structure-mapper.md");
const reviewerPath = path.join(agentsDir, "qrspi-structure-reviewer.md");

const orchFM = parseFrontmatter(orchestratorPath);
const mapperFM = parseFrontmatter(mapperPath);
const reviewFM = parseFrontmatter(reviewerPath);

const orchBody = getBody(orchestratorPath);
const mapperBody = getBody(mapperPath);
const reviewBody = getBody(reviewerPath);

// ---------------------------------------------------------------------------
// Preamble: files exist and have parseable frontmatter
// ---------------------------------------------------------------------------

test("qrspi-structure.md exists and has parseable frontmatter", () => {
  assert.ok(orchFM !== null, "qrspi-structure.md frontmatter must be parseable");
});

test("qrspi-structure-mapper.md exists and has parseable frontmatter", () => {
  assert.ok(mapperFM !== null, "qrspi-structure-mapper.md frontmatter must be parseable");
});

test("qrspi-structure-reviewer.md exists and has parseable frontmatter", () => {
  assert.ok(reviewFM !== null, "qrspi-structure-reviewer.md frontmatter must be parseable");
});

// ---------------------------------------------------------------------------
// qrspi-structure.md — Required frontmatter fields (7 required fields)
// ---------------------------------------------------------------------------

test("qrspi-structure.md frontmatter has required field: description", () => {
  const val = getField(orchFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-structure.md frontmatter has required field: tools", () => {
  const val = getField(orchFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-structure.md frontmatter has required field: model", () => {
  const val = getField(orchFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-structure.md frontmatter has required field: thinking", () => {
  const val = getField(orchFM, "thinking");
  assert.ok(val.length > 0, "thinking must be non-empty");
});

test("qrspi-structure.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(orchFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-structure.md frontmatter has required field: prompt_mode", () => {
  const val = getField(orchFM, "prompt_mode");
  assert.ok(val.length > 0, "prompt_mode must be non-empty");
});

test("qrspi-structure.md frontmatter has required field: extensions", () => {
  assert.ok("extensions" in (orchFM ?? {}), "extensions field must be present in frontmatter");
});

// ---------------------------------------------------------------------------
// qrspi-structure.md — Specific frontmatter values
// ---------------------------------------------------------------------------

test("qrspi-structure.md tools includes qrspi_dispatch and qrspi_question", () => {
  const val = getField(orchFM, "tools");
  assert.ok(val.includes("qrspi_dispatch"), "tools must include qrspi_dispatch");
  assert.ok(val.includes("qrspi_question"), "tools must include qrspi_question");
});

test("qrspi-structure.md tools includes read, write, edit, bash, grep, find, ls", () => {
  const val = getField(orchFM, "tools");
  assert.ok(val.includes("read"), "tools must include read");
  assert.ok(val.includes("bash"), "tools must include bash");
  assert.ok(val.includes("grep"), "tools must include grep");
  assert.ok(val.includes("find"), "tools must include find");
  assert.ok(val.includes("ls"), "tools must include ls");
  assert.ok(val.includes("write"), "tools must include write");
  assert.ok(val.includes("edit"), "tools must include edit");
});

test("qrspi-structure.md model is anthropic/claude-sonnet-4-5", () => {
  const val = getField(orchFM, "model");
  assert.equal(val, "anthropic/claude-sonnet-4-5", "model must be anthropic/claude-sonnet-4-5");
});

test("qrspi-structure.md thinking is low", () => {
  const val = getField(orchFM, "thinking");
  assert.equal(val, "low", "thinking must be low");
});

test("qrspi-structure.md max_turns is 40", () => {
  const val = getField(orchFM, "max_turns");
  assert.equal(val, "40", "max_turns must be 40");
});

test("qrspi-structure.md body is non-empty (system prompt body exists)", () => {
  assert.ok(orchBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

// ---------------------------------------------------------------------------
// qrspi-structure-mapper.md — Required frontmatter fields (7 required fields)
// ---------------------------------------------------------------------------

test("qrspi-structure-mapper.md frontmatter has required field: description", () => {
  const val = getField(mapperFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-structure-mapper.md frontmatter has required field: tools", () => {
  const val = getField(mapperFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-structure-mapper.md frontmatter has required field: model", () => {
  const val = getField(mapperFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-structure-mapper.md frontmatter has required field: thinking", () => {
  const val = getField(mapperFM, "thinking");
  assert.ok(val.length > 0, "thinking must be non-empty");
});

test("qrspi-structure-mapper.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(mapperFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-structure-mapper.md frontmatter has required field: prompt_mode", () => {
  const val = getField(mapperFM, "prompt_mode");
  assert.ok(val.length > 0, "prompt_mode must be non-empty");
});

test("qrspi-structure-mapper.md frontmatter has required field: extensions", () => {
  assert.ok("extensions" in (mapperFM ?? {}), "extensions field must be present in frontmatter");
});

// ---------------------------------------------------------------------------
// qrspi-structure-mapper.md — Specific frontmatter values
// ---------------------------------------------------------------------------

test("qrspi-structure-mapper.md tools are read, bash, grep, find, ls (read-only)", () => {
  const val = getField(mapperFM, "tools");
  assert.ok(val.includes("read"), "tools must include read");
  assert.ok(val.includes("bash"), "tools must include bash");
  assert.ok(val.includes("grep"), "tools must include grep");
  assert.ok(val.includes("find"), "tools must include find");
  assert.ok(val.includes("ls"), "tools must include ls");
  // Read-only: must NOT have write or edit
  assert.ok(!val.includes("write"), "mapper must not include write tool");
  assert.ok(!val.includes("edit"), "mapper must not include edit tool");
});

test("qrspi-structure-mapper.md model is anthropic/claude-sonnet-4-5", () => {
  const val = getField(mapperFM, "model");
  assert.equal(val, "anthropic/claude-sonnet-4-5", "model must be anthropic/claude-sonnet-4-5");
});

test("qrspi-structure-mapper.md thinking is low", () => {
  const val = getField(mapperFM, "thinking");
  assert.equal(val, "low", "thinking must be low");
});

test("qrspi-structure-mapper.md max_turns is 30", () => {
  const val = getField(mapperFM, "max_turns");
  assert.equal(val, "30", "max_turns must be 30");
});

test("qrspi-structure-mapper.md body is non-empty (system prompt body exists)", () => {
  assert.ok(mapperBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

// ---------------------------------------------------------------------------
// qrspi-structure-reviewer.md — Required frontmatter fields (7 required fields)
// ---------------------------------------------------------------------------

test("qrspi-structure-reviewer.md frontmatter has required field: description", () => {
  const val = getField(reviewFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-structure-reviewer.md frontmatter has required field: tools", () => {
  const val = getField(reviewFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-structure-reviewer.md frontmatter has required field: model", () => {
  const val = getField(reviewFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-structure-reviewer.md frontmatter has required field: thinking", () => {
  const val = getField(reviewFM, "thinking");
  assert.ok(val.length > 0, "thinking must be non-empty");
});

test("qrspi-structure-reviewer.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(reviewFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-structure-reviewer.md frontmatter has required field: prompt_mode", () => {
  const val = getField(reviewFM, "prompt_mode");
  assert.ok(val.length > 0, "prompt_mode must be non-empty");
});

test("qrspi-structure-reviewer.md frontmatter has required field: extensions", () => {
  assert.ok("extensions" in (reviewFM ?? {}), "extensions field must be present in frontmatter");
});

// ---------------------------------------------------------------------------
// qrspi-structure-reviewer.md — Specific frontmatter values
// ---------------------------------------------------------------------------

test("qrspi-structure-reviewer.md tools are read, bash, grep, find, ls (read-only)", () => {
  const val = getField(reviewFM, "tools");
  assert.ok(val.includes("read"), "tools must include read");
  assert.ok(val.includes("bash"), "tools must include bash");
  assert.ok(val.includes("grep"), "tools must include grep");
  assert.ok(val.includes("find"), "tools must include find");
  assert.ok(val.includes("ls"), "tools must include ls");
  // Read-only: must NOT have write or edit
  assert.ok(!val.includes("write"), "reviewer must not include write tool");
  assert.ok(!val.includes("edit"), "reviewer must not include edit tool");
});

test("qrspi-structure-reviewer.md model is anthropic/claude-haiku-4-5", () => {
  const val = getField(reviewFM, "model");
  assert.equal(val, "anthropic/claude-haiku-4-5", "model must be anthropic/claude-haiku-4-5");
});

test("qrspi-structure-reviewer.md thinking is low", () => {
  const val = getField(reviewFM, "thinking");
  assert.equal(val, "low", "thinking must be low");
});

test("qrspi-structure-reviewer.md max_turns is 20", () => {
  const val = getField(reviewFM, "max_turns");
  assert.equal(val, "20", "max_turns must be 20");
});

test("qrspi-structure-reviewer.md body is non-empty (system prompt body exists)", () => {
  assert.ok(reviewBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

// ---------------------------------------------------------------------------
// Model tier assignment (AC-7)
// ---------------------------------------------------------------------------

test("orchestrator and mapper use sonnet-tier; reviewer uses haiku-tier", () => {
  assert.equal(getField(orchFM, "model"), "anthropic/claude-sonnet-4-5",
    "orchestrator model must be sonnet-tier");
  assert.equal(getField(mapperFM, "model"), "anthropic/claude-sonnet-4-5",
    "mapper model must be sonnet-tier");
  assert.equal(getField(reviewFM, "model"), "anthropic/claude-haiku-4-5",
    "reviewer model must be haiku-tier");
});

// ---------------------------------------------------------------------------
// No opencode-only frontmatter fields
// ---------------------------------------------------------------------------

test("qrspi-structure.md has no opencode-only frontmatter fields: mode, hidden, temperature, steps, permission", () => {
  const forbidden = ["mode", "hidden", "temperature", "steps", "permission"];
  for (const f of forbidden) {
    assert.ok(!(f in (orchFM ?? {})), `orchestrator must not contain opencode field: ${f}`);
  }
});

test("qrspi-structure-mapper.md has no opencode-only frontmatter fields: mode, hidden, temperature, steps, permission", () => {
  const forbidden = ["mode", "hidden", "temperature", "steps", "permission"];
  for (const f of forbidden) {
    assert.ok(!(f in (mapperFM ?? {})), `mapper must not contain opencode field: ${f}`);
  }
});

test("qrspi-structure-reviewer.md has no opencode-only frontmatter fields: mode, hidden, temperature, steps, permission", () => {
  const forbidden = ["mode", "hidden", "temperature", "steps", "permission"];
  for (const f of forbidden) {
    assert.ok(!(f in (reviewFM ?? {})), `reviewer must not contain opencode field: ${f}`);
  }
});

// ---------------------------------------------------------------------------
// No placeholder content
// Exclude terms that appear inside backticks (literal examples of what to avoid)
// or as part of an instruction saying "these are invalid."
// ---------------------------------------------------------------------------

/**
 * Strip backtick-quoted spans from text before checking for placeholders.
 * This prevents false positives when files use "TBD", "TODO" etc. as
 * literal examples inside code spans showing what NOT to do.
 */
function stripBacktickQuoted(text: string): string {
  return text.replace(/`[^`]*`/g, "");
}

test("qrspi-structure.md body contains no placeholder content", () => {
  const cleaned = stripBacktickQuoted(orchBody);
  const patterns = [/TBD/i, /TODO/i, /details omitted/i, /same as above/i];
  for (const p of patterns) {
    assert.ok(!p.test(cleaned), `orchestrator body must not contain placeholder: ${p}`);
  }
});

test("qrspi-structure-mapper.md body contains no placeholder content", () => {
  const cleaned = stripBacktickQuoted(mapperBody);
  const patterns = [/TBD/i, /TODO/i, /details omitted/i, /same as above/i];
  for (const p of patterns) {
    assert.ok(!p.test(cleaned), `mapper body must not contain placeholder: ${p}`);
  }
});

test("qrspi-structure-reviewer.md body contains no placeholder content", () => {
  const cleaned = stripBacktickQuoted(reviewBody);
  const patterns = [/TBD/i, /TODO/i, /details omitted/i, /same as above/i];
  for (const p of patterns) {
    assert.ok(!p.test(cleaned), `reviewer body must not contain placeholder: ${p}`);
  }
});

// ---------------------------------------------------------------------------
// Orchestrator system prompt structure — 4 named steps
// ---------------------------------------------------------------------------

test("qrspi-structure.md body contains Step A — Read Inputs", () => {
  assert.ok(orchBody.includes("Step A"), "orchestrator body must contain Step A");
  assert.ok(/Step A.*Read Inputs/i.test(orchBody), "Step A must be 'Read Inputs'");
});

test("qrspi-structure.md body contains Step B — Dispatch Structure Mapper", () => {
  assert.ok(orchBody.includes("Step B"), "orchestrator body must contain Step B");
  assert.ok(/Step B.*Dispatch( Structure)? Mapper/i.test(orchBody),
    "Step B must be 'Dispatch Structure Mapper'");
});

test("qrspi-structure.md body contains Step C — Automated Review Loop", () => {
  assert.ok(orchBody.includes("Step C"), "orchestrator body must contain Step C");
  assert.ok(/Step C.*Automated Review( Loop)?/i.test(orchBody),
    "Step C must be 'Automated Review Loop'");
});

test("qrspi-structure.md body contains Step D — Approval Gate", () => {
  assert.ok(orchBody.includes("Step D"), "orchestrator body must contain Step D");
  assert.ok(/Step D.*Approval Gate/i.test(orchBody),
    "Step D must be 'Approval Gate'");
});

// ---------------------------------------------------------------------------
// Orchestrator Return section — PASS and FAIL branches
// ---------------------------------------------------------------------------

test("qrspi-structure.md body contains Return section with PASS branch", () => {
  assert.ok(orchBody.includes("### Status — PASS"),
    "orchestrator body must contain a PASS return branch");
});

test("qrspi-structure.md body contains Return section with FAIL branch", () => {
  assert.ok(orchBody.includes("### Status — FAIL"),
    "orchestrator body must contain a FAIL return branch");
});

// ---------------------------------------------------------------------------
// Dispatch contract preservation — qrspi_dispatch not Agent/task
// ---------------------------------------------------------------------------

test("qrspi-structure.md body references qrspi_dispatch for mapper dispatch", () => {
  assert.ok(orchBody.includes("qrspi_dispatch"),
    "orchestrator body must reference qrspi_dispatch tool");
  assert.ok(orchBody.includes("qrspi-structure-mapper"),
    "orchestrator body must reference qrspi-structure-mapper subagent type");
});

test("qrspi-structure.md body references qrspi_dispatch for reviewer dispatch", () => {
  assert.ok(orchBody.includes("qrspi-structure-reviewer"),
    "orchestrator body must reference qrspi-structure-reviewer subagent type");
});

// ---------------------------------------------------------------------------
// Human gate contract — qrspi_question not opencode question
// ---------------------------------------------------------------------------

test("qrspi-structure.md body references qrspi_question for human gate", () => {
  assert.ok(orchBody.includes("qrspi_question"),
    "orchestrator body must reference qrspi_question tool");
});

// ---------------------------------------------------------------------------
// Mapper system prompt structure — Inputs, Procedure (8 steps), Output Format, Invalid Outputs
// ---------------------------------------------------------------------------

test("qrspi-structure-mapper.md body contains Inputs section", () => {
  assert.ok(/###\s+Inputs?/i.test(mapperBody),
    "mapper body must contain an Inputs section");
});

test("qrspi-structure-mapper.md body contains Procedure section", () => {
  assert.ok(/###\s+Procedure/i.test(mapperBody),
    "mapper body must contain a Procedure section");
});

test("qrspi-structure-mapper.md body contains all 8 procedure steps", () => {
  const stepPatterns = [
    /(step\s*)?1[\.\)]\s*.*[Ii]nspect/i,
    /(step\s*)?2[\.\)]\s*.*[Aa]pply requirements/i,
    /(step\s*)?3[\.\)]\s*.*[Mm]ap.*slice/i,
    /(step\s*)?4[\.\)]\s*.*[Dd]efine.*interface/i,
    /(step\s*)?5[\.\)]\s*.*[Cc]ross.?slice.*depend/i,
    /(step\s*)?6[\.\)]\s*.*[Mm]ermaid/i,
    /(step\s*)?7[\.\)]\s*.*[Ii]ncorporate feedback/i,
    /(step\s*)?8[\.\)]\s*.*[Uu]ncertainty/i,
  ];
  for (const p of stepPatterns) {
    assert.ok(p.test(mapperBody), `mapper body must contain procedure step: ${p}`);
  }
});

test("qrspi-structure-mapper.md body contains Output Format section with # Structure template", () => {
  assert.ok(mapperBody.includes("# Structure"),
    "mapper body must contain the # Structure template");
  assert.ok(/###\s*Output Format/i.test(mapperBody),
    "mapper body must contain an Output Format section");
});

test("qrspi-structure-mapper.md body contains Invalid Outputs section with 7 checks", () => {
  assert.ok(/###\s*Invalid Outputs/i.test(mapperBody),
    "mapper body must contain an Invalid Outputs section");
  // Count bullet items in Invalid Outputs
  const invalidPart = mapperBody.split(/###\s*Invalid Outputs/i)[1] ?? "";
  const bulletCount = (invalidPart.match(/^[\s]*[-*]\s/gm) || []).length;
  assert.ok(bulletCount >= 7,
    `Invalid Outputs must have at least 7 checks, found ${bulletCount}`);
});

// ---------------------------------------------------------------------------
// Mapper tool reference adaptation — Read, find, ls, grep
// ---------------------------------------------------------------------------

test("qrspi-structure-mapper.md body instructs use of Read, find, ls, grep tools", () => {
  assert.ok(/Read/.test(mapperBody) || /read/i.test(mapperBody),
    "mapper body must reference Read tool for file reading");
  assert.ok(/find/i.test(mapperBody), "mapper body must reference find tool");
  assert.ok(/ls/i.test(mapperBody), "mapper body must reference ls tool");
  assert.ok(/grep/i.test(mapperBody), "mapper body must reference grep tool");
});

// ---------------------------------------------------------------------------
// Reviewer system prompt structure — Input, Review Checklist (9 areas), Output Format, Rules
// ---------------------------------------------------------------------------

test("qrspi-structure-reviewer.md body contains Input section", () => {
  assert.ok(/###\s*Input/i.test(reviewBody),
    "reviewer body must contain an Input section");
});

test("qrspi-structure-reviewer.md body contains Review Checklist section", () => {
  assert.ok(/###\s*Review Checklist/i.test(reviewBody),
    "reviewer body must contain a Review Checklist section");
});

test("qrspi-structure-reviewer.md body contains all 9 review checklist areas", () => {
  const areaPatterns = [
    /[Dd]esign alignment/i,
    /[Rr]equirements alignment/i,
    /[Ff]ile action correctness/i,
    /[Ii]nterface completeness/i,
    /[Ii]nterface compatibility/i,
    /[Cc]onvention adherence/i,
    /[Cc]ross.?slice dependency clarity/i,
    /[Dd]iagram quality/i,
    /[Gg]ranularity/i,
  ];
  for (const p of areaPatterns) {
    assert.ok(p.test(reviewBody), `reviewer body must contain checklist area: ${p}`);
  }
});

test("qrspi-structure-reviewer.md body contains Output Format section", () => {
  assert.ok(/###\s*Output Format/i.test(reviewBody),
    "reviewer body must contain an Output Format section");
});

test("qrspi-structure-reviewer.md body contains Rules section with 6 constraints", () => {
  assert.ok(/###\s*Rules/i.test(reviewBody),
    "reviewer body must contain a Rules section");
  // Rules are formatted with dash-prefixed items
  const rulesPart = reviewBody.split(/###\s*Rules/i)[1] ?? "";
  const ruleCount = (rulesPart.match(/^[\s]*[-]\s/gm) || []).length;
  assert.ok(ruleCount >= 6,
    `Rules section must have at least 6 constraints, found ${ruleCount}`);
});

// ---------------------------------------------------------------------------
// Reviewer tool reference adaptation — Read, find, ls, grep
// ---------------------------------------------------------------------------

test("qrspi-structure-reviewer.md body instructs use of Read, find, ls, grep tools", () => {
  assert.ok(/Read/.test(reviewBody) || /read/i.test(reviewBody),
    "reviewer body must reference Read tool for file reading");
  assert.ok(/find/i.test(reviewBody), "reviewer body must reference find tool");
  assert.ok(/ls/i.test(reviewBody), "reviewer body must reference ls tool");
  assert.ok(/grep/i.test(reviewBody), "reviewer body must reference grep tool");
});

// ---------------------------------------------------------------------------
// Open source files exist for completeness
// ---------------------------------------------------------------------------

test("opencode source file qrspi-structure.md exists and is non-empty", () => {
  const opencodePath = path.join(
    process.env.HOME ?? "/home/n3m6",
    ".config/opencode/agents/qrspi-structure.md"
  );
  assert.ok(fs.existsSync(opencodePath), "opencode source qrspi-structure.md must exist");
  const content = fs.readFileSync(opencodePath, "utf8");
  assert.ok(content.trim().length > 0, "opencode source qrspi-structure.md must be non-empty");
});

test("opencode source file qrspi-structure-mapper.md exists and is non-empty", () => {
  const opencodePath = path.join(
    process.env.HOME ?? "/home/n3m6",
    ".config/opencode/agents/qrspi-structure-mapper.md"
  );
  assert.ok(fs.existsSync(opencodePath), "opencode source qrspi-structure-mapper.md must exist");
  const content = fs.readFileSync(opencodePath, "utf8");
  assert.ok(content.trim().length > 0, "opencode source qrspi-structure-mapper.md must be non-empty");
});

test("opencode source file qrspi-structure-reviewer.md exists and is non-empty", () => {
  const opencodePath = path.join(
    process.env.HOME ?? "/home/n3m6",
    ".config/opencode/agents/qrspi-structure-reviewer.md"
  );
  assert.ok(fs.existsSync(opencodePath), "opencode source qrspi-structure-reviewer.md must exist");
  const content = fs.readFileSync(opencodePath, "utf8");
  assert.ok(content.trim().length > 0, "opencode source qrspi-structure-reviewer.md must be non-empty");
});

// ---------------------------------------------------------------------------
// Cross-file: all body files are non-empty
// ---------------------------------------------------------------------------

test("all three agent body files are non-empty", () => {
  const bodies: [string, string][] = [
    ["orchestrator", orchBody],
    ["mapper", mapperBody],
    ["reviewer", reviewBody],
  ];
  for (const [name, body] of bodies) {
    assert.ok(body.trim().length > 0, `${name} body must be non-empty`);
  }
});

// ---------------------------------------------------------------------------
// Mapper Example section
// ---------------------------------------------------------------------------

test("qrspi-structure-mapper.md body contains Example section", () => {
  assert.ok(/###\s*Example/i.test(mapperBody),
    "mapper body must contain an Example section");
});
