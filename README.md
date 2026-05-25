# pi-deepwork

A markdown prompt pack for [pi](https://github.com/mariozechner/pi-coding-agent) that adds a `/deepwork` skill: a structured QRSPI pipeline (**G**oals → **Q**uestions → **R**esearch → **D**esign → **S**tructure → **P**lan → **I**mplement → **A**ccept-Test → **R**eplan → **V**erify → **R**eport) executed by 55 specialised `qrspi-*` subagents.

This used to be a TypeScript extension. It is now plain markdown — no build step, no `dist/`, nothing to compile. pi auto-discovers the skill from the git path and [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) auto-discovers the agents from `~/.pi/agent/agents/`.

## Prerequisites

- [`pi`](https://github.com/mariozechner/pi-coding-agent) installed and on `PATH`.
- The [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) extension installed and active:
  ```bash
  pi install npm:@tintinweb/pi-subagents
  ```
- The [`pi-ask-user`](https://github.com/mariozechner/pi-ask-user) extension installed and active for interactive human gates:
  ```bash
  pi install npm:pi-ask-user
  ```
- `git` available on `PATH` for stage-boundary checkpoint commits (optional — the pipeline degrades gracefully without it).

## Install

```bash
git clone https://github.com/n3m6/pi-deepwork ~/.pi/agent/git/github.com/n3m6/pi-deepwork
mkdir -p ~/.pi/agent/agents
ln -sf ~/.pi/agent/git/github.com/n3m6/pi-deepwork/agents/qrspi-*.md ~/.pi/agent/agents/
```

Or run the bundled [install.sh](install.sh):

```bash
curl -sSL https://raw.githubusercontent.com/n3m6/pi-deepwork/main/install.sh | bash
```

(Always read a `curl | bash` script before piping it. The repo copy is [install.sh](install.sh).)

### Verify

```bash
ls ~/.pi/agent/agents/qrspi-*.md | wc -l   # should print 55
```

Inside pi:

```text
subagent list | grep qrspi-                # should list 55 qrspi-* agents
```

## Use

Start a new pipeline run by invoking `/deepwork` with a task description:

```text
/deepwork create a typescript project with an express server with an endpoint "/health"
```

The skill will:

1. Generate a run ID `qrspi-YYYYMMDD-HHMMSS`
2. Scaffold `.pipeline/<run-id>/` in the active workspace
3. Create a git branch `qrspi/<run-id>` (if `git` is available)
4. Dispatch the QRSPI stages sequentially via the native `Agent` tool
5. Commit a checkpoint after every stage boundary
6. Write structured telemetry to `.pipeline/<run-id>/telemetry/events.jsonl`

### Resume a previous run

```text
/deepwork resume run-id:qrspi-20260525-153000
```

The skill recovers from `.pipeline/<run-id>/state.md` and continues from the recorded `next_stage`.

## How it works

```
Full Pipeline:

  Goals → Research → Design → Structure → Plan → (Implement → Accept-Test → Replan)* → Verify → Report
   🔒                  🔒        🔒                                                       ↺ max 3

Quick-Fix Pipeline:

  Goals → Research → Plan → Implement → Accept-Test → Verify → Report
```

🔒 = interactive human gate (suppressed in `automated` interaction mode).

The orchestrator (`skills/deepwork/SKILL.md`) is a thin dispatcher. Each stage is handled by a dedicated stage subagent (`agents/qrspi-<stage>.md`), which in turn dispatches its own leaf subagents. The orchestrator never writes code; it only writes pipeline state and telemetry files under `.pipeline/<run-id>/`.

See [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) for the full stage spec, return contract, telemetry schema, and resume algorithm.

## Repository layout

- [agents/](agents/) — 55 `qrspi-*.md` stage and leaf subagent definitions.
- [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md) — the orchestrator skill.
- [test/](test/) — structural `node --test` checks on the markdown files. No build step, no dependencies.
- [install.sh](install.sh), [uninstall.sh](uninstall.sh) — one-shot install/remove scripts.

## Uninstall

```bash
rm -f ~/.pi/agent/agents/qrspi-*.md
rm -rf ~/.pi/agent/git/github.com/n3m6/pi-deepwork
```

Or run [uninstall.sh](uninstall.sh).

## Local development

The repo has no runtime dependencies. Tests run under plain Node 18+:

```bash
npm test                # runs node --test on the structural test files
```

There is no build, lint, format, or typecheck step. To change pipeline behaviour, edit [skills/deepwork/SKILL.md](skills/deepwork/SKILL.md). To change an individual stage's prompt, edit the corresponding [agents/qrspi-\*.md](agents/) file.

## License

MIT. See [LICENSE](LICENSE).
