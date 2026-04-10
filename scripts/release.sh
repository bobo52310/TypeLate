#!/usr/bin/env bash
#
# Release script: bump version → commit → tag → push to GitHub
#
# Usage:
#   ./scripts/release.sh patch      # 1.4.2 → 1.4.3
#   ./scripts/release.sh minor      # 1.4.2 → 1.5.0
#   ./scripts/release.sh major      # 1.4.2 → 2.0.0
#   ./scripts/release.sh 1.5.0      # explicit version
#   ./scripts/release.sh            # interactive prompt
#
#   pnpm release patch              # same via npm script

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PKG="$ROOT_DIR/package.json"
TAURI="$ROOT_DIR/src-tauri/tauri.conf.json"
CARGO="$ROOT_DIR/src-tauri/Cargo.toml"

# ── helpers ─────────────────────────────────────────────────────────────────

# Print to stderr so it's visible even when stdout is piped
info()  { echo "  $*"; }
ok()    { echo "✓ $*"; }
err()   { echo "✗ $*" >&2; }

semver_bump() {
  local version="$1" bump="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$version"
  case "$bump" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

# ── resolve versions ─────────────────────────────────────────────────────────

CURRENT=$(grep -m1 '"version"' "$PKG" | sed 's/.*: *"\(.*\)".*/\1/')
ARG="${1:-}"

if [[ -z "$ARG" ]]; then
  echo ""
  echo "Current version: $CURRENT"
  printf "Bump type [patch/minor/major] or explicit version: "
  read -r ARG
fi

case "$ARG" in
  patch|minor|major)
    NEW_VERSION=$(semver_bump "$CURRENT" "$ARG")
    ;;
  *)
    NEW_VERSION="$ARG"
    ;;
esac

if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  err "Version must be semver (e.g. 1.5.0)"
  exit 1
fi

TAG="v$NEW_VERSION"

echo ""
echo "  $CURRENT  →  $NEW_VERSION"
echo ""
printf "Proceed? [y/N] "
read -r confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

# ── pre-flight checks ────────────────────────────────────────────────────────

cd "$ROOT_DIR"

# Ensure working tree is clean (version files aside)
if ! git diff --quiet --ignore-submodules -- \
    ":!$PKG" ":!$TAURI" ":!$CARGO" 2>/dev/null; then
  err "Working tree has uncommitted changes — commit or stash them first."
  git status --short
  exit 1
fi

# Ensure tag doesn't already exist
if git rev-parse "$TAG" &>/dev/null; then
  err "Tag $TAG already exists."
  exit 1
fi

# ── update version files ─────────────────────────────────────────────────────

sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PKG"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$TAURI"
# Cargo.toml: only the [package] version is on line 3
sed -i '' '3s/^version = "[^"]*"/version = "'"$NEW_VERSION"'"/' "$CARGO"

ok "Updated package.json, tauri.conf.json, Cargo.toml → $NEW_VERSION"

# ── commit + tag + push ───────────────────────────────────────────────────────

git add "$PKG" "$TAURI" "$CARGO"
git commit -m "chore: bump version to $NEW_VERSION"
ok "Committed version bump"

git tag "$TAG"
ok "Created tag $TAG"

git push
git push origin "$TAG"
ok "Pushed commit + tag to GitHub"

echo ""
echo "Released $TAG"
