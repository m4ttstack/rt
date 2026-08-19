#!/bin/sh
# Fresh-clone setup. @soribashi/theme and @soribashi/factory are declared BOTH
# as direct `dependencies` (file:) AND as `overrides` targets (the overrides
# still wire core's and codegen's own internal "workspace:*" requests). The
# overrides alone do not reach a nested workspace:* dependency one level
# inside an already-overridden file: package: with only core/codegen as
# direct deps, @soribashi/factory's own "@soribashi/theme": "workspace:*"
# never got linked into factory's install location, on Bun 1.3.13, no matter
# how many times `bun install` was re-run. Declaring theme/factory directly
# puts them in root node_modules, where factory's runtime walk-up resolution
# finds them regardless of the unresolved nested link.
#
# TWO installs remain load-bearing, but not for the reason originally assumed.
# Now that direct deps fix the wiring, a single install is USUALLY enough —
# but on a genuinely clean node_modules the first install occasionally hits a
# transient "EEXIST: failed to link package" race (observed ~1/3 of clean
# runs), because @soribashi/theme is linked via two paths (the direct dep and
# the override target) concurrently; that race exits `bun install` non-zero
# even though node_modules ends up correct. The first install below is
# allowed to fail for that reason; the second install is the one whose exit
# status is trusted. Precondition: ../soribashi has itself been `bun
# install`ed (resolution escapes to its node_modules).
set -e
if [ ! -d ../soribashi/node_modules ]; then
  echo "ERROR: ../soribashi is not installed — run 'bun install' there first" >&2
  exit 1
fi
bun install || true
bun install
