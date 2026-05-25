import * as fs from "node:fs";
import * as path from "node:path";

import type { FileSystemPort } from "../../ports/file-system";

export function createDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function writeTextFile(filePath: string, content: string): void {
  createDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf-8");
}

export function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readDirectoryNames(dirPath: string): string[] {
  return fs.readdirSync(dirPath);
}

export const nodeFileSystem: FileSystemPort = {
  createDirectory,
  writeTextFile,
  readTextFile,
  fileExists,
  readDirectoryNames,
};
