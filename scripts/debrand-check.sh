#!/usr/bin/env bash
set -euo pipefail
PATTERN='hasura|promptql|graphiql|walktour|console'
# The web console API (console.log and friends), test spies on it, and the
# no-console lint rule name are the only legitimate uses of the word;
# everything else is provenance language the kit must not carry.
ALLOW='console\.(log|warn|error|info|debug|table|group|groupEnd|count|time|timeEnd)|spyOn\(console|consoleError|consoleWarn|no-console'
# --exclude=debrand-check.sh: this file's own PATTERN line contains the banned
# words as literal text (that's the point of the pattern); grep would
# otherwise flag itself as a violation, so it excludes its own filename.
HITS=$(grep -riEn "$PATTERN" --exclude-dir={node_modules,.git,dist,storybook-static,.superpowers} --exclude=debrand-check.sh --exclude=FEEDBACK-*.md . | grep -viE "$ALLOW" || true)
if [ -n "$HITS" ]; then
  echo "De-brand gate FAILED:"
  echo "$HITS"
  exit 1
fi
echo "De-brand gate passed."
