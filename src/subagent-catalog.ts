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

export interface BundledAgentSyncResult {
  projectAgentsDir: string;
  synced: string[];
  skipped: string[];
}

export interface RegistryRefreshResult {
  refreshed: boolean;
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

    if (fs.existsSync(targetPath)) {
      skipped.push(fileName);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    synced.push(fileName);
  }

  return {
    projectAgentsDir,
    synced,
    skipped,
  };
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

export function refreshSubagentRegistry(
  workspaceRoot: string,
): RegistryRefreshResult {
  const customAgentsModule = loadFirstAvailableModule(
    buildModuleCandidates(workspaceRoot, "dist/custom-agents.js"),
  );
  const agentTypesModule = loadFirstAvailableModule(
    buildModuleCandidates(workspaceRoot, "dist/agent-types.js"),
  );

  if (customAgentsModule === undefined || agentTypesModule === undefined) {
    return {
      refreshed: false,
      error: "Unable to load the pi-subagents internal agent registry modules.",
    };
  }

  const loadCustomAgents = (customAgentsModule as CustomAgentsModule)
    .loadCustomAgents;
  const registerAgents = (agentTypesModule as AgentTypesModule).registerAgents;

  if (
    typeof loadCustomAgents !== "function" ||
    typeof registerAgents !== "function"
  ) {
    return {
      refreshed: false,
      error:
        "The pi-subagents install does not expose compatible registry helpers.",
    };
  }

  try {
    registerAgents(loadCustomAgents(workspaceRoot));
    return { refreshed: true };
  } catch (error: unknown) {
    return {
      refreshed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
