# pi-deepwork

A markdown prompt pack for [pi](https://github.com/mariozechner/pi-coding-agent) that adds a `/deepwork` skill: a structured QRSPI pipeline (**G**oals → **Q**uestions → **R**esearch → **D**esign → **S**tructure → **P**lan → **I**mplement → **A**ccept-Test → **R**eplan → **V**erify → **R**eport) executed by 55 specialised `qrspi-*` subagents.

This used to be a TypeScript extension. It is now plain markdown — no build step, no `dist/`, nothing to compile. pi auto-discovers the skill from the git clone path, and a tiny zero-dependency `postinstall` hook ([scripts/postinstall.mjs](scripts/postinstall.mjs)) symlinks the bundled `qrspi-*` agents into the directory [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) scans.

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
- The [`pi-intercom`](https://github.com/nicobailon/pi-intercom) extension installed and active so subagents can surface questions to you:
  ```bash
  pi install npm:pi-intercom
  ```
  `pi-intercom` must remain enabled (`enabled: true` in `~/.pi/agent/intercom/config.json`, which is the default). The pi-subagents intercom bridge auto-registers a `contact_supervisor` tool in each deepwork child agent. When a child needs a decision from you, it sends a structured question to the top-level orchestrator session, which forwards it to you via `ask_user` and relays your answer back. Naming your top-level pi session with `/name <something>` before running `/deepwork` improves recipient clarity in multi-session setups, but is not required — pi-intercom provides a fallback alias automatically.
- `git` available on `PATH` for stage-boundary checkpoint commits (optional — the pipeline degrades gracefully without it).

## Install

With pi (recommended — single command):

```bash
pi install git:github.com/n3m6/pi-deepwork@main
```

Pi clones the repo into `~/.pi/agent/git/github.com/n3m6/pi-deepwork/` and auto-runs `npm install`, which triggers the bundled `postinstall` hook. The hook detects it is running inside a pi clone and symlinks `agents/qrspi-*.md` into `~/.pi/agent/agents/` (or `$PI_CODING_AGENT_DIR/agents/` if that env var is set). After install, restart pi or open a new pi session so `pi-subagents` rescans agents.

For project-scope installs:

```bash
pi install -l git:github.com/n3m6/pi-deepwork@main
```

The hook then links into `<workspace>/.pi/agents/` instead.

### Without pi (manual)

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
- [scripts/postinstall.mjs](scripts/postinstall.mjs) — zero-dep Node hook that symlinks agents on `pi install` / `pi update`.
- [test/](test/) — structural `node --test` checks on the markdown files plus subprocess coverage of the postinstall hook. No build step, no dependencies.
- [install.sh](install.sh), [uninstall.sh](uninstall.sh) — one-shot install/remove scripts for users without pi.

## Uninstall

If you installed with pi:

```bash
pi remove git:github.com/n3m6/pi-deepwork
rm -f ~/.pi/agent/agents/qrspi-*.md
```

The explicit `rm -f` is needed because `pi remove` deletes the clone but does not clean the symlinks the postinstall hook created. Any leftover `qrspi-*` symlinks become broken at that point; the next `pi install`/`pi update` of pi-deepwork would also prune them automatically.

Without pi:

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
