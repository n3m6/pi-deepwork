// Simple exact-file spec — pure parsing, no I/O.
// No node:* or pi imports.

export interface SimpleExactFileTask {
  filePath: string;
  content: string;
}

export function parseSimpleExactFileTask(text: string): SimpleExactFileTask | undefined {
  const filePath = extractFilePath(text);
  const content = extractExactContent(text);
  if (!filePath || content === undefined || !isSafeRelativePath(filePath)) {
    return undefined;
  }
  return { filePath, content };
}

export function isSafeRelativePath(filePath: string): boolean {
  if (!filePath || isAbsolutePath(filePath) || filePath.includes("\\")) {
    return false;
  }
  const segments = filePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return false;
  }
  if (segments.some((segment) => segment === ".git" || segment === ".pipeline" || segment === "node_modules")) {
    return false;
  }
  return /^[A-Za-z0-9._/-]+$/.test(filePath);
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/");
}

function extractFilePath(text: string): string | undefined {
  const patterns = [
    /\b(?:create|write|add)\s+(?:an?\s+)?([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+)\s+file\b/i,
    /\bfile\s+(?:named|called)\s+`?([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+)`?/i,
    /`([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+)`\s+(?:file|exists|must|should|is)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const fp = match?.[1]?.trim();
    if (fp) {
      return fp;
    }
  }

  return undefined;
}

function extractExactContent(text: string): string | undefined {
  const patterns = [
    /\bcontent\s+(?:is|must be|be)\s+exactly\s+(?:the\s+sentence\s+)?[`"]([^`"\n]+)[`"]/i,
    /\bcontains?\s+exactly\s+(?:the\s+sentence\s+)?[`"]([^`"\n]+)[`"]/i,
    /\bcontaining\s+exactly\s+one\s+sentence:\s*[`"]?([^\n`"]+?)[`"]?(?:\s*$|\s*\n)/i,
    /\bexactly\s+one\s+sentence:\s*[`"]?([^\n`"]+?)[`"]?(?:\s*$|\s*\n)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const content = match?.[1]?.trim();
    if (content) {
      return content;
    }
  }

  return undefined;
}
