# Task 01: Project scaffolding and package manifest

## Metadata
- **Task:** 01
- **Phase:** 1
- **Route:** full
- **Slice:** Foundation

## Dependencies
- None

## Traceability
- **Acceptance Criteria:** AC 8 (installability foundation)
- **NFRs:** NFR: Installability (package manifest)
- **Replan Gate Criteria:** Phase 1 replan gate (extension loads)

## Source Traceability
- **Goals:** AC 8 — Extension is installable via both npm symlink into `~/.pi/agent/extensions/` and `pi install git:github.com/n3m6/deepwork-pi@main`
- **Plan:** Task 01, Phase 1 — Foundation + Goals (Stage 1)
- **Design:** Foundation Slice — Shared Infrastructure (extension entry, pipeline helpers, shared tools, orchestrator skill)
- **Structure:** Foundation Slice — package.json (MODIFY), tsconfig.json (referenced in convention notes 6 and 7), directories agents/ skills/deepwork/ src/types/ (all CREATE), DEEPWORK.md (DELETE per convention note 2 consolidation), .gitignore (MODIFY per convention note 7)

## Description

Create the directory structure required for the deepwork-pi extension: three empty directories — `agents/`, `skills/deepwork/`, and `src/types/` — that later tasks will populate with agent type `.md` files, the orchestrator skill, and TypeScript type definitions respectively.

Update `package.json` to reflect the extension's identity and dependencies. Rename the package from `pi-deepwork` to `deepwork-pi` to match the install-path convention used throughout the pipeline spec. Update the description to `"QRSPI deepwork pipeline extension for pi — automated multi-stage agent orchestration via subagents"`. Add `@tintinweb/pi-subagents` as a peer dependency (the extension handles its absence gracefully at runtime, but the package manifest must declare the relationship so consumers are informed). Add a `test:watch` script: `"test:watch": "npm run build && node --test --watch ./test/**/*.test.js"` — this mirrors the existing `test` script but with the `--watch` flag for development. Confirm that `"main": "dist/index.js"` is present and correct (it already is; no change needed).

Verify and adjust `tsconfig.json` for the extension target. The existing configuration already has `"module": "commonjs"`, `"target": "es2020"`, `"declaration": true`, `"declarationMap": true`, `"sourceMap": true`, `"rootDir": "src"`, `"outDir": "dist"`, `"strict": true`, and `"esModuleInterop": true`. No changes are required to these fields. However, the file uses JSON-with-comments syntax (double-slash comments and trailing commas) that TypeScript's `tsc` tolerates but standard JSON parsers do not. Remove the comments and trailing commas so the file is valid strict JSON. The current settings are suitable for the extension target (CommonJS module output targeting ES2020 with declaration files emitted to `dist/` alongside compiled JavaScript), so no compiler option values need to change.

Delete `DEEPWORK.md` from the project root. This file contained the placeholder implementation plan that was drafted before the pipeline produced its formal artifacts. The canonical specification now lives in `.pipeline/qrspi-20260523-024715/` — specifically in `requirements.md`, `design.md`, and `structure.md`. Leaving the stale root-level file would cause confusion about which document is authoritative.

Update `.gitignore` to add `.pipeline/` as an ignored path. The `dist` entry is already present on line 83 (covering the TypeScript compilation output). The `.pipeline/` directory contains run-time pipeline artifacts (state files, telemetry, stage outputs) that should not be committed to version control — each pipeline run creates its own `.pipeline/qrspi-<run-id>/` subtree that is ephemeral to that run. Adding `.pipeline/` to `.gitignore` prevents accidental commits of these run artifacts.

## Files
- `package.json` (MODIFY) — Rename to `deepwork-pi`, update description to `"QRSPI deepwork pipeline extension for pi — automated multi-stage agent orchestration via subagents"`, add `@tintinweb/pi-subagents` as a peer dependency, add `test:watch` script (`"test:watch": "npm run build && node --test --watch ./test/**/*.test.js"`), verify `"main": "dist/index.js"`
- `tsconfig.json` (MODIFY) — Remove JSON comments and trailing commas to produce valid strict JSON; no compiler option values change (CommonJS, ES2020, declaration files, rootDir=src, outDir=dist, strict, esModuleInterop all already correct)
- `agents/` (CREATE) — Empty directory for agent type `.md` files with YAML frontmatter; will be populated by later tasks; for pi-subagents discovery, users symlink into `~/.pi/agent/agents/qrspi/` or copy into `.pi/agents/`
- `skills/deepwork/` (CREATE) — Empty directory for the orchestrator skill; Task 06 will create `skills/deepwork/SKILL.md` here following pi's directory-skill convention (`<root>/.../<name>/SKILL.md`)
- `src/types/` (CREATE) — Empty directory for TypeScript interface definitions; Task 02 will create `src/types/pi-extensions.ts` here
- `DEEPWORK.md` (DELETE) — Remove root-level placeholder implementation plan; canonical specification is in `.pipeline/qrspi-20260523-024715/requirements.md`
- `.gitignore` (MODIFY) — Add `.pipeline/` entry (on its own line) to exclude run-time pipeline artifacts from version control; `dist` entry already present on line 83

## Test Expectations
- Directory creation: When `ls agents/`, `ls skills/deepwork/`, and `ls src/types/` are run from the project root, each command lists the directory as existing (they are initially empty).
- Package manifest validity: When `npm install --dry-run` is run from the project root after modifications, the command reports success with no peer dependency resolution errors and no invalid metadata warnings.
- Package identity: When `node -e "console.log(require('./package.json').name)"` is run from the project root, it prints `deepwork-pi`.
- Package peer dependency: When `node -e "console.log(JSON.stringify(require('./package.json').peerDependencies))"` is run from the project root, the output includes `"@tintinweb/pi-subagents"` as a key.
- Package scripts: When `node -e "console.log(require('./package.json').scripts['test:watch'])"` is run from the project root, it prints `npm run build && node --test --watch ./test/**/*.test.js`.
- TypeScript compilation: When `npm run build` (or `npx tsc -p tsconfig.json`) is run from the project root, compilation completes with exit code 0 and no errors. Compiled JavaScript and declaration files appear in `dist/` alongside the existing `dist/index.js` and `dist/index.d.ts`.
- tsconfig validity: When `node -e "JSON.parse(require('fs').readFileSync('tsconfig.json','utf8'))"` is run from the project root, it returns the parsed JSON object without throwing a SyntaxError (the file is now valid strict JSON with no comments or trailing commas).
- DEEPWORK.md removal: When checked, the path `DEEPWORK.md` no longer exists at the project root; a file-not-found error is returned.
- gitignore coverage: When `.gitignore` is read, the exact string `.pipeline/` appears on its own line. When `git check-ignore .pipeline/` is run from the project root, it prints `.pipeline/` (confirming the pattern is recognized).
- Existing build output preserved: When `dist/` is listed after running `npm run build`, previously compiled files (like `dist/index.js`) are regenerated alongside any new compilation outputs. The `dist` entry in `.gitignore` continues to exclude these files from version control.

## Review Status
- **Task-Spec Review:** task_spec_clean (round 2)
- **Task-Spec Conflicts:** None.
- **Plan Review:** clean (round 1)
- **Outstanding Concerns:** None.
