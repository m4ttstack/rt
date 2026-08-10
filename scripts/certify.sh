#!/bin/sh
# Certification gate: purity + green suite. Run from the repo root.
# Exits nonzero on any failure; never pipe the test run.
set -eu

echo "== purity greps =="
hits=$(grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.local-dev \
    --exclude-dir=docs --exclude=migrate.ts --exclude=migrate.test.ts --exclude=certify.sh \
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
