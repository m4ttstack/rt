#!/usr/bin/env bash
set -euo pipefail
# `console` is deliberately absent: this app IS the mattstack console, so the
# word is its own name rather than inherited provenance. The rest stay banned.
PATTERN='hasura|promptql|graphiql|walktour'
# --exclude=debrand-check.sh: this file's own PATTERN line contains the banned
# words as literal text (that's the point of the pattern); grep would
# otherwise flag itself as a violation, so it excludes its own filename.
HITS=$(grep -riEn "$PATTERN" --exclude-dir={node_modules,.git,dist,storybook-static,.superpowers} --exclude=debrand-check.sh --exclude=FEEDBACK-*.md . || true)
if [ -n "$HITS" ]; then
  echo "De-brand gate FAILED:"
  echo "$HITS"
  exit 1
fi
echo "De-brand gate passed."
