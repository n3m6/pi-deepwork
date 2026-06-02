import { readFile } from "node:fs/promises";
import path from "node:path";

import type { StageRuntime } from "./types.js";

export interface SimpleExactFileTask {
  filePath: string;
  content: string;
}

export async function detectSimpleExactFileTask(runtime: StageRuntime): Promise<SimpleExactFileTask | undefined> {
  if (runtime.state.route !== "quick-fix" && runtime.state.route !== "unknown") {
    return undefined;
  }

  const candidates = [
    runtime.state.userTask ?? "",
    await readOptional(runtime.artifacts.goalsFile),
    await readOptional(runtime.artifacts.requirementsFile),
  ];

  for (const candidate of candidates) {
    const task = parseSimpleExactFileTask(candidate);
    if (task) {
      return task;
    }
  }

  return undefined;
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
  if (!filePath || path.isAbsolute(filePath) || filePath.includes("\\")) {
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

function extractFilePath(text: string): string | undefined {
  const patterns = [
    /\b(?:create|write|add)\s+(?:an?\s+)?([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+)\s+file\b/i,
    /\bfile\s+(?:named|called)\s+`?([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+)`?/i,
    /`([A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+)`\s+(?:file|exists|must|should|is)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const filePath = match?.[1]?.trim();
    if (filePath) {
      return filePath;
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

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
