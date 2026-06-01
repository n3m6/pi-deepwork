export interface SectionMap {
  [heading: string]: string;
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function parseMarkdownSections(markdown: string): SectionMap {
  const lines = normalizeNewlines(markdown).split("\n");
  const sections: SectionMap = {};
  let current: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (!current) {
      return;
    }
    sections[current] = buffer.join("\n").trim();
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(/^###\s+(.+?)\s*$/);
    if (match) {
      flush();
      current = match[1];
      continue;
    }
    if (current) {
      buffer.push(line);
    }
  }

  flush();
  return sections;
}

export function parseFrontmatterDate(markdown: string): string | undefined {
  const match = normalizeNewlines(markdown).match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return undefined;
  }
  const frontmatterBlock = match[1] ?? "";
  const created = frontmatterBlock.match(/^created:\s*(.+)$/m);
  return created?.[1]?.trim();
}

export function parseKeyValueLines(markdown: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of normalizeNewlines(markdown).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) {
      const key = match[1];
      const value = match[2];
      if (key && value) {
        values[key] = value.trim();
      }
    }
  }
  return values;
}

export function asOneLine(text: string): string {
  return normalizeNewlines(text).split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
}

export function extractStatusLine(markdown: string): string | undefined {
  return normalizeNewlines(markdown).match(/^### Status\s+[—-]\s+(.+)$/m)?.[1]?.trim();
}

export function extractSummary(markdown: string): string {
  const sections = parseMarkdownSections(markdown);
  return sections.Summary ? asOneLine(sections.Summary) : asOneLine(markdown).slice(0, 240);
}

export function extractCodeBlock(markdown: string): string | undefined {
  const match = normalizeNewlines(markdown).match(/```(?:[a-z]+)?\n([\s\S]*?)\n```/);
  return match?.[1];
}

export function parsePipeTable(markdown: string): string[][] {
  const rows = normalizeNewlines(markdown)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  return rows
    .filter((line) => !/^(\|\s*-+\s*)+\|$/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}
