---
name: board:gate-cli-recipes
description: "Board-CLI-specific gate mechanics shared by review/respond/doctor: the background gate-wait recipe, closed-or-missing-gate terminal handling, and the failing-wait-is-not-degradation rule. Not for direct invocation; a board gate wrapper includes this part the way mattstack:gate-protocol covers the daemon-generic mechanics."
disable-model-invocation: true
---

# Board gate CLI recipes

The three parts of the status-bin wrapper's own gate mechanics that do not
belong in `mattstack:gate-protocol` (that skill speaks in terms of the raw
`rt gate` CLI and MCP tool; these three wrap `<status-bin>`, this repo's
own gate-open/wait/answer projection). Read from `board:review`,
`board:respond`, and `board:doctor` instead of restating.

## Wait recipe

**presentation "wait":** do NOT present a form. Launch ONE background shell
command (the shell tool's run-in-background mode) that loops `<status-bin>
gate wait <state> --max-ms 90000`, re-running while it prints
`{"status":"pending"}`, and exits printing the answered JSON as its last
stdout. Then END YOUR TURN in one line: `holding at gate <gateId>`. The
pane is idle but armed: typed input lands instantly, and the loop's
completion re-invokes this pane with the answer as the tool result. On
re-invoke, proceed on the answer exactly as the form branch does. A wait
that fails with a closed or not-found message is terminal: follow the
"Closed or missing gate" section below.

## Closed or missing gate

If `gate wait` fails with `gate <id> closed (<reason>)`, the decision site
itself was abandoned: superseded (a re-review relaunch, for a review gate),
abandoned, or pruned when the MR left the board. A `not-found` error or
`no gate open for <url>` mean the same thing from a different angle: the
gate this pane was tracking no longer exists to wait on. All three are
terminal, not transient: do not re-run any of them. End cleanly: say so in
the pane and stop. Do not invent an answer, do not mark `done`, and do not
write `error` either: whatever superseded this gate (a re-review pane, a
fresh pane) already owns this MR's board state, and a late write here
would stomp it.

## A failing wait is not degradation

A failing `gate wait` is not itself degradation: per the presentation
branches above, re-run it. Only if it keeps failing, and never on the
closed message or the terminal errors above (those end cleanly per
"Closed or missing gate" instead), fall through to this gate's own
degraded-mode fallback, and say why in the message.

## CAS loss and reading answers back

`<status-bin> gate answer` prints nothing and exits 0 when the pane's own
answer was recorded and stands. If it instead prints one JSON line
(`{answers, by, answeredAt}`), still exit 0, someone answered first through
another surface: that printed answer is the recorded one. Proceed on it,
not on the conversational answer given in the pane, and tell the human
which answer won.

Whether the answer came from `gate wait` or a CAS-loss line, the `action`
answer may be the bare option string (or array) or a `{value, note}`
object; read `value` in the object case.
