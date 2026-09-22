#!/bin/sh
# open-gate.sh -- open a respond gate from a domain skill's fitted open file.
#   open-gate.sh <status-bin> <state> <kind> <open-file>
# The open file is gate-ctx.sh `fit` output: {"context": <string>,
# "questions": [...]} with every context already a string. Opens it through
# `<status-bin> gate open`, printing that command's JSON line and exiting
# with its status, after two mechanical changes:
#   - the pane-only `next` question is dropped;
#   - while the gate context plus every question context is 8192 UTF-8
#     bytes or more (a `fits: false` file), whole question contexts are
#     dropped, largest first, ties to the earliest question. Nothing is
#     trimmed mid-text.
# Exit 1: the file is not a gate open. Exit 2: usage.
set -u

[ $# -eq 4 ] || { echo "usage: open-gate.sh <status-bin> <state> <kind> <open-file>" >&2; exit 2; }
BIN=$1; STATE=$2; KIND=$3; OPEN=$4
command -v jq > /dev/null 2>&1 || { echo "open-gate: jq is required but not on PATH" >&2; exit 2; }

FITTED=$(jq -ce '
  def total: (.context // "" | utf8bytelength)
    + ([.questions[] | .context // empty | utf8bytelength] | add // 0);
  select(type == "object" and (.questions | type) == "array")
  | .questions |= map(select(.id != "next"))
  | until(total < 8192 or all(.questions[]; has("context") | not);
      ([.questions | to_entries[] | select(.value | has("context"))
        | {i: .key, b: (.value.context | utf8bytelength)}]
       | sort_by(-.b, .i) | first.i) as $i
      | .questions[$i] |= del(.context))
' "$OPEN" 2> /dev/null) || { echo "open-gate: $OPEN is not a gate open file" >&2; exit 1; }

QUESTIONS=$(printf '%s' "$FITTED" | jq -c .questions)
if printf '%s' "$FITTED" | jq -e 'has("context")' > /dev/null; then
  exec "$BIN" gate open "$STATE" --kind "$KIND" --questions "$QUESTIONS" \
    --context "$(printf '%s' "$FITTED" | jq -r .context)"
fi
exec "$BIN" gate open "$STATE" --kind "$KIND" --questions "$QUESTIONS"
