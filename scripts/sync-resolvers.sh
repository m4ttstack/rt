#!/bin/sh
# sync-resolvers.sh -- resync every vendored resolve-args.sh under skills/
# with the canonical copy in mattstack-skills, and report what was synced.
#
# BOARD-15: the three wrapper skills (skills/review, skills/respond,
# skills/doctor) each vendor a copy of parameterized-skills' resolve-args.sh
# because a skill can't reach outside its own directory at runtime. The
# vendored copies must be byte-identical to the canonical --
# src/__tests__/skills-resolve.test.ts asserts this whenever a
# mattstack-skills checkout is present. Run this after the canonical resolver
# changes upstream.
#
# Canonical source: $MATTSTACK_SKILLS_REPO (default
# ~/Documents/GitHub/mattstack-skills)/plugin/skills/parameterized-skills/scripts/resolve-args.sh
# Requires: sh, find, jq.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
canonical_repo="${MATTSTACK_SKILLS_REPO:-$HOME/Documents/GitHub/mattstack-skills}"
canonical="$canonical_repo/plugin/skills/parameterized-skills/scripts/resolve-args.sh"
plugin_json="$canonical_repo/.claude-plugin/plugin.json"

if [ ! -f "$canonical" ]; then
  echo "sync-resolvers: canonical resolver not found at $canonical" >&2
  exit 1
fi
if [ ! -f "$plugin_json" ]; then
  echo "sync-resolvers: plugin.json not found at $plugin_json" >&2
  exit 1
fi

version=$(jq -r '.version' "$plugin_json")

find "$repo_root/skills" -type f -name "resolve-args.sh" | while IFS= read -r target; do
  cp "$canonical" "$target"
  chmod +x "$target"
  echo "synced $target from mattstack $version"
done
