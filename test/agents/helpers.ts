import * as fs from "node:fs";
import * as path from "node:path";

export const projectRoot = process.cwd();
export const agentsDir = path.join(projectRoot, "agents");

export const ENABLED_AGENT_FIELDS = [
  "description",
  "enabled",
  "extensions",
  "max_turns",
  "model",
  "name",
  "prompt_mode",
  "systemPromptMode",
  "thinking",
  "tools",
].sort();

export function readAgent(name: string): string {
  return fs.readFileSync(path.join(agentsDir, name), "utf8");
}

export function parseFrontmatter(name: string): Record<string, string> {
  const raw = readAgent(name);
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
    throw new Error(`Missing parseable frontmatter in ${name}`);
  }

  const frontmatter: Record<string, string> = {};
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return frontmatter;
}

export function getBody(name: string): string {
  const raw = readAgent(name);
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

  return closeIdx === -1 ? raw : lines.slice(closeIdx + 1).join("\n");
}