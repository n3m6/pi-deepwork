#!/usr/bin/env bash
# pi-deepwork uninstaller wrapper

set -euo pipefail

REPO_REF="${PI_DEEPWORK_REF:-git:github.com/n3m6/pi-deepwork}"

if ! command -v pi >/dev/null 2>&1; then
  echo "ERROR: pi is required to remove pi-deepwork cleanly." >&2
  echo "Run this once pi is available:" >&2
  echo "  pi remove $REPO_REF" >&2
  exit 1
fi

echo "==> Removing pi-deepwork via pi"
pi remove "$REPO_REF"

echo "==> Done."
