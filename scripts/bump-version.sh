#!/usr/bin/env bash
#
# Bump version in all three source-of-truth files:
#   - package.json
#   - src-tauri/tauri.conf.json
#   - src-tauri/Cargo.toml
#
# Usage:
#   ./scripts/bump-version.sh 1.4.0
#   ./scripts/bump-version.sh          # prompts for version

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PKG="$ROOT_DIR/package.json"
TAURI="$ROOT_DIR/src-tauri/tauri.conf.json"
CARGO="$ROOT_DIR/src-tauri/Cargo.toml"

# --- Resolve new version ---

NEW_VERSION="${1:-}"

if [[ -z "$NEW_VERSION" ]]; then
  CURRENT=$(grep -m1 '"version"' "$PKG" | sed 's/.*: *"\(.*\)".*/\1/')
  printf "Current version: %s\nNew version: " "$CURRENT"
  read -r NEW_VERSION
fi

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 1.4.0)" >&2
  exit 1
fi

# --- Update files ---

# package.json — match the "version" line (top-level, 2nd-4th line typically)
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PKG"

# tauri.conf.json — same pattern
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$TAURI"

# Cargo.toml — only replace the [package] version (line 3), not dependency versions
sed -i '' '3s/^version = "[^"]*"/version = "'"$NEW_VERSION"'"/' "$CARGO"

# --- Verify ---

echo "Updated to $NEW_VERSION:"
grep -n '"version"' "$PKG" | head -1
grep -n '"version"' "$TAURI" | head -1
grep -n '^version' "$CARGO" | head -1
