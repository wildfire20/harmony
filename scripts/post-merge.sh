#!/usr/bin/env bash
set -euo pipefail

# Post-merge setup for Harmony Learning Institute.
# This script is intentionally non-interactive because it runs with stdin closed.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEPENDENCY_FILES=(package.json package-lock.json client/package.json client/package-lock.json)
DEPENDENCIES_CHANGED=false

# A task merge normally preserves installed dependencies. Only reinstall when
# one of the dependency manifests changed in the merge, avoiding unnecessary
# network requests and package-firewall failures for code-only changes.
if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  if ! git diff --quiet HEAD^ HEAD -- "${DEPENDENCY_FILES[@]}"; then
    DEPENDENCIES_CHANGED=true
  fi
else
  DEPENDENCIES_CHANGED=true
fi

if [[ "$DEPENDENCIES_CHANGED" == "true" ]]; then
  echo "Dependency manifests changed; installing server dependencies..."
  npm ci --no-audit --no-fund

  if [[ -f client/package-lock.json ]]; then
    echo "Installing client dependencies..."
    npm --prefix client ci --no-audit --no-fund
  fi
else
  echo "Dependency manifests unchanged; reusing installed dependencies."
fi

echo "Building client..."
npm run build-client

echo "Post-merge setup completed successfully."