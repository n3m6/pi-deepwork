import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentToolResult, ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createAskHumanTool } from "../../src/infrastructure/pi/human-gate.js";
import { createStageReturnTool, normalizeStageReturn, type StageReturnPayload } from "../../src/infrastructure/pi/stage-return-tool.js";

import { loadAgentDefinitions } from "../../src/infrastructure/pi/agent-catalog.js";
import { ensureRunDirectories, getRunArtifacts, type RunArtifacts } from "../../src/infrastructure/fs/artifact-repository.js";
import { createRunId } from "../../src/infrastructure/system/id-generator.js";
import { createInitialState } from "../../src/domain/run/index.js";
import { FileSystemArtifactRepository } from "../../src/infrastructure/fs/artifact-repository.js";
import { FileSystemRunStateRepository } from "../../src/infrastructure/fs/state-repository.js";
import { GitVersionControl } from "../../src/infrastructure/git/version-control.js";
import { NpmBuildTool } from "../../src/infrastructure/npm/build-tool.js";
import { JsonlTelemetrySink } from "../../src/infrastructure/telemetry/jsonl-telemetry-sink.js";
import type {
  DispatchRequest,
  DispatchResult,
  Dispatcher,
  FailurePolicy,
  GateChoice,
  GateManager,
  InteractionMode,
  PipelineServices,
  ProgressReporter,
  RunState,
  StageOutcome,
  StageRuntime,
  TelemetrySink,
} from "../../src/application/port/index.js";

const execFileAsync = promisify(execFile);
let harnessRunCounter = 0;

export interface HarnessOptions {
  route?: "full" | "quick-fix";
  totalPhases?: number;
  verificationStatus?: "PASS" | "PARTIAL" | "FAIL";
  acceptanceStatus?: "PASS" | "FAIL";
  backwardLoopRecommendation?: "NO_LOOP" | "DEFER_REPLAN" | "LOOP_PLAN" | "LOOP_STRUCTURE" | "LOOP_DESIGN" | "LOOP_GOALS";
  interactionMode?: InteractionMode;
  failurePolicy?: FailurePolicy;
}

export class TestHarness {
  readonly workspaceRoot: string;
  readonly artifacts: RunArtifacts;
  readonly dispatcher: Dispatcher;
  readonly gates: GateManager;
  readonly progress: ProgressReporter;
  readonly services: PipelineServices;
  state: RunState;

  private constructor(
    workspaceRoot: string,
    artifacts: RunArtifacts,
    state: RunState,
    services: PipelineServices,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.artifacts = artifacts;
    this.state = state;
    this.dispatcher = services.dispatcher;
    this.gates = services.gates;
    this.progress = services.progress;
    this.services = services;
  }

  get telemetrySink(): TelemetrySink {
    return this.services.telemetrySink;
  }

  static async create(options: HarnessOptions = {}): Promise<TestHarness> {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pi-deepwork-test-"));
    const runId = createRunId(new Date(2026, 5, 1, 0, 0, harnessRunCounter++));
    await writeFixtureWorkspace(workspaceRoot, runId);
    await execFileAsync("git", ["checkout", `qrspi/${runId}`], { cwd: workspaceRoot });
    const artifacts = getRunArtifacts(workspaceRoot, runId);
    await ensureRunDirectories(artifacts);

    const state = createInitialState({
      runId,
      userTask: "Implement a deterministic deepwork pipeline.",
      interactionMode: options.interactionMode ?? "automated",
      failurePolicy: options.failurePolicy ?? "best-effort",
      route: options.route ?? "full",
    });

    const agentDefinitions = await loadAgentDefinitions();
    const pi = createExecOnlyPi(workspaceRoot);
    const gates = new StaticGateManager(options.interactionMode ?? "automated", options.failurePolicy ?? "best-effort");
    const dispatcher = new MockDispatcher(artifacts, {
      route: options.route ?? "full",
      totalPhases: options.totalPhases ?? (options.route === "quick-fix" ? 1 : 2),
      verificationStatus: options.verificationStatus ?? "PASS",
      acceptanceStatus: options.acceptanceStatus ?? "PASS",
      backwardLoopRecommendation: options.backwardLoopRecommendation ?? "NO_LOOP",
    });
    const ctx = createFakeCommandContext(workspaceRoot, pi);
    const progress = new NoopProgressReporter();
    const versionControl = new GitVersionControl(pi, workspaceRoot, runId);
    const buildTool = new NpmBuildTool(pi);
    const artifactRepo = FileSystemArtifactRepository.fromPaths(artifacts);
    const stateRepo = new FileSystemRunStateRepository(artifacts.stateFile);
    const telemetrySink = JsonlTelemetrySink.create(artifacts, runId);
    await telemetrySink.initialize();

    const services: PipelineServices = {
      pi,
      commandContext: ctx,
      eventContext: ctx,
      dispatcher,
      agentDefinitions,
      gates,
      progress,
      versionControl,
      buildTool,
      artifactRepo,
      stateRepo,
      telemetrySink,
    };

    await writeFile(artifacts.configFile, `created: 2026-06-01\nroute: ${options.route ?? "full"}\nrun_id: ${runId}\n`, "utf8");

    return new TestHarness(workspaceRoot, artifacts, state, services);
  }

  runtime(overrides?: Partial<RunState>): StageRuntime {
    return {
      state: { ...this.state, ...overrides },
      workspaceRoot: this.workspaceRoot,
      services: this.services,
    };
  }

  async dispose(): Promise<void> {
    // Remove any worktrees created under /tmp/.qrspi-worktrees/{runId}/ to prevent
    // stale directories from breaking subsequent tests that reuse the same runId.
    const worktreesRoot = path.join(os.tmpdir(), ".qrspi-worktrees", this.state.runId);
    await rm(worktreesRoot, { recursive: true, force: true });
    await rm(this.workspaceRoot, { recursive: true, force: true });
  }
}

class MockDispatcher implements Dispatcher {
  constructor(
    private readonly artifacts: RunArtifacts,
    private readonly options: Required<Pick<HarnessOptions, "route" | "totalPhases" | "verificationStatus" | "acceptanceStatus" | "backwardLoopRecommendation">>,
  ) {}

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    if (request.target.kind === "generic") {
      return this.handleGeneric(request);
    }
    return this.handleLeaf(request);
  }

  async dispatchParallel(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    return Promise.all(requests.map((request) => this.dispatch(request)));
  }

  async dispatchChain(requests: DispatchRequest[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const request of requests) {
      results.push(await this.dispatch(request));
    }
    return results;
  }

  async dispatchGenericCoding(
    prompt: string,
    options?: { cwd?: string; tools?: string[]; signal?: AbortSignal },
  ): Promise<StageOutcome> {
    const stageReturns: StageReturnPayload[] = [];
    const result = await this.dispatch({
      target: {
        kind: "generic",
        name: "generic-coding",
        tools: options?.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"],
        thinkingLevel: "high",
      },
      prompt,
      cwd: options?.cwd ?? this.artifacts.workspaceRoot,
      ...(options?.signal ? { signal: options.signal } : {}),
      customTools: [createStageReturnTool(stageReturns)],
    });
    return normalizeStageReturn(result);
  }

  private async handleLeaf(request: DispatchRequest): Promise<DispatchResult> {
    switch (request.target.name) {
      case "qrspi-goals-synthesizer":
        return textResult(renderGoalsSynth(this.options.route, this.artifacts.runDir.split("/").at(-1) ?? "run"));
      case "qrspi-goals-reviewer":
      case "qrspi-question-leakage-reviewer":
      case "qrspi-question-quality-reviewer":
      case "qrspi-research-reviewer":
      case "qrspi-design-reviewer":
      case "qrspi-structure-reviewer":
      case "qrspi-plan-reviewer":
      case "qrspi-task-spec-reviewer":
      case "qrspi-replan-reviewer":
        return textResult("### Status — PASS\n\n### Summary\nPass.");
      case "qrspi-question-generator":
        return textResult(
          [
            "# Research Questions",
            "",
            "### Q1: What code paths currently implement the relevant behavior?",
            "**Tag**: codebase",
            "**Covers**: FR-1 [behavior]",
            "**Answer shape**: Identify the current files and call chain. Stop when the owning path is clear.",
            "**Decision unblocked**: Which existing subsystem owns the change surface.",
          ].join("\n"),
        );
      case "qrspi-codebase-researcher":
        return textResult(
          ["## Findings for Q1", "", "### Summary", "A current code path exists.", "", "### References", "- `src/example.ts:1` — placeholder reference."].join("\n"),
        );
      case "qrspi-web-researcher":
        return textResult(["## Findings for Q1", "", "### Summary", "No relevant external sources found for this question."].join("\n"));
      case "qrspi-research-synthesizer": {
        await writeFile(
          this.artifacts.researchSummaryFile,
          "# Research Summary\n\n## Overview\nCurrent system facts were synthesized.\n",
          "utf8",
        );
        return textResult("### Status — PASS\n### Files Written — research/summary.md\n### Summary — Synthesized findings.");
      }
      case "qrspi-design-synthesizer":
        return textResult("# Design\n\n## Approach\nUse the existing repository layout.\n");
      case "qrspi-structure-mapper":
        return textResult("# Structure\n\n## File Map\n\n### Slice 1: Core\n| File | Action | Purpose |\n|------|--------|---------|\n| `src/example.ts` | MODIFY | Example work |\n");
      case "qrspi-plan-writer":
        return textResult(renderPlanWriterOutput(this.options.route, this.options.totalPhases));
      case "qrspi-task-spec-writer": {
        const taskNumber = request.prompt.match(/=== TASK NUMBER ===\n(\d+)/)?.[1] ?? "01";
        const content = renderTaskSpec(taskNumber, this.options.route, taskNumber === "01" ? "1" : "2");
        await writeFile(path.join(this.artifacts.tasksDir, `task-${taskNumber}.md`), content, "utf8");
        return textResult(`### Status — PASS\n\n**Task:** ${taskNumber}\n**Written:** \`.pipeline/${this.artifacts.runDir.split("/").at(-1)}/tasks/task-${taskNumber}.md\`\n\n### Summary\nWrote task spec.`);
      }
      case "qrspi-baseline-checker":
        return textResult("### Baseline Status — CLEAN\n\n### Check Results\n| Check | Status | Command | Details |\n|-------|--------|---------|---------|\n| Build | PASS | `npm run build` | ok |\n| Tests | PASS | `npm run test` | ok |\n\n### Failure Inventory\nNone.\n\n### Stage Summary\nBaseline CLEAN.");
      case "qrspi-coverage-planner":
        return textResult("### Coverage Plan\n- Criterion 1: Example\n  - Action: new\n  - Test Type: integration\n  - Trigger: run command\n  - Expected Outcome: observable success\n  - Relevant Files/Components: src/example.ts\n  - Planned Test File: test/example.test.ts\n  - Notes: None.\n\n### Summary\nPlanned coverage.");
      case "qrspi-backward-loop-detector":
        return textResult(renderBackwardLoop(this.options.backwardLoopRecommendation));
      case "qrspi-verifier":
        return textResult(renderVerification(this.options.verificationStatus));
      case "qrspi-reporter":
        return textResult("## QRSPI Pipeline Complete\n\n### Overall Status: PASS\n");
      case "qrspi-replan-writer":
        return textResult(renderReplanWriterOutput(this.options.route, this.options.totalPhases));
      default:
        return textResult("### Status — PASS\n\n### Summary\nMock leaf response.");
    }
  }

  private async handleGeneric(request: DispatchRequest): Promise<DispatchResult> {
    if (request.prompt.includes("Stage 7 acceptance testing")) {
      const acceptanceStatus = this.options.acceptanceStatus;
      const phase = request.prompt.match(/Phase:\s*(\d+)/)?.[1] ?? "1";
      const phaseDir = path.join(this.artifacts.phasesDir, `phase-${phase.padStart(2, "0")}`);
      await writeFile(
        path.join(phaseDir, "acceptance-results.md"),
        `# Acceptance Results\n\n| # | Criterion | Status | Failure Reason |\n| - | --------- | ------ | -------------- |\n| 1 | Example | ${acceptanceStatus === "PASS" ? "✅" : "❌"} | ${acceptanceStatus === "PASS" ? "none" : "executed_failed"} |\n`,
        "utf8",
      );
      await writeFile(
        path.join(phaseDir, "stage8-summary.md"),
        `# Stage 8 Summary\n\nAcceptance ${acceptanceStatus === "PASS" ? "passed" : "failed"}.\n`,
        "utf8",
      );
      return withStageReturn(request, {
        status: acceptanceStatus,
        filesWritten: ["test/example.test.ts"],
        summary: acceptanceStatus === "PASS" ? "Acceptance tests passed." : "Acceptance tests failed.",
        telemetry: {
          evidence_quality: {
            deterministic: 1,
            flaky: 0,
            harnessNoisy: 0,
            ambiguous: 0,
            redundant: 0,
            noTestTasks: 0,
            noTestAuditOverrides: 0,
          },
        },
      });
    }

    if (request.prompt.includes("Review the current task worktree")) {
      return withStageReturn(request, {
        status: "PASS",
        filesWritten: [],
        summary: "Code review clean.",
      });
    }

    if (request.prompt.includes("Run targeted verification")) {
      return withStageReturn(request, {
        status: "PASS",
        filesWritten: [],
        summary: "Targeted verification passed.",
      });
    }

    if (request.prompt.includes("Write or update only the tests needed")) {
      await touchFile(path.join(request.cwd, "test", "example.test.ts"), "export {};\n");
      return withStageReturn(request, {
        status: "PASS",
        filesWritten: ["test/example.test.ts"],
        summary: "Task tests updated.",
        telemetry: {
          evidence_quality: {
            deterministic: 1,
            flaky: 0,
            harnessNoisy: 0,
            ambiguous: 0,
            redundant: 0,
            noTestTasks: 0,
            noTestAuditOverrides: 0,
          },
        },
      });
    }

    if (request.prompt.includes("Implement the production-code portion")) {
      await touchFile(path.join(request.cwd, "src", "example.ts"), `export const task = "${path.basename(request.cwd)}";\n`);
      return withStageReturn(request, {
        status: "PASS",
        filesWritten: ["src/example.ts"],
        summary: "Task implementation updated.",
      });
    }

    return withStageReturn(request, {
      status: "PASS",
      filesWritten: [],
      summary: "Generic coding session passed.",
    });
  }
}

class StaticGateManager implements GateManager {
  constructor(
    readonly interactionMode: InteractionMode,
    readonly failurePolicy: FailurePolicy,
  ) {}

  async askText(): Promise<string | undefined> {
    return this.interactionMode === "interactive" ? "mock answer" : undefined;
  }

  async choose(_title: string, options: Array<{ value: string }>): Promise<GateChoice | undefined> {
    if (this.interactionMode !== "interactive") {
      return undefined;
    }
    return { value: options[0]?.value ?? "approve" };
  }

  async confirm(): Promise<boolean> {
    return this.interactionMode === "interactive";
  }

  createAskHumanTool() {
    return createAskHumanTool(this);
  }
}

class NoopProgressReporter implements ProgressReporter {
  setStage(): void {}
  setWidget(): void {}
  clear(): void {}
}

function createExecOnlyPi(workspaceRoot: string): Pick<ExtensionAPI, "exec"> {
  return {
    async exec(command, args, options) {
      try {
        const result = await execFileAsync(command, args, {
          cwd: options?.cwd ?? workspaceRoot,
          timeout: options?.timeout,
          signal: options?.signal,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Cursor Test",
            GIT_AUTHOR_EMAIL: "cursor-test@example.com",
            GIT_COMMITTER_NAME: "Cursor Test",
            GIT_COMMITTER_EMAIL: "cursor-test@example.com",
          },
        });
        return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: 0, killed: false };
      } catch (error) {
        const anyError = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
        return {
          stdout: anyError.stdout ?? "",
          stderr: anyError.stderr ?? String(error),
          code: anyError.code ?? 1,
          killed: anyError.killed ?? false,
        };
      }
    },
  };
}

function createFakeCommandContext(workspaceRoot: string, _pi: Pick<ExtensionAPI, "exec">): ExtensionCommandContext {
  return {
    cwd: workspaceRoot,
    hasUI: false,
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      notify: () => undefined,
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      setTitle: () => undefined,
      custom: async () => undefined as never,
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      editor: async () => undefined,
      addAutocompleteProvider: () => undefined,
      setEditorComponent: () => undefined,
      getEditorComponent: () => undefined,
      theme: {} as never,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: true }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    },
    sessionManager: {
      getCwd: () => workspaceRoot,
      getSessionDir: () => workspaceRoot,
      getSessionId: () => "test",
      getSessionFile: () => undefined,
      getLeafId: () => null,
      getLeafEntry: () => undefined,
      getEntry: () => undefined,
      getLabel: () => undefined,
      getBranch: () => [],
      getHeader: () => null,
      getEntries: () => [],
      getTree: () => [],
      getSessionName: () => undefined,
    },
    modelRegistry: {} as never,
    model: undefined,
    isIdle: () => true,
    signal: undefined,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
    waitForIdle: async () => undefined,
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    navigateTree: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    reload: async () => undefined,
  };
}

async function writeFixtureWorkspace(workspaceRoot: string, runId: string): Promise<void> {
  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "test"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        type: "module",
        scripts: {
          build: "node -e \"process.exit(0)\"",
          typecheck: "node -e \"process.exit(0)\"",
          test: "node -e \"process.exit(0)\"",
          "test:e2e": "node -e \"process.exit(0)\"",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(path.join(workspaceRoot, "README.md"), "# Fixture\n", "utf8");
  await writeFile(path.join(workspaceRoot, "src", "example.ts"), "export const example = 1;\n", "utf8");

  const pi = createExecOnlyPi(workspaceRoot);
  await pi.exec("git", ["init", "-b", "main"], { cwd: workspaceRoot, timeout: 60_000 });
  await pi.exec("git", ["add", "."], { cwd: workspaceRoot, timeout: 60_000 });
  await pi.exec("git", ["commit", "-m", "initial"], { cwd: workspaceRoot, timeout: 60_000 });
  await pi.exec("git", ["checkout", "-b", `qrspi/${runId}`], {
    cwd: workspaceRoot,
    timeout: 60_000,
  });
  await pi.exec("git", ["checkout", "main"], { cwd: workspaceRoot, timeout: 60_000 });
}

function renderGoalsSynth(route: "full" | "quick-fix", runId: string): string {
  return [
    "### goals.md",
    "",
    "# Goals",
    "",
    "## Intent",
    "Implement a deterministic deepwork pipeline.",
    "",
    "## Functional Requirements",
    "- Produce deterministic pipeline artifacts.",
    "",
    "## Non-Functional Requirements",
    "- Keep the runtime testable.",
    "",
    "## Technical Specification",
    "- Use TypeScript.",
    "",
    "## Constraints",
    "- No prompt-only orchestration.",
    "",
    "## Non-Goals",
    "- No unrelated refactors.",
    "",
    "## Acceptance Criteria",
    "1. The pipeline can run end-to-end.",
    "",
    "### config.md",
    "",
    `created: 2026-06-01`,
    `route: ${route}`,
    `run_id: ${runId}`,
    "",
  ].join("\n");
}

function renderPlanWriterOutput(route: "full" | "quick-fix", totalPhases: number): string {
  const outlines =
    route === "quick-fix"
      ? [
          "### task-01.outline",
          "Task: 01",
          "Title: Quick fix",
          "Phase: Quick-fix",
          "Route: quick-fix",
          "Slice: Quick-fix",
          "Dependencies: None",
          "Scope: Fix the targeted issue.",
          "Acceptance Criteria: AC-1",
          "NFRs: None.",
          "Gate Criteria: None.",
          "Files:",
          "  - src/example.ts (MODIFY) — update behavior",
        ].join("\n")
      : [
          "### task-01.outline",
          "Task: 01",
          "Title: Phase one task",
          "Phase: 1",
          "Route: full",
          "Slice: Slice 1",
          "Dependencies: None",
          "Scope: Implement the first phase.",
          "Acceptance Criteria: AC-1",
          "NFRs: NFR-1",
          "Gate Criteria: Gate-1",
          "Files:",
          "  - src/example.ts (MODIFY) — update behavior",
          "",
          "### task-02.outline",
          "Task: 02",
          "Title: Phase two task",
          "Phase: 2",
          "Route: full",
          "Slice: Slice 2",
          "Dependencies: 01",
          "Scope: Implement the second phase.",
          "Acceptance Criteria: AC-1",
          "NFRs: NFR-1",
          "Gate Criteria: Gate-2",
          "Files:",
          "  - src/example.ts (MODIFY) — update behavior again",
        ].join("\n");

  return [
    "### plan.md",
    "",
    "# Implementation Plan",
    "",
    "## Overview",
    "Deliver the deterministic extension.",
    "",
    "## Phase Summary",
    "- **Phase 1:** initial implementation",
    route === "full" ? "- **Phase 2:** follow-up implementation" : "",
    "",
    "## Task Order",
    "",
    "| # | Task | Dependencies | Phase | Slice |",
    "| - | ---- | ------------ | ----- | ----- |",
    route === "quick-fix"
      ? "| 01 | Quick fix | — | Quick-fix | Quick-fix |"
      : "| 01 | Phase one task | — | 1 | Slice 1 |\n| 02 | Phase two task | 01 | 2 | Slice 2 |",
    "",
    "## Wave Analysis",
    "- **Wave 1**: Task 01",
    route === "full" ? "- **Wave 2**: Task 02" : "",
    "",
    "## Coverage Notes",
    "- AC-1 → 01",
    "",
    "### phase-manifest.md",
    "",
    `---\ntotal_phases: ${totalPhases}\n---`,
    "",
    "## Phase 1 — Core",
    "- **Tasks:** 01",
    "- **Acceptance Criteria:** AC-1",
    "- **Replan Gate:** Gate-1",
    route === "full"
      ? "\n## Phase 2 — Finish\n- **Tasks:** 02\n- **Acceptance Criteria:** AC-1\n- **Replan Gate:** Gate-2"
      : "",
    "",
    outlines,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTaskSpec(taskNumber: string, route: "full" | "quick-fix", phase: string): string {
  return [
    `# Task ${taskNumber}: Example`,
    "",
    "## Metadata",
    `- **Task:** ${taskNumber}`,
    `- **Phase:** ${phase === "Quick-fix" ? "Quick-fix" : phase}`,
    `- **Route:** ${route}`,
    `- **Slice:** Slice ${taskNumber}`,
    "",
    "## Dependencies",
    taskNumber === "01" ? "- None" : "- 01 — previous task",
    "",
    "## Traceability",
    "- **Acceptance Criteria:** AC-1",
    "- **NFRs:** NFR-1",
    "- **Replan Gate Criteria:** Gate-1",
    "",
    "## Source Traceability",
    "- **Goals:** AC-1",
    "- **Plan:** Task 01, Phase 1 — Core",
    `- **Design:** ${route === "quick-fix" ? "N/A" : "Slice 1"}`,
    `- **Structure:** ${route === "quick-fix" ? "N/A" : "Slice 1 / src/example.ts"}`,
    "",
    "## Description",
    "Implement the described behavior in a self-contained way.",
    "",
    "## Files",
    "- `src/example.ts` (MODIFY) — update the example implementation",
    "",
    "## Test Expectations",
    "- Behavior: When executed, expect success.",
    "- Error case: When invalid input is supplied, expect handling.",
    "",
  ].join("\n");
}

function renderBackwardLoop(recommendation: Required<HarnessOptions>["backwardLoopRecommendation"]): string {
  return [
    "### Severity Analysis",
    "| # | Criterion | Failure Reason | Failure | Local Code Only | File Boundary Change | Interface Change | Architecture Change | Scope Change | Safe To Defer | Classification | Loop-back Target | Rationale |",
    "| - | --------- | -------------- | ------- | --------------- | -------------------- | ---------------- | ------------------- | ------------ | ------------- | -------------- | ---------------- | --------- |",
    `| 1 | Example | executed_failed | Example | no | no | no | no | no | no | ${recommendation} | plan | Example rationale |`,
    "",
    "### Overall Recommendation",
    recommendation,
    "",
    "### Rationale",
    "Mock rationale.",
    "",
    recommendation !== "NO_LOOP"
      ? ["### Backward Loop Request", "**Criteria**: AC-1", "**Issue**: Mock issue", "**Affected Artifact**: plan", "**Recommendation**: Revisit planning."].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderVerification(status: "PASS" | "PARTIAL" | "FAIL"): string {
  return [
    "### Check Results",
    "| Check | Status | Likely Owner | Details |",
    "| ----- | ------ | ------------ | ------- |",
    `| Build | ${status === "FAIL" ? "FAIL" : "PASS"} | unknown | mock |`,
    "",
    "### Baseline Comparison",
    "| Check | Baseline Status | Current Status | Regression Status | Phase Introduced | Last Modified Phase |",
    "| ----- | --------------- | -------------- | ----------------- | ---------------- | ------------------- |",
    `| Build | PASS | ${status === "FAIL" ? "FAIL" : "PASS"} | ${status === "FAIL" ? "New regression" : "Improved"} | 1 | 1 |`,
    "",
    "### Requirement Checks",
    "| Requirement | Evidence | Status | Notes |",
    "| ----------- | -------- | ------ | ----- |",
    `| AC-1 | mock | ${status === "FAIL" ? "FAILED" : "SATISFIED"} | mock |`,
    "",
    "### Acceptance Criteria Status",
    "| Phase | # | Criterion | Status | Failure Reason |",
    "| ----- | - | --------- | ------ | -------------- |",
    `| 1 | 1 | Example | ${status === "FAIL" ? "❌" : "✅"} | ${status === "FAIL" ? "mock failure" : "none"} |`,
    "",
    "### Code Health Summary",
    "| Phase | Tasks | Deterministic | Flaky | Harness Noisy | Ambiguous | Redundant | No-Test Tasks | No-Test Audit Overrides | Outstanding Concerns |",
    "| ----- | ----- | ------------- | ----- | ------------- | --------- | --------- | ------------- | ----------------------- | -------------------- |",
    "| 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |",
    "",
    "### Verification Iterations",
    "1/1 — Mock verification.",
    "",
    `### Overall Status — ${status}`,
    "",
    `### Stage Summary`,
    `Verification ${status}.`,
  ].join("\n");
}

function renderReplanWriterOutput(route: "full" | "quick-fix", totalPhases: number): string {
  return [
    "### plan.md",
    "# Implementation Plan\n\n## Overview\nUpdated plan.",
    "",
    "### phase-manifest.md",
    `---\ntotal_phases: ${Math.max(totalPhases, 2)}\n---\n\n## Phase 1 — Core\n- **Tasks:** 01\n- **Acceptance Criteria:** AC-1\n- **Replan Gate:** Gate-1\n\n## Phase 2 — Finish\n- **Tasks:** 02\n- **Acceptance Criteria:** AC-1\n- **Replan Gate:** Gate-2`,
    "",
    "### task-02.md",
    renderTaskSpec("02", route, "2"),
    "",
    "### Tasks Added",
    "None.",
    "",
    "### Tasks Modified",
    "- 02 Example",
    "",
    "### Tasks Removed",
    "None.",
    "",
    "### Replan Note",
    "# Replan After Phase 1\n\n## What Changed\n- Updated task 02.\n",
  ].join("\n");
}

function textResult(text: string): DispatchResult {
  return { text, messages: [], customToolCalls: [] };
}

async function withStageReturn(request: DispatchRequest, payload: Record<string, unknown>): Promise<DispatchResult> {
  const calls = [];
  const tool = request.customTools?.find((candidate) => candidate.name === "stage_return");
  if (tool) {
    const result = (await tool.execute("tool-1", payload as never, undefined, undefined, {} as never)) as AgentToolResult<unknown>;
    calls.push({ name: "stage_return", result });
  }
  return {
    text: "",
    messages: [],
    customToolCalls: calls,
  };
}

async function touchFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

export async function readFileText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
