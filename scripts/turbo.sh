#!/usr/bin/env bash
# The one entry point for turbo.
#   scripts/turbo.sh <task>... [turbo flags]
#   scripts/turbo.sh check [turbo flags]     every gate ci.yml runs
# The cache lives in the repo's common git dir so every worktree of this
# checkout shares it, and CI restores the same path.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
# Run the Node shim under bun: a version-manager node shim cannot start under the HOME the test preload repoints.
turbo="$root/node_modules/turbo/bin/turbo"
cache="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)/turbo-cache"

if [ "${1:-}" != check ]; then
  exec bun "$turbo" run --cache-dir="$cache" "$@"
fi
shift

# --affected walks the package graph, not task inputs. The codegen gates,
# the root gates and the tokens suite read trees the graph does not connect
# them to, so they run on every check and let their declared inputs decide
# the cache hit.
always_flags=()
# Invocation 1 already carries --concurrency=1; turbo refuses the flag twice.
serial_flags=()
for flag in "$@"; do
  if [ "$flag" != --affected ]; then
    always_flags+=("$flag")
    case "$flag" in
      --concurrency*) ;;
      *) serial_flags+=("$flag") ;;
    esac
  fi
done

# The two codegen gates rewrite files the package tests read, so they run
# alone and one at a time before anything else.
bun "$turbo" run --cache-dir="$cache" gates tokens:fresh --filter=@mattstack/tui-kit --filter=// --concurrency=1 \
  ${serial_flags[@]+"${serial_flags[@]}"}

pkg_flags=("$@")
if [ "$(uname)" != Darwin ]; then
  pkg_flags+=('--filter=!deck')
fi
bun "$turbo" run --cache-dir="$cache" typecheck lint test serve-check \
  ${pkg_flags[@]+"${pkg_flags[@]}"}

bun "$turbo" run --cache-dir="$cache" lint:root format:check build-storybook treeshake purity scripts:test test \
  --filter=// --filter=@mattstack/tokens \
  ${always_flags[@]+"${always_flags[@]}"}
