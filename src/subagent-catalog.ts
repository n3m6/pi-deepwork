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

function normalizeAgentMarkdown(content: string): string {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

function buildCompatibleBundledAgentContent(
  fileName: string,
  sourceContent: string,
): string {
  const normalized = sourceContent.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return normalized;
  }

  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return normalized;
  }

  const frontmatterLines = normalized.slice(4, endIndex).split("\n");
  const body = normalized.slice(endIndex + 5);
  const compatibleFrontmatter: string[] = [];
  let hasName = false;
  let hasSystemPromptMode = false;
  let promptMode: string | undefined;

  for (const line of frontmatterLines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("name:")) {
      hasName = true;
    }

    if (trimmed.startsWith("systemPromptMode:")) {
      hasSystemPromptMode = true;
    }

    if (trimmed.startsWith("prompt_mode:")) {
      const value = trimmed.slice("prompt_mode:".length).trim();
      if (value.length > 0) {
        promptMode = value;
      }
    }

    if (/^extensions:\s*false\s*$/i.test(trimmed)) {
      compatibleFrontmatter.push("extensions:");
      continue;
    }

    compatibleFrontmatter.push(line);
  }

  if (!hasName) {
    compatibleFrontmatter.unshift(`name: ${fileName.replace(/\.md$/, "")}`);
  }

  if (!hasSystemPromptMode && promptMode !== undefined) {
    compatibleFrontmatter.push(`systemPromptMode: ${promptMode}`);
  }

  return `---\n${compatibleFrontmatter.join("\n")}\n---\n${body}`;
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

    const sourceContent = fs.readFileSync(sourcePath, "utf-8");
    const compatibleContent = buildCompatibleBundledAgentContent(
      fileName,
      sourceContent,
    );
    const normalizedSourceContent = normalizeAgentMarkdown(sourceContent);
    const normalizedCompatibleContent =
      normalizeAgentMarkdown(compatibleContent);

    if (fs.existsSync(targetPath)) {
      const targetContent = normalizeAgentMarkdown(
        fs.readFileSync(targetPath, "utf-8"),
      );

      if (targetContent === normalizedCompatibleContent) {
        skipped.push(fileName);
        continue;
      }

      if (targetContent !== normalizedSourceContent) {
        skipped.push(fileName);
        continue;
      }
    }

    fs.writeFileSync(targetPath, compatibleContent, "utf-8");
    synced.push(fileName);
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
