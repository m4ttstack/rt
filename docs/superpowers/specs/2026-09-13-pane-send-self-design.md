# rt pane send self: an agent's door into its own pane

## Problem

An agent in a herdr pane sometimes needs a user-only Claude Code command
(`/cd`, `/exit`, `/resume`) or a line typed at a peer pane. Today that costs
the same four steps every time: decide whether this is a herdr pane, find
the pane id, recall the herdr socket API, inject. The common case is `/cd`
before `EnterWorktree` when the task targets a repo other than the session's
cwd.

`rt pane send <pane> --text <text>` already carries the injection (daemon
`pane:send`, `lib/daemon/inject.ts`), including the agent-status probe, the
Enter nudge on a stall, and the `accepted | queued | refused` verdict. Two
gaps remain: nothing spells "this pane", and the daemon refuses the caller's
own pane (`refused (that is this pane)`), a guard born in `chat invite` that
rode into `pane send` through the shared helper.

## Verb

```
rt pane send self --text <text> [--then <text>] [--json]
```

- `self` is a target keyword. The CLI resolves it with `selfPaneRef()`
  (`lib/self-pane.ts`), which already addresses bg panes in ref space. When
  `HERDR_PANE_ID` is unset the CLI fails before any daemon call:
  `rt pane send: not in a herdr pane (HERDR_PANE_ID unset)`, exit 1. That
  error is the branch a skill takes to ask the human to type the line.
- For `self` the CLI omits `callerPane` from the payload, so the daemon's
  same-pane guard never fires. Any other target, including a literal copy of
  the caller's own id, still sends `callerPane` and still refuses. `self` is
  the only spelling that reaches your own pane; the daemon and rt-client are
  untouched.
- `--then <text>` queues a second line after the first. It is a second
  sequential `pane:send` to the same resolved target, sent only when the
  first was `accepted` or `queued`. It is allowed for any target.
- Self delivery always reports `queued`: the agent is mid-turn when it
  calls, so herdr sees `working`, and the line sits in the composer until
  the turn ends. The skill states this plainly.

Output. Plain: one line per delivery, `<ref> <delivered> (<reason>)` as
today, the `--then` line prefixed `then:`. JSON:
`{ ok, paneId, delivered, reason?, then?: { delivered, reason? } }`; `then`
is present only when a `--then` line was attempted.

The `--then` value is read like `--text`: a literal string, no stdin form.

## Spike (throwaway, before implementation)

Confirm on a live pane, not by reading herdr's docs:

1. `rt pane spawn --cwd <scratch> --prompt "count to 30, one number per
   second"` and take its pane id.
2. While it is working: `rt pane send <id> --text "/cd /tmp" --then "say
   done and print your cwd"`.
3. `rt pane peek <id>` after the count finishes.

Pass: both lines ran, in order, the cwd printed is `/tmp`. Three failure
modes each change the design and stop implementation until re-approved:
(a) the second line never runs (queue holds one line), (b) a local slash
command as line one swallows line two, (c) the bundled Enter is absorbed on
the working path and the text sits unsubmitted. For (c) the candidate fix is
an unconditional Enter nudge on the daemon's working path, which widens the
change into `lib/daemon/inject.ts`.

## Skills

### `rt:herdr-inject` (new, `skills/rt-herdr-inject/SKILL.md`)

Triggers: needing a user-only Claude Code slash command from inside a
session, sending a line to another agent's pane, or noticing the four-step
herdr dance about to start. Content: the one-line recipe, `queued` means
end your turn, `--then` for the continuation, the not-in-herdr fallback
(ask the human to type it; never guess a pane id), `rt pane list` for peer
ids, and the body rules (single line, no backticks in `--text`, `--text -`
for stdin when the body has quoting hazards). No herdr CLI in the recipe.

### `rt:worktree` (edit)

A "Crossing repos" section: `EnterWorktree` cannot cross repos, so when the
task's repo is not the session cwd, run
`rt pane send self --text "/cd <repo path>" --then "Continue: enter
worktree <name> for <ticket>"`, write one handoff line, end the turn.
Points at `rt:herdr-inject` for the rules.

## Testing

- `commands/__tests__/pane.test.ts`: `self` resolves from `HERDR_PANE_ID`
  (visible and bg), the payload carries no `callerPane` for `self` and does
  for a literal id, unset env fails with the exact message before any
  daemon call, `--then` sends a second call only after `accepted`/`queued`
  and not after `refused`, plain and JSON shapes.
- `lib/__tests__/picker-conformance.test.ts` stays green (the leaf keeps its
  `exempt` `omitBehavior`; `self` is a value, not a flag).
- Skills: `superpowers:writing-skills`, RED baseline on a subagent that has
  to run `/cd` from a pane without the skill, GREEN with it.

## Out of scope

Multiline bodies, a pane picker for `send`, changing `chat invite`'s
self-refusal, herdr-less fallbacks (tmux), and any daemon change unless the
spike forces one.
