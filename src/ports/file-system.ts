export interface FileSystemPort {
  createDirectory(dirPath: string): void;
  writeTextFile(filePath: string, content: string): void;
  readTextFile(filePath: string): string;
  fileExists(filePath: string): boolean;
  readDirectoryNames(dirPath: string): string[];
}
