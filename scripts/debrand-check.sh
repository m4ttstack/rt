#!/usr/bin/env bash
set -euo pipefail
PATTERN='hasura|promptql|graphiql|walktour'
# `console` is deliberately NOT in that list here, unlike in mantine-kit.
#
# The kit bans it because the kit descends from a Hasura console, so the word
# is provenance leaking into every scaffold. In THIS app it means
# `m4ttstack/console`, the sibling app whose Tokyo theme this one consumes
# (`@mattstack/mantine-tokyo`) and whose resolved values the artboards under
# `design/` were generated from. Those references are the point, not a leak:
# `design/CONFORMANCE.md` cites console's own files as the source of truth
# for every dimension in the design.
#
# The ALLOW list below is kept because the web console API is still a
# legitimate use that a future re-ban would have to exempt.
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
