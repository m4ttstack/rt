#!/bin/sh
# Certification gate: purity + green suite. Run from the repo root.
# Exits nonzero on any failure; never pipe the test run.
set -eu

if [ ! -f package.json ] || [ ! -d core ] || [ ! -d src ]; then
  echo "FAIL: run this script from the repo root (package.json, core/, src/ not found here)."
  exit 1
fi

echo "== purity greps =="
    # update.ts/update.test.ts/release.sh carry the sanctioned REPO constant
    # (the plan's one-constant repo-rename rule) -- "m4ttheweric" matches the
    # "m4tthew" substring but is a legitimate, intentional value, not a leak.
hits=$(grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.local-dev \
    --exclude-dir=docs --exclude=migrate.ts --exclude=migrate.test.ts --exclude=certify.sh \
    --exclude=update.ts --exclude=update.test.ts --exclude=release.sh \
    -e "m4tthew" -e "matthewgoodwin" -e "/Users/matt" \
    core src scripts package.json README.md 2>/dev/null) || true
if [ -n "$hits" ]; then
  echo "$hits"
  echo "FAIL: Matt-shaped constants remain (above)."
  exit 1
fi
echo "purity: clean"

echo "== suite =="
bun test

echo "CERTIFIED"
