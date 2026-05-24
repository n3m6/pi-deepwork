# Task 24: Package for distribution and install verification

## Metadata
- **Task:** 24
- **Phase:** 4
- **Route:** full
- **Slice:** Slice 4b — Integration

## Dependencies
- **05 (Extension entry point):** `src/index.ts` must export the `activate()` factory function that registers `/deepwork` and `/deepwork-resume` commands, `qrspi_dispatch` and `qrspi_question` tools, and injects the `deepwork` skill via `resources_discover`. The symlink install verification relies on this entry point being loadable by pi's extension discovery.
- **23 (README and installation documentation):** `README.md` must document the exact installation paths and commands (npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main`, agent type discovery via symlink of `agents/` into `~/.pi/agent/agents/qrspi/`). This task validates those documented methods are functional.

## Traceability
- **Acceptance Criteria:** AC 8 (both install methods verified)
- **NFRs:** NFR: Installability (symlink verification)
- **Replan Gate Criteria:** Phase 4 replan gate (Package installable)

## Source Traceability
- **Goals:** AC 8 — "Extension is installable via both methods: npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main`"
- **Plan:** Task 24, Phase 4 — Completion + Edge Cases
- **Design:** Slice 4b — Resume, Quick-Fix Route, and Edge Cases (completion slice within Slice 4: Completion + Edge Cases — Stages 9–10, Resume, Quick-Fix)
- **Structure:** Foundation Slice — `package.json` (MODIFY, add files field and verify fields for pi install compatibility); Convention Note 7 — `.gitignore` must cover `dist/` build output

## Description

Make the extension ready for distribution and verify both documented installation methods work. This task has two responsibilities: (A) finalize `package.json` for pi install compatibility and (B) ensure the build output and `.gitignore` are clean so nothing leaks or is missing.

### Part A — package.json hardening for pi install

The `package.json` must include correct `main`, `files`, and `repository` fields so that `pi install git:github.com/n3m6/deepwork-pi@main` can discover and load the extension after cloning.

1. **Add a `"files"` field** that lists the directories needed at runtime. The extension requires:
   - `dist/` — compiled JavaScript and declaration files (the `main` field points to `dist/index.js`)
   - `agents/` — the ~55 agent type `.md` files consumed by pi-subagents at subagent dispatch time
   - `skills/` — the `deepwork` orchestrator skill (`skills/deepwork/SKILL.md`) consumed by pi's skill loader
   
   The `"files"` field controls what `npm pack` includes. Source files (`src/`) and test files (`test/`) are not needed at runtime and should not be listed. The `dist/` directory must appear explicitly since `.gitignore` excludes it (npm's `files` field overrides `.gitignore` exclusions — listing `dist/` in `files` ensures the compiled output is included in the npm tarball despite the `.gitignore` `dist` entry).

2. **Verify existing fields are correct:**
   - `"main": "dist/index.js"` — already present and correct. This is the entry point pi uses when loading the extension.
   - `"scripts": { "build": "tsc -p tsconfig.json", "test": "npm run build && node --test ./test/**/*.test.js" }` — already present and correct.
   - `"repository": { "type": "git", "url": "git+https://github.com/n3m6/pi-deepwork.git" }` — already present. Pi's `pi install git:` command parses the GitHub URL from the package but ultimately uses the user-supplied git source; the repository field serves as metadata. Leave as-is.
   - `"type": "commonjs"` — already present. Required because the extension compiles to CommonJS.
   - `"devDependencies": { "@types/node": "…", "typescript": "…" }` — already present. These are dev-only and will be skipped by `pi install`'s `npm install --omit=dev`.

3. **No `"dependencies"` are required at runtime.** The `qrspi_dispatch` tool accesses `@tintinweb/pi-subagents` at runtime via `Symbol.for("pi-subagents:manager")` and degrades gracefully when absent. The `qrspi_question` tool uses `ctx.ui` provided by pi's runtime. No runtime npm dependencies are needed for the extension itself.

### Part B — Build output verification and .gitignore hygiene

1. **Verify `npm run build` produces complete output.** Running `tsc -p tsconfig.json` (the build script) must produce:
   - `dist/index.js` and `dist/index.d.ts` (compiled from `src/index.ts`)
   - `dist/pipeline.js` and `dist/pipeline.d.ts` (compiled from `src/pipeline.ts`)
   - `dist/shared-tools.js` and `dist/shared-tools.d.ts` (compiled from `src/shared-tools.ts`)
   - `dist/types/pi-extensions.js` and `dist/types/pi-extensions.d.ts` (compiled from `src/types/pi-extensions.ts`)
   - Corresponding `.js.map` and `.d.ts.map` source map files for each of the above (since `tsconfig.json` enables `"sourceMap": true` and `"declarationMap": true`)

   Verify by inspecting the `dist/` directory after build. Every `.ts` file under `src/` must have a corresponding `.js` and `.d.ts` in `dist/`. The `rootDir` is `src/`, so the output structure mirrors the source layout under `dist/`.

2. **Verify `.gitignore` excludes all build artifacts.** The existing `.gitignore` already contains `dist` (line 83), which covers the `dist/` output directory. Confirm that after a clean `npm run build`:
   - `git status` does not show any untracked `.js`, `.d.ts`, `.js.map`, or `.d.ts.map` files outside `dist/`.
   - No TypeScript build artifacts (`.tsbuildinfo` — already covered by `*.tsbuildinfo` on line 48) leak into the working tree.
   - No packed tarballs (`*.tgz` — already covered on line 63) leak from test packaging.

   If any build artifact types are not covered by existing ignore patterns, add the missing entries. At minimum, verify that `dist/` is covered (it is — line 83), and that `.tsbuildinfo` is covered (it is — line 48). Source maps are inside `dist/` and therefore indirectly covered.

## Files
- `package.json` (MODIFY) — Add `"files": ["dist/", "agents/", "skills/"]` field. Verify `main`, `scripts`, `repository`, `type`, and `devDependencies` fields are correct for pi install compatibility. No runtime `dependencies` are added — the extension has no runtime npm dependency requirements.
- `.gitignore` (MODIFY) — Verify the existing `dist` entry (line 83) covers the `dist/` build output directory. Confirm no build artifacts (compiled `.js`, `.d.ts`, source maps, `.tsbuildinfo`, packed `.tgz`) leak past the ignore rules. Add any missing patterns if gaps are found — for example, if the build configuration ever produces artifacts at paths not yet covered.

## Test Expectations

### Build completeness
- **Build produces all expected outputs:** When `npm run build` completes successfully, the `dist/` directory contains `index.js`, `index.d.ts`, `pipeline.js`, `pipeline.d.ts`, `shared-tools.js`, `shared-tools.d.ts`, `types/pi-extensions.js`, and `types/pi-extensions.d.ts` — a `.js` and `.d.ts` for every `.ts` file under `src/`.
- **Declaration files are emitted:** When inspecting `dist/index.d.ts`, the file declares the `activate` function signature (`export default function activate(pi: ExtensionAPI): void | Promise<void>`) with type references resolved.

### npm pack correctness
- **`files` field controls tarball contents:** When `npm pack --dry-run` is executed, the included file list contains `dist/`, `agents/`, and `skills/` directories and their contents, and does not include `src/` (except as needed for npm conventions), `test/`, `node_modules/`, or `tsconfig.json`.

### Git ignore hygiene
- **No build artifacts leak:** After `npm run build` completes, `git status` shows no untracked `.js`, `.js.map`, `.d.ts`, `.d.ts.map`, or `.tsbuildinfo` files in the working tree (all are either under `dist/` which is gitignored, or not produced).
- **Tarballs are excluded:** After `npm pack` produces a `.tgz` file, `git status` does not show it as an untracked file (the `*.tgz` pattern on `.gitignore` line 63 covers it).

### Symlink install verification
- **Extension discovered via pi extension path:** When the repository working directory is symlinked at `~/.pi/agent/extensions/deepwork-pi` (via `ln -s "$(pwd)" ~/.pi/agent/extensions/deepwork-pi`), pi's extension auto-discovery finds and loads the extension — observably, `/deepwork` and `/deepwork-resume` commands are registered and respond to invocation.
- **Agent types discovered via pi-subagents agent path:** When the repository `agents/` directory is symlinked at `~/.pi/agent/agents/qrspi` (via `ln -s "$(pwd)/agents" ~/.pi/agent/agents/qrspi`), pi-subagents discovers the agent types — observably, the `Agent` tool's `subagent_type` parameter accepts `qrspi-goals`, `qrspi-questions`, and other agent type names without error.

### Graceful fallback
- **Extension loads without pi-subagents:** When pi starts with the extension activated but `@tintinweb/pi-subagents` is not installed, the extension loads successfully (commands register, skill injects), and invoking `/deepwork "task"` produces a clear message indicating that `@tintinweb/pi-subagents` must be installed as a prerequisite, rather than crashing or hanging.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
