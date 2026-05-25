#!/usr/bin/env bash
# pi-deepwork installer
#
# Clones (or updates) the pi-deepwork repo into pi's git agent cache and
# symlinks every qrspi-*.md into ~/.pi/agent/agents/ so @tintinweb/pi-subagents
# picks them up automatically. Idempotent: safe to re-run.
#
# Usage:
#   ./install.sh
#   curl -sSL https://raw.githubusercontent.com/n3m6/pi-deepwork/main/install.sh | bash

set -euo pipefail

REPO_URL="${PI_DEEPWORK_REPO:-https://github.com/n3m6/pi-deepwork}"
PI_HOME="${PI_HOME:-$HOME/.pi}"
GIT_DIR="$PI_HOME/agent/git/github.com/n3m6/pi-deepwork"
AGENTS_DIR="$PI_HOME/agent/agents"

echo "==> Installing pi-deepwork"
echo "    repo:   $REPO_URL"
echo "    clone:  $GIT_DIR"
echo "    agents: $AGENTS_DIR"

# 1. Clone or update the repo
if [[ -d "$GIT_DIR/.git" ]]; then
  echo "==> Updating existing clone"
  git -C "$GIT_DIR" pull --ff-only
else
  echo "==> Cloning repo"
  mkdir -p "$(dirname "$GIT_DIR")"
  git clone "$REPO_URL" "$GIT_DIR"
fi

# 2. Ensure the agents directory exists
mkdir -p "$AGENTS_DIR"

# 3. Symlink every qrspi-*.md into the flat agents directory.
#    Use -f so re-runs replace stale links without erroring.
shopt -s nullglob
count=0
for src in "$GIT_DIR"/agents/qrspi-*.md; do
  ln -sf "$src" "$AGENTS_DIR/$(basename "$src")"
  count=$((count + 1))
done
shopt -u nullglob

if [[ "$count" -eq 0 ]]; then
  echo "ERROR: no qrspi-*.md agents found under $GIT_DIR/agents/" >&2
  exit 1
fi

echo "==> Linked $count qrspi-* agents into $AGENTS_DIR"

# 4. Ensure pi-intercom is installed (needed for subagent → user question routing)
if command -v pi &> /dev/null; then
  echo "==> Installing pi-intercom (required for interactive human gates in subagents)"
  pi install npm:pi-intercom || echo "WARN: pi-intercom install failed — interactive mode will not work. Run: pi install npm:pi-intercom"
else
  echo "WARN: pi not found on PATH — skipping pi-intercom install. Run: pi install npm:pi-intercom"
fi

echo "==> Done. Restart pi (or open a new pi session) and run:"
echo "      /deepwork"
