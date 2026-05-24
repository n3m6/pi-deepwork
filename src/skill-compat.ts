import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SkillCompatInstallResult {
  applied: boolean;
  mode?: "symlink" | "copied" | "existing";
  targetRoot?: string;
  error?: string;
}

interface SkillCompatLayout {
  sourceRoot: string;
  targetRoot: string;
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasRuntimeSkillLayout(candidateRoot: string): boolean {
  return (
    pathExists(path.join(candidateRoot, "package.json")) &&
    pathExists(path.join(candidateRoot, "skills", "deepwork", "SKILL.md"))
  );
}

export function getRuntimePackageRoot(moduleDir: string = __dirname): string {
  const candidates = [
    path.resolve(moduleDir, ".."),
    path.resolve(moduleDir, "..", ".."),
  ];

  for (const candidate of candidates) {
    if (hasRuntimeSkillLayout(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

export function getGitInstallCompatLayout(
  packageRoot: string,
  homeDir: string = os.homedir(),
): { sourceRoot: string; targetRoot: string } | null {
  const gitGithubRoot = path.join(homeDir, ".pi", "agent", "git", "github.com");
  const relative = path.relative(gitGithubRoot, packageRoot);

  if (
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const [owner, repo] = parts;
  if (owner === undefined || repo === undefined) {
    return null;
  }

  return {
    sourceRoot: packageRoot,
    targetRoot: path.join(
      homeDir,
      ".pi",
      "agent",
      "npm",
      "node_modules",
      `@${owner}`,
      repo,
    ),
  };
}

function copyDirectoryWithoutOverwrite(
  sourceDir: string,
  targetDir: string,
): void {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryWithoutOverwrite(sourcePath, targetPath);
      continue;
    }

    if (!pathExists(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copySkillCompatPayload(layout: SkillCompatLayout): void {
  fs.mkdirSync(layout.targetRoot, { recursive: true });

  const sourcePackagePath = path.join(layout.sourceRoot, "package.json");
  const targetPackagePath = path.join(layout.targetRoot, "package.json");
  if (pathExists(sourcePackagePath) && !pathExists(targetPackagePath)) {
    fs.copyFileSync(sourcePackagePath, targetPackagePath);
  }

  copyDirectoryWithoutOverwrite(
    path.join(layout.sourceRoot, "skills"),
    path.join(layout.targetRoot, "skills"),
  );
}

export function ensureSkillCompatInstall(
  packageRoot: string,
  homeDir: string = os.homedir(),
): SkillCompatInstallResult {
  const layout = getGitInstallCompatLayout(packageRoot, homeDir);
  if (layout === null) {
    return { applied: false };
  }

  const targetSkillPath = path.join(
    layout.targetRoot,
    "skills",
    "deepwork",
    "SKILL.md",
  );

  if (pathExists(layout.targetRoot) && pathExists(targetSkillPath)) {
    return {
      applied: true,
      mode: "existing",
      targetRoot: layout.targetRoot,
    };
  }

  fs.mkdirSync(path.dirname(layout.targetRoot), { recursive: true });

  if (!pathExists(layout.targetRoot)) {
    try {
      fs.symlinkSync(layout.sourceRoot, layout.targetRoot, "dir");
      return {
        applied: true,
        mode: "symlink",
        targetRoot: layout.targetRoot,
      };
    } catch {
      // Fall back to a small compatibility mirror when symlink creation fails.
    }
  }

  try {
    copySkillCompatPayload(layout);
    return {
      applied: true,
      mode: pathExists(layout.targetRoot) ? "copied" : "existing",
      targetRoot: layout.targetRoot,
    };
  } catch (error: unknown) {
    return {
      applied: false,
      targetRoot: layout.targetRoot,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function ensureRuntimeSkillCompatInstall(
  moduleDir: string = __dirname,
  homeDir: string = os.homedir(),
): SkillCompatInstallResult {
  return ensureSkillCompatInstall(getRuntimePackageRoot(moduleDir), homeDir);
}
