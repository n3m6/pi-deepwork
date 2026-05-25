#!/usr/bin/env bash
# pi-deepwork uninstaller
#
# Removes every qrspi-*.md symlink from ~/.pi/agent/agents/ and the cloned
# repo under ~/.pi/agent/git/github.com/n3m6/pi-deepwork. Safe to re-run.

set -euo pipefail

PI_HOME="${PI_HOME:-$HOME/.pi}"
GIT_DIR="$PI_HOME/agent/git/github.com/n3m6/pi-deepwork"
AGENTS_DIR="$PI_HOME/agent/agents"

echo "==> Uninstalling pi-deepwork"

# 1. Remove qrspi-* symlinks from the flat agents dir
shopt -s nullglob
removed=0
for link in "$AGENTS_DIR"/qrspi-*.md; do
  rm -f "$link"
  removed=$((removed + 1))
done
shopt -u nullglob
echo "==> Removed $removed qrspi-* agent links from $AGENTS_DIR"

# 2. Remove the cloned repo
if [[ -d "$GIT_DIR" ]]; then
  rm -rf "$GIT_DIR"
  echo "==> Removed clone at $GIT_DIR"
else
  echo "==> No clone found at $GIT_DIR (already removed)"
fi

echo "==> Done."
