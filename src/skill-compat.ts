import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SkillCompatInstallResult {
  applied: boolean;
  mode?: "symlink" | "copied" | "existing";
  targetRoot?: string;
  skillPath?: string;
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

// Resolves through symlinks to verify the underlying file is actually readable.
// `pathExists` only reports whether a directory entry exists, so a broken
// symlink will still return `true`. We use this for SKILL.md verification so a
// dangling compat symlink (or partially-mirrored compat directory) does not get
// reported as a successful install.
function fileIsReadable(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
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

// Best-effort removal of a stale compat target. Handles broken symlinks
// (which fs.rmSync with `force:true` silently leaves behind because it
// follows the link before unlinking) by falling back to `unlinkSync`.
function removeCompatTarget(target: string): void {
  try {
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink() || stats.isFile()) {
      fs.unlinkSync(target);
      return;
    }
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // Best-effort — surface failures via the subsequent symlink/copy attempts.
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

  // `existing` only counts if the SKILL.md is actually readable. A directory
  // entry that exists but resolves to a missing file (broken symlink or partial
  // mirror from a previous failed install) must be recovered, not reported as
  // healthy.
  if (pathExists(layout.targetRoot) && fileIsReadable(targetSkillPath)) {
    return {
      applied: true,
      mode: "existing",
      targetRoot: layout.targetRoot,
      skillPath: targetSkillPath,
    };
  }

  // Drop a stale targetRoot that does not produce a readable SKILL.md so the
  // symlink/copy branches below can re-create it cleanly.
  if (pathExists(layout.targetRoot) && !fileIsReadable(targetSkillPath)) {
    removeCompatTarget(layout.targetRoot);
  }

  fs.mkdirSync(path.dirname(layout.targetRoot), { recursive: true });

  if (!pathExists(layout.targetRoot)) {
    try {
      fs.symlinkSync(layout.sourceRoot, layout.targetRoot, "dir");
      if (fileIsReadable(targetSkillPath)) {
        return {
          applied: true,
          mode: "symlink",
          targetRoot: layout.targetRoot,
          skillPath: targetSkillPath,
        };
      }
      // Symlink created but target SKILL.md is unreadable (source missing or
      // dangling). Remove the link and fall through to the copy branch.
      removeCompatTarget(layout.targetRoot);
    } catch {
      // Fall back to a small compatibility mirror when symlink creation fails.
    }
  }

  try {
    copySkillCompatPayload(layout);
    if (!fileIsReadable(targetSkillPath)) {
      return {
        applied: false,
        targetRoot: layout.targetRoot,
        skillPath: targetSkillPath,
        error: `Compatibility mirror at ${layout.targetRoot} did not produce a readable SKILL.md.`,
      };
    }
    return {
      applied: true,
      mode: pathExists(layout.targetRoot) ? "copied" : "existing",
      targetRoot: layout.targetRoot,
      skillPath: targetSkillPath,
    };
  } catch (error: unknown) {
    return {
      applied: false,
      targetRoot: layout.targetRoot,
      skillPath: targetSkillPath,
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
