import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

type ModuleLoader = (moduleId: string) => unknown;

interface CustomAgentsModule {
  loadCustomAgents(cwd: string): Map<string, unknown>;
}

interface AgentTypesModule {
  registerAgents(userAgents: Map<string, unknown>): void;
}

interface RegistryHelper {
  layout: string;
  loadCustomAgents(cwd: string): Map<string, unknown>;
  registerAgents(userAgents: Map<string, unknown>): void;
}

export const REQUIRED_QRSPI_STAGE_AGENTS = [
  "qrspi-goals",
  "qrspi-research",
  "qrspi-design",
  "qrspi-structure",
  "qrspi-plan",
  "qrspi-implement",
  "qrspi-accept",
  "qrspi-replan",
  "qrspi-verify",
  "qrspi-report",
] as const;

export interface BundledAgentSyncResult {
  bundledAgentsDir: string;
  projectAgentsDir: string;
  total: number;
  synced: string[];
  skipped: string[];
  missingRequired: string[];
}

export interface RegistryRefreshResult {
  refreshed: boolean;
  agentNames: string[];
  layouts: string[];
  error?: string;
}

export interface RegisteredSubagentsResult {
  ok: boolean;
  projectAgentsDir: string;
  missingProjectAgents: string[];
  missingRegisteredAgents: string[];
  syncResult?: BundledAgentSyncResult;
  refreshResult?: RegistryRefreshResult;
  error?: string;
}

const runtimeRequire = createRequire(__filename);

let moduleLoader: ModuleLoader = (moduleId) => runtimeRequire(moduleId);

export function __setSubagentModuleLoaderForTests(loader?: ModuleLoader): void {
  moduleLoader = loader ?? ((moduleId: string) => runtimeRequire(moduleId));
}

function getBundledAgentsDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "agents"),
    path.resolve(__dirname, "..", "..", "agents"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

function normalizeWorkspaceRoot(workspaceRoot: string | undefined): string {
  if (typeof workspaceRoot === "string" && workspaceRoot.trim().length > 0) {
    return workspaceRoot;
  }

  return process.cwd();
}

export function getProjectAgentsDir(workspaceRoot: string): string {
  return path.join(normalizeWorkspaceRoot(workspaceRoot), ".pi", "agents");
}

export function ensureBundledProjectAgents(
  workspaceRoot: string,
): BundledAgentSyncResult {
  const resolvedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const bundledAgentsDir = getBundledAgentsDir();
  const projectAgentsDir = getProjectAgentsDir(resolvedWorkspaceRoot);

  fs.mkdirSync(projectAgentsDir, { recursive: true });

  const synced: string[] = [];
  const skipped: string[] = [];
  const bundledAgentFiles = fs
    .readdirSync(bundledAgentsDir)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort();

  for (const fileName of bundledAgentFiles) {
    const sourcePath = path.join(bundledAgentsDir, fileName);
    const targetPath = path.join(projectAgentsDir, fileName);

    if (mirrorBundledAgent(sourcePath, targetPath)) {
      synced.push(fileName);
    } else {
      skipped.push(fileName);
    }
  }

  const missingRequired = findMissingProjectAgents(
    projectAgentsDir,
    REQUIRED_QRSPI_STAGE_AGENTS,
  );

  return {
    bundledAgentsDir,
    projectAgentsDir,
    total: bundledAgentFiles.length,
    synced,
    skipped,
    missingRequired,
  };
}

/**
 * Mirror a single bundled agent file into the workspace's `.pi/agents/` dir.
 *
 * Prefers a symlink so updates to bundled agents flow through automatically and
 * we don't accumulate stale duplicates. Falls back to a copy on platforms where
 * symlinks fail (e.g. Windows without developer mode, certain CI sandboxes).
 *
 * Returns true if the target was created or updated, false if it was left
 * untouched (already correct, or user-customized).
 */
function mirrorBundledAgent(sourcePath: string, targetPath: string): boolean {
  let targetStat: fs.Stats | undefined;
  try {
    targetStat = fs.lstatSync(targetPath);
  } catch {
    targetStat = undefined;
  }

  if (targetStat?.isSymbolicLink()) {
    try {
      const currentLink = fs.readlinkSync(targetPath);
      const resolvedLink = path.isAbsolute(currentLink)
        ? currentLink
        : path.resolve(path.dirname(targetPath), currentLink);
      if (resolvedLink === sourcePath) {
        return false;
      }
    } catch {
      // fall through and replace
    }
    fs.rmSync(targetPath);
    return writeMirror(sourcePath, targetPath);
  }

  if (targetStat?.isFile()) {
    // Replace any file whose YAML frontmatter declares the same `name:` we
    // would emit. This treats stale mirrors (including those produced by older
    // versions of this extension) as managed and refreshes them to symlinks.
    // Files without that fingerprint are treated as user customization and
    // left untouched.
    const expectedName = path.basename(targetPath).replace(/\.md$/, "");
    const targetContent = fs.readFileSync(targetPath, "utf-8");
    if (frontmatterDeclaresName(targetContent, expectedName)) {
      fs.rmSync(targetPath);
      return writeMirror(sourcePath, targetPath);
    }
    return false;
  }

  return writeMirror(sourcePath, targetPath);
}

function frontmatterDeclaresName(
  content: string,
  expectedName: string,
): boolean {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return false;
  }
  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return false;
  }
  const frontmatter = normalized.slice(4, endIndex);
  for (const line of frontmatter.split("\n")) {
    const match = /^\s*name\s*:\s*(.+?)\s*$/.exec(line);
    if (match) {
      // Strip optional surrounding quotes.
      const value = match[1]!.replace(/^["']|["']$/g, "");
      return value === expectedName;
    }
  }
  return false;
}

function writeMirror(sourcePath: string, targetPath: string): boolean {
  try {
    fs.symlinkSync(sourcePath, targetPath, "file");
    return true;
  } catch {
    fs.copyFileSync(sourcePath, targetPath);
    return true;
  }
}

function findMissingProjectAgents(
  projectAgentsDir: string,
  agentNames: ReadonlyArray<string>,
): string[] {
  return [...new Set(agentNames)]
    .filter(
      (agentName) =>
        !fs.existsSync(path.join(projectAgentsDir, `${agentName}.md`)),
    )
    .sort();
}

function getPiSubagentsCandidateRoots(workspaceRoot: string): string[] {
  const resolvedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const candidates = [
    path.join(
      resolvedWorkspaceRoot,
      ".pi",
      "npm",
      "node_modules",
      "@tintinweb",
      "pi-subagents",
    ),
    path.join(
      resolvedWorkspaceRoot,
      ".pi",
      "git",
      "github.com",
      "tintinweb",
      "pi-subagents",
    ),
    path.join(
      os.homedir(),
      ".pi",
      "agent",
      "npm",
      "node_modules",
      "@tintinweb",
      "pi-subagents",
    ),
    path.join(
      os.homedir(),
      ".pi",
      "agent",
      "git",
      "github.com",
      "tintinweb",
      "pi-subagents",
    ),
    path.resolve(__dirname, "..", "node_modules", "@tintinweb", "pi-subagents"),
    path.resolve(
      __dirname,
      "..",
      "..",
      "node_modules",
      "@tintinweb",
      "pi-subagents",
    ),
  ];

  return [...new Set(candidates)].filter((candidate) =>
    fs.existsSync(candidate),
  );
}

function buildModuleCandidates(
  workspaceRoot: string,
  relativeModulePath: string,
): string[] {
  const bareCandidates = [`@tintinweb/pi-subagents/${relativeModulePath}`];
  const rootedCandidates = getPiSubagentsCandidateRoots(workspaceRoot).map(
    (root) => path.join(root, relativeModulePath),
  );

  return [...bareCandidates, ...rootedCandidates];
}

function loadFirstAvailableModule(candidates: string[]): unknown | undefined {
  for (const candidate of candidates) {
    try {
      return moduleLoader(candidate);
    } catch {
      // Try the next install layout.
    }
  }

  return undefined;
}

function loadRegistryHelpers(workspaceRoot: string): {
  helpers: RegistryHelper[];
  errors: string[];
} {
  const helpers: RegistryHelper[] = [];
  const errors: string[] = [];
  const layouts = [
    {
      label: "source",
      customAgentsModulePath: "src/custom-agents.ts",
      agentTypesModulePath: "src/agent-types.ts",
    },
    {
      label: "dist",
      customAgentsModulePath: "dist/custom-agents.js",
      agentTypesModulePath: "dist/agent-types.js",
    },
  ] as const;

  for (const layout of layouts) {
    const customAgentsModule = loadFirstAvailableModule(
      buildModuleCandidates(workspaceRoot, layout.customAgentsModulePath),
    );
    const agentTypesModule = loadFirstAvailableModule(
      buildModuleCandidates(workspaceRoot, layout.agentTypesModulePath),
    );

    if (customAgentsModule === undefined || agentTypesModule === undefined) {
      continue;
    }

    const loadCustomAgents = (customAgentsModule as CustomAgentsModule)
      .loadCustomAgents;
    const registerAgents = (agentTypesModule as AgentTypesModule)
      .registerAgents;

    if (
      typeof loadCustomAgents !== "function" ||
      typeof registerAgents !== "function"
    ) {
      errors.push(
        `The pi-subagents ${layout.label} registry helpers are incompatible.`,
      );
      continue;
    }

    helpers.push({
      layout: layout.label,
      loadCustomAgents,
      registerAgents,
    });
  }

  return { helpers, errors };
}

export function refreshSubagentRegistry(
  workspaceRoot: string,
): RegistryRefreshResult {
  const resolvedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  const { helpers, errors } = loadRegistryHelpers(resolvedWorkspaceRoot);

  if (helpers.length === 0) {
    return {
      refreshed: false,
      agentNames: [],
      layouts: [],
      error:
        errors[0] ??
        "Unable to load the pi-subagents internal agent registry modules.",
    };
  }

  const refreshErrors: string[] = [];
  const refreshedLayouts: string[] = [];
  const agentNames = new Set<string>();

  try {
    for (const helper of helpers) {
      try {
        const userAgents = helper.loadCustomAgents(resolvedWorkspaceRoot);
        helper.registerAgents(userAgents);
        refreshedLayouts.push(helper.layout);
        for (const agentName of userAgents.keys()) {
          agentNames.add(agentName);
        }
      } catch (error: unknown) {
        refreshErrors.push(
          `${helper.layout}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (refreshErrors.length < helpers.length) {
      const result: RegistryRefreshResult = {
        refreshed: true,
        agentNames: [...agentNames].sort(),
        layouts: refreshedLayouts,
      };
      if (refreshErrors.length > 0) {
        result.error = refreshErrors.join("; ");
      }
      return result;
    }

    return {
      refreshed: false,
      agentNames: [...agentNames].sort(),
      layouts: refreshedLayouts,
      error: refreshErrors.join("; "),
    };
  } catch (error: unknown) {
    return {
      refreshed: false,
      agentNames: [...agentNames].sort(),
      layouts: refreshedLayouts,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function ensureRegisteredSubagents(
  workspaceRoot: string,
  requiredNames: ReadonlyArray<string> = REQUIRED_QRSPI_STAGE_AGENTS,
): RegisteredSubagentsResult {
  const projectAgentsDir = getProjectAgentsDir(workspaceRoot);
  const uniqueRequiredNames = [...new Set(requiredNames)].sort();

  let syncResult: BundledAgentSyncResult;
  try {
    syncResult = ensureBundledProjectAgents(workspaceRoot);
  } catch (error: unknown) {
    return {
      ok: false,
      projectAgentsDir,
      missingProjectAgents: uniqueRequiredNames,
      missingRegisteredAgents: uniqueRequiredNames,
      error: `Failed to mirror bundled QRSPI agent definitions under ${projectAgentsDir}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const missingProjectAgents = findMissingProjectAgents(
    syncResult.projectAgentsDir,
    uniqueRequiredNames,
  );
  if (missingProjectAgents.length > 0) {
    return {
      ok: false,
      projectAgentsDir: syncResult.projectAgentsDir,
      missingProjectAgents,
      missingRegisteredAgents: missingProjectAgents,
      syncResult,
      error: `Missing mirrored QRSPI agent definitions under ${syncResult.projectAgentsDir}: ${missingProjectAgents.join(", ")}`,
    };
  }

  const refreshResult = refreshSubagentRegistry(workspaceRoot);
  if (!refreshResult.refreshed) {
    return {
      ok: false,
      projectAgentsDir: syncResult.projectAgentsDir,
      missingProjectAgents: [],
      missingRegisteredAgents: uniqueRequiredNames,
      syncResult,
      refreshResult,
      error:
        refreshResult.error ??
        "Unable to refresh the pi-subagents custom-agent registry.",
    };
  }

  const registeredNames = new Set(refreshResult.agentNames);
  const missingRegisteredAgents = uniqueRequiredNames.filter(
    (agentName) => !registeredNames.has(agentName),
  );
  if (missingRegisteredAgents.length > 0) {
    return {
      ok: false,
      projectAgentsDir: syncResult.projectAgentsDir,
      missingProjectAgents: [],
      missingRegisteredAgents,
      syncResult,
      refreshResult,
      error: `QRSPI agent definitions were mirrored under ${syncResult.projectAgentsDir}, but pi-subagents did not register: ${missingRegisteredAgents.join(", ")}`,
    };
  }

  return {
    ok: true,
    projectAgentsDir: syncResult.projectAgentsDir,
    missingProjectAgents: [],
    missingRegisteredAgents: [],
    syncResult,
    refreshResult,
  };
}
