#!/usr/bin/env bash
# pi-deepwork installer wrapper

set -euo pipefail

REPO_REF="${PI_DEEPWORK_REF:-git:github.com/n3m6/pi-deepwork@main}"

if ! command -v pi >/dev/null 2>&1; then
  echo "ERROR: pi is required to install pi-deepwork." >&2
  echo "Install pi first, then run:" >&2
  echo "  pi install $REPO_REF" >&2
  exit 1
fi

echo "==> Installing pi-deepwork via pi"
pi install "$REPO_REF"

echo "==> Done. Open a new pi session and run:"
echo "      /deepwork <task>"
