import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = path.resolve(__dirname, "..", "..", "..");
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

const orchestratorPath = path.join(agentsDir, "qrspi-goals.md");
const synthesizerPath = path.join(agentsDir, "qrspi-goals-synthesizer.md");
const reviewerPath = path.join(agentsDir, "qrspi-goals-reviewer.md");

const orchFM = parseFrontmatter(orchestratorPath);
const synthFM = parseFrontmatter(synthesizerPath);
const reviewFM = parseFrontmatter(reviewerPath);

const orchBody = getBody(orchestratorPath);
const synthBody = getBody(synthesizerPath);
const reviewBody = getBody(reviewerPath);

// ---------------------------------------------------------------------------
// Preamble: files exist and have parseable frontmatter
// ---------------------------------------------------------------------------

test("qrspi-goals.md exists and has parseable frontmatter", () => {
  assert.ok(orchFM !== null, "qrspi-goals.md frontmatter must be parseable");
});

test("qrspi-goals-synthesizer.md exists and has parseable frontmatter", () => {
  assert.ok(synthFM !== null, "qrspi-goals-synthesizer.md frontmatter must be parseable");
});

test("qrspi-goals-reviewer.md exists and has parseable frontmatter", () => {
  assert.ok(reviewFM !== null, "qrspi-goals-reviewer.md frontmatter must be parseable");
});

// ---------------------------------------------------------------------------
// qrspi-goals.md — Required fields
// ---------------------------------------------------------------------------

test("qrspi-goals.md frontmatter has required field: description", () => {
  const val = getField(orchFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-goals.md frontmatter has required field: tools", () => {
  const val = getField(orchFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-goals.md frontmatter has required field: model", () => {
  const val = getField(orchFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-goals.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(orchFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-goals.md frontmatter tools is 'all' or comma-separated list", () => {
  const val = getField(orchFM, "tools");
  assert.ok(val === "all" || val.includes(","));
});

test("qrspi-goals.md body is non-empty (system prompt body exists)", () => {
  assert.ok(orchBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

// ---------------------------------------------------------------------------
// qrspi-goals-synthesizer.md — Required fields
// ---------------------------------------------------------------------------

test("qrspi-goals-synthesizer.md frontmatter has required field: description", () => {
  const val = getField(synthFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-goals-synthesizer.md frontmatter has required field: tools", () => {
  const val = getField(synthFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-goals-synthesizer.md frontmatter has required field: model", () => {
  const val = getField(synthFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-goals-synthesizer.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(synthFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-goals-synthesizer.md body is non-empty (system prompt body exists)", () => {
  assert.ok(synthBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

// ---------------------------------------------------------------------------
// qrspi-goals-reviewer.md — Required fields
// ---------------------------------------------------------------------------

test("qrspi-goals-reviewer.md frontmatter has required field: description", () => {
  const val = getField(reviewFM, "description");
  assert.ok(val.length > 0, "description must be non-empty");
});

test("qrspi-goals-reviewer.md frontmatter has required field: tools", () => {
  const val = getField(reviewFM, "tools");
  assert.ok(val.length > 0, "tools must be non-empty");
});

test("qrspi-goals-reviewer.md frontmatter has required field: model", () => {
  const val = getField(reviewFM, "model");
  assert.ok(val.length > 0, "model must be non-empty");
});

test("qrspi-goals-reviewer.md frontmatter has required field: max_turns (positive integer)", () => {
  const val = getField(reviewFM, "max_turns");
  const num = parseInt(val, 10);
  assert.ok(!isNaN(num) && num > 0, `max_turns must be a positive integer, got: ${val}`);
});

test("qrspi-goals-reviewer.md body is non-empty (system prompt body exists)", () => {
  assert.ok(reviewBody.trim().length > 0, "system prompt body must not be empty or whitespace-only");
});

// ---------------------------------------------------------------------------
// Cross-file: model field is non-empty string
// ---------------------------------------------------------------------------

test("all three agent files have non-empty model strings", () => {
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

// ---------------------------------------------------------------------------
// Cross-file: max_turns is a positive integer
// ---------------------------------------------------------------------------

test("all three agent files have positive integer max_turns", () => {
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
