## What pi-deepwork is

`pi-deepwork` is a **deterministic TypeScript extension** for the `pi` coding-agent runtime. It registers a single slash command, `/deepwork`, which runs the **QRSPI pipeline** — a fixed, code-orchestrated sequence that takes a task from a raw user request all the way to verified, committed code:

```
Goals → Research → Design → Structure → Plan → Implement → Accept → Replan → Verify → Report
```

The key design idea (called out in `AGENTS.md`) is that the *orchestration is code, not prompts*. The control flow — which stage runs next, when to loop back, when to stop — lives in TypeScript state machines. Only the "leaf" work (synthesizing goals, reviewing a design, writing a task spec, etc.) is delegated to LLM agents driven by the 35 markdown prompts in `agents/`.

The codebase uses **hexagonal architecture** (ports & adapters):
- `src/domain/` — pure logic, no I/O (state machine, transition rules, policies)
- `src/application/` — pipeline loop + stage implementations, depends only on *port* interfaces
- `src/infra/` — adapters that implement those ports (filesystem, git, pi sessions, npm, telemetry)

## 1. Entry point: `src/index.ts` (the composition root)

`src/index.ts` does two things at load time and one thing per invocation.

At extension load it registers a transcript renderer and the command itself:

```24:30:src/index.ts
export default function (pi: ExtensionAPI): void {
  // Register the transcript breadcrumb renderer once at extension load time.
  pi.registerMessageRenderer(DEEPWORK_PROGRESS_CUSTOM_TYPE, DEEPWORK_PROGRESS_RENDERER);

  pi.registerCommand("deepwork", {
    description: "Run the deterministic QRSPI deepwork pipeline.",
    handler: async (args, ctx) => {
```

When `/deepwork ...` is invoked, the handler is the **composition root** — it builds every concrete adapter, wires them into one `PipelineServices` bag, and hands that to the pure pipeline loop. The important steps:

1. **Parse interaction mode & run ID.** `determineInteractionMode` reads flags like `mode:automated` / `failure:best-effort` from the args. The run ID is either a resumed one (`run-id:qrspi-...`) or a fresh timestamp ID (`qrspi-YYYYMMDD-HHMMSS`).

2. **Load agent catalog & build adapters** (lines 37–69): the markdown agent catalog, the `PiSessionDispatcher` (runs leaf/generic agents), the gate manager (human prompts), progress reporter, artifact repo (filesystem), git version control, npm build tool, and the telemetry sinks.

3. **Resume or start fresh.** `resumeOrInferState` tries to recover prior state; the run is either rehydrated or started fresh:

```55:62:src/index.ts
      const initialRun = resumedState
        ? Run.rehydrate(resumedState)
        : Run.start({
            runId,
            interactionMode: interaction.interactionMode,
            failurePolicy: interaction.failurePolicy,
            ...(userTask ? { userTask } : {}),
          });
```

4. **Run the pipeline** by calling `runPipeline({ services, state, workspaceRoot, isResumed })` and then notify the user of the final stage.

Everything below the composition root depends only on the port interfaces declared in `src/application/port/index.ts`, never on `pi` or `node` directly.

## 2. The domain state machine: `Run` and the transition policy

The heart of the determinism is the `Run` aggregate (`src/domain/run/index.ts`). It owns a `RunState` snapshot — current phase, total phases, route, last completed stage, next stage, plus loop counters — and exposes pure mutators (`completeStage`, `advancePhase`, `resetCurrentPhase`, `incrementBackwardLoops`, etc.). It emits **no side effects**.

What stage comes next is decided by a single pure function:

```13:38:src/domain/stage/transition-policy.ts
export function nextStageFor(stage: StageName, context: NextStageContext): NextStage {
  switch (stage) {
    case "goals":
      return "research";
    case "research":
      return context.route === "quick-fix" ? "plan" : "design";
    case "design":
      return "structure";
    case "structure":
      return "plan";
    case "plan":
      return "implement";
    case "implement":
      return "accept";
    case "accept":
      return context.route === "quick-fix" || context.currentPhase >= Math.max(context.totalPhases, 1)
        ? "verify"
        : "replan";
    case "replan":
      return "implement";
    case "verify":
      return context.verifyStatus === "PASS" ? "report" : "implement";
    case "report":
      return "done";
  }
}
```

Two things to notice here:
- **Route branching.** A `quick-fix` route skips Design and Structure (research goes straight to plan). The `full` route runs everything. The route is chosen during Goals.
- **The phase loop.** `accept` goes to `replan` (which bumps the phase and loops back to `implement`) until all phases are done, then to `verify`. `verify` only advances to `report` when status is `PASS`; otherwise it routes back to `implement` to fix things.

## 3. The pipeline loop: `pipeline-loop.ts`

`runPipeline` is the engine. It holds a `STAGES` registry mapping each stage name to its `StageModule` implementation, then loops `while (run.nextStage !== "done")`.

```71:100:src/application/pipeline/pipeline-loop.ts
    while (run.nextStage !== "done") {
      const stageName = run.nextStage;
      const stage = STAGES[stageName];
      services.progress.setStage(`deepwork/${stageName}`, `phase ${run.state.currentPhase}`);
      ...
      const { outcome, stageInstance, startedAt } = await executeStage(
        stage,
        runtime,
        stateSnapshot,
        sink,
        stageInstances,
      );
```

Each iteration:
1. Sets progress UI, emits a `phase.started` event when the phase changes.
2. Builds a `StageRuntime` (state snapshot + services + workspace root) and runs the stage via `executeStage`.
3. Inspects the returned `StageOutcome` and decides what to do next.

The outcome handling has three branches:

- **Backward loop requested** (lines 110–152): if a stage returns `outcome.backwardLoop`, the loop either *defers* it to replan (`DEFER_REPLAN`), *stops* if the backward-loop cap (`MAX_BACKWARD_LOOPS = 3`) is hit, or *archives artifacts and resets* to an earlier stage (goals/design/structure/plan) based on the classification (`backwardLoopTarget` in `src/domain/backward-loop/artifact-reset-policy.ts`).

- **Reroute on failure** (`handleReroute`, lines 210–235): a failing `verify` reroutes to `implement` (`maybeRouteVerifyFix`); a failing `accept` reroutes to `implement` (`maybeRouteAcceptFix`); any other `FAIL` breaks the loop and stops the run.

- **Normal completion**: apply the transition (`applyStageTransition`), persist state, create a git checkpoint, and regenerate telemetry summaries:

```176:181:src/application/pipeline/pipeline-loop.ts
      const newState = await applyStageTransition(run.toSnapshot(), stage.stage, outcome, services.artifactRepo);
      run = Run.rehydrate(newState);
      await services.stateRepo.save(run);
      await services.versionControl.checkpoint(stage.stage, "complete", signal);
      await sink.regenerateRunLog(run.toSnapshot());
      await sink.regenerateMetrics(run.toSnapshot());
```

When the loop exits it records `run.completed` (status `PASS` if it reached `done`, else `PARTIAL`). On a thrown error it records `run.aborted` and rethrows. State is saved after *every* transition, which is what makes resume possible.

### `executeStage` — per-stage retry wrapper

`stage-runner.ts` wraps each stage run with retry logic. It records `stage.started`, runs the stage, then passes the result to `resolveStageFailure` (the review-gate coordinator, which can escalate to a human and ask to retry). On thrown errors it retries once if the failure policy is `best-effort`, otherwise rethrows:

```45:48:src/application/pipeline/stage-runner.ts
      const shouldRetry = runtime.services.gates.failurePolicy === "best-effort" && automaticRetries === 0;
      if (!shouldRetry) {
        throw error;
      }
```

### `outcome-interpreter.ts` — applying transitions & fix routing

`applyStageTransition` is the bridge between a stage's `StageOutcome` and the state machine. For each stage it calls `run.completeStage(stage, nextStageFor(...))`. Notable extras:
- `goals` records the chosen `route`.
- `plan` reads the phase manifest to set `totalPhases`.
- `replan` advances the phase.
- `verify` extracts `verify_status` and resets the verify-fix counter on `PASS`.

The fix-routing functions enforce caps:
- `maybeRouteAcceptFix` — only re-routes accept→implement if the failure is "implementation-repairable" and the accept-fix cap (`MAX_ACCEPT_FIX_ATTEMPTS = 2`) isn't hit.
- `maybeRouteVerifyFix` — re-routes verify→implement (resetting to phase 1) until the verify-fix cap (`MAX_VERIFY_FIX_ATTEMPTS = 3`) is hit.

## 4. How stages call agents: dispatch + review loops

Each stage is a `StageModule` with a `run(runtime)` method returning a `StageOutcome`. Stages do their work by **dispatching agents** through the `Dispatcher` port, implemented by `PiSessionDispatcher` (`src/infra/pi/session-dispatcher.ts`).

There are two dispatch flavors:
- **Leaf agents** — one of the 35 markdown prompts, loaded by `MarkdownAgentCatalog`. The dispatcher creates an isolated pi agent session, applies the leaf's system prompt (`replace` or `append` mode), tool allowlist, model, and max-turns, then runs the prompt:

```157:175:src/infra/pi/session-dispatcher.ts
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
      ...
```

- **Generic coding** — an unnamed, programmatically-dispatched worker (the "generic coding worker" mentioned in `AGENTS.md`) used to actually edit code. It's given a `stage_return` custom tool so it can return structured results; `dispatch` resolves the prompt as soon as `stage_return` or `goals_return` is called.

A recurring pattern is the **write → review → rewrite loop** (`src/application/workflow/agent-review-loop.ts`). The caller supplies a `runReview` callback and an optional `onFail` (rewrite) callback; the loop runs up to `maxRounds`, persists each review as a `*-review-round-NN.md` artifact, and returns PASS as soon as a review passes (or FAIL at the cap). Each stage has its own cap, e.g. `MAX_GOALS_REVIEW_ROUNDS = 5`, `MAX_PLAN_REVIEW_ROUNDS = 5`. This loop also handles transient dispatch retries.

The **Goals stage** (`src/application/stage/goals.ts`) is a good full example: it captures requirements, runs a deterministic interview (`collectInterview`), dispatches `qrspi-goals-synthesizer` (which must call the `goals_return` tool to emit structured goals + route), then runs the review loop against `qrspi-goals-reviewer`, and finally — in interactive mode — presents a human approval gate before passing.

## 5. The Implement stage in depth

`implement.ts` is the most involved stage. For the normal path:

1. It resolves the repo root, loads the phase's task specs, and groups them into **dependency waves** via `buildWaves` (`src/domain/stage/wave-planner.ts`). Tasks with satisfied dependencies run in the same wave; circular deps are dumped into one deterministic wave.

2. For each wave it prepares a **git worktree per task** and runs them **in parallel** (`Promise.all`), each through the fast-impl loop:

```80:90:src/application/stage/implement.ts
      const results = await Promise.all(
        prepared.map(async ({ task, worktree }) => ({
          task,
          worktree,
          result: await runFastImplLoopSubstage(runtime, {
            taskId: task.taskId,
            worktreeRoot: worktree.worktreeRoot,
            taskSpecId: task.taskSpecId,
          }),
        })),
      );
```

3. The **fast-impl loop** (`fast-impl-loop.ts`) runs three sub-stages per task — **code → test → verify** — with up to 2 attempts. If verify passes, the task passes; otherwise it retries once then fails:

```17:37:src/application/stage/fast-impl-loop.ts
  while (attempt <= 2) {
    const code = await runFastImplCodeSubstage(runtime, { ...options, attempt });
    if (code.status === "FAIL") {
      return code;
    }
    const tests = await runFastImplTestSubstage(runtime, { ...options, attempt });
    if (tests.status === "FAIL") {
      return tests;
    }
    const verify = await runFastImplVerifySubstage(runtime, { ...options, attempt });
    ...
```

4. Passing tasks are **squash-merged** back into the run branch (sorted by task ID for determinism). On merge conflicts it attempts a rebase, dispatches a generic-coding agent to resolve conflict markers, and retries the squash.

5. After all waves, it runs **e2e + baseline regression** sub-stages and an `qrspi-integration-checker` leaf agent. If the integration checker returns FAIL with a "Backward Loop Request", it surfaces a `backwardLoop` in the outcome (classified to LOOP_PLAN / LOOP_STRUCTURE / LOOP_DESIGN), which the pipeline loop then acts on.

There's also a fully **deterministic fast path**: if Goals detected a "simple exact-file task" (e.g. "create FILE with exactly this content"), Implement/Accept/Verify just write/check the file directly with no LLM calls at all (see `implementSimpleExactFileTask`).

## 6. Accept, Verify, and the phase loop

- **Accept** (`accept.ts`) runs the acceptance-tester sub-stage (coverage planning + per-phase validation). A non-PASS that's "implementation-repairable" routes back to Implement (bounded by the cap).
- **Replan** bumps the phase and loops back to Implement for the next phase.
- **Verify** (`verify.ts`) dispatches `qrspi-verifier` over all phases' manifests/regressions/acceptance results, parses an "Overall Status — PASS/PARTIAL/FAIL", and either advances to Report (PASS) or routes back to Implement.
- **Report** dispatches `qrspi-reporter` and ends the run (`done`).

## 7. Interaction modes, gates, and failure policy

`determineInteractionMode` (`human-gate.ts`) picks the mode:

```42:43:src/infra/pi/human-gate.ts
  const interactionMode = explicit.mode ?? (hasReplyCapability(ctx) ? "interactive" : "automated");
  const failurePolicy = explicit.failurePolicy ?? (interactionMode === "interactive" ? "fail-closed" : "best-effort");
```

- **interactive** → human gates are live (approval prompts, feedback requests); defaults to **fail-closed** (stop on unresolved ambiguity).
- **automated** → no human prompts; gates auto-approve, defaults to **best-effort** (proceed conservatively, retry transient failures). This is what the headless smoke test in `AGENTS.md` uses (`mode:automated failure:best-effort`).

The `DefaultGateManager` also exposes an `ask_human` custom tool, so leaf agents (like the goals synthesizer) can ask the human a question mid-session in interactive mode.

## 8. Persistence, resume, and telemetry

- **State** is saved to `.pipeline/qrspi-<run-id>/state.json` after every transition (`FileSystemRunStateRepository`).
- **Resume** (`state-reconstruction.ts`): `resumeOrInferState` first tries to load `state.json`. If absent, it *infers* state by scanning artifacts on disk — checking stage-marker files (goals.md, design.md, …, per-phase `stage7/stage8` summaries), reading the route from config and total phases from the manifest, then computing the next stage with the same `nextStageFor` policy. This is why a crashed run can be picked back up with `run-id:...`.
- **Telemetry**: every event (`run.started`, `stage.started/completed/failed`, `gate.*`, `backward_loop.*`, `task.*`, `review.round.*`) is appended as JSONL to `.pipeline/qrspi-<run-id>/telemetry/events.jsonl`, with derived `run-log.md` and `metrics-summary.md` regenerated alongside. `LiveUiTelemetrySink` wraps the JSONL sink to also stream breadcrumbs into the pi transcript.
- `.pipeline/` is scratch and must never be committed.

## 9. The 35 leaf agents

The `agents/` directory holds exactly 35 `qrspi-*.md` prompts (the expected count enforced in `AGENTS.md`), loaded by `MarkdownAgentCatalog`. They are pure leaves — synthesizers, reviewers, writers, checkers — never orchestrators. They map onto the pipeline stages, e.g.:
- Goals: `qrspi-goals-synthesizer`, `qrspi-goals-reviewer`
- Research: `qrspi-codebase-researcher`, `qrspi-web-researcher`, `qrspi-research-synthesizer`, `qrspi-research-reviewer`
- Design/Structure/Plan: `qrspi-design-synthesizer`/`-reviewer`, `qrspi-structure-mapper`/`-reviewer`, `qrspi-plan-writer`/`-reviewer`, `qrspi-task-spec-writer`/`-reviewer`
- Implement/Accept: the per-task `qrspi-review-*` fanout (security, silent-failure, code-quality, simplifier, test-quality, test-coverage, goal-traceability), `qrspi-integration-checker`, `qrspi-coverage-planner`, `qrspi-baseline-checker`
- Verify/Report/Replan: `qrspi-verifier`, `qrspi-reporter`, `qrspi-replan-writer`/`-reviewer`, `qrspi-backward-loop-detector`

The actual *code-writing* worker is **not** one of these markdown agents — it's dispatched programmatically as the `generic-coding` target.

---

### The whole thing in one mental model

`/deepwork` → composition root builds adapters → `runPipeline` drives a `while (nextStage !== "done")` loop → each iteration runs one `StageModule`, which dispatches leaf/generic agents and runs bounded review loops → the pure `nextStageFor` policy + `Run` aggregate decide the next stage → failures route to bounded fix loops or backward loops → state is checkpointed to disk and git after every step → it ends at `report` (PASS) or stops early (PARTIAL/abort).
