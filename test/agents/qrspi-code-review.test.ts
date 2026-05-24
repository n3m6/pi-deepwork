import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = process.cwd();
const agentPath = path.join(projectRoot, "agents", "qrspi-code-review.md");
const raw = fs.readFileSync(agentPath, "utf8");

function parseFrontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "expected YAML frontmatter");

  const frontmatter = match[1]!;
  const parsed: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) {
      parsed[key] = value;
    }
  }
  return parsed;
}

function getBody(text: string): string {
  const match = text.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1]! : text;
}

const frontmatter = parseFrontmatter(raw);
const body = getBody(raw);

test("qrspi-code-review.md tools expose dispatch and result join helpers", () => {
  assert.equal(
    frontmatter.tools,
    "read, bash, grep, find, ls, write, edit, qrspi_dispatch, qrspi_get_subagent_result",
  );
});

test("qrspi-code-review.md body uses background launch plus result joins", () => {
  assert.match(body, /run_in_background: true/);
  assert.match(body, /qrspi_get_subagent_result/);
  assert.match(body, /Launch each selected reviewer/);
});