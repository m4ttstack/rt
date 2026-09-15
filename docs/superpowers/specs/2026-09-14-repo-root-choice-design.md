# Let the user choose where their repos go

**Date:** 2026-09-14
**Status:** Design, pre-implementation

## Problem

On a machine where none of `~/Documents/GitHub`, `~/GitHub`, `~/code` or
`~/src` exists, `settings.seed` creates `~/Documents/GitHub` and seeds
`rt.repoRoots` with it. On a machine where one of them does exist, it adopts
the first match. Neither path asks, and nothing in the wizard mentions that a
directory was created or chosen. `grep -rn "repoRoots" rt-tray/Sources/`
returns nothing: the app never surfaces the question at all.

Three things are wrong with that.

**It is one person's convention, hardcoded.** `CANDIDATE_ROOT_NAMES` is
`["Documents/GitHub", "GitHub", "code", "src"]` and the entry rt *creates* is
always the first. Someone who keeps code in `~/dev` gets a directory they did
not ask for, with their team's repos cloned into it, somewhere they will not
look.

**`~/Documents` is TCC-protected.** rt holds Full Disk Access, so rt never
sees a problem. Everything else on the machine can: the user's editor, their
terminal's git, any agent or helper that later touches those repos. A wedged
`tccd` is already on record in this estate as a failure mode.

**It is silent.** No prompt, nothing on the Done screen, no row in the
checklist.

The detection itself is good and stays. What has to stop is rt deciding.

## Design

### The `repos.root` row

A new checklist row, in the same group as the other tool rows.

| | |
|---|---|
| `id` | `repos.root` |
| `kind` | `tool` |
| `title` | Repo folder |
| `required` | `true` |
| `recheck` | `on-activate` |

It renders when **either** the user is setting up a team right now, **or** a
team already on this machine declares tracked repos:

```
team.mode !== "none" || snapshot.trackingIdentities.length > 0
```

Both halves are needed, and the reason is the whole reason an earlier draft of
this design was wrong.

**`trackingIdentities` alone is empty exactly when it matters.** It comes from
`mattstack.tracking`, a team-scoped key read out of
`~/.mattstack/teams/<slug>/mattstack/settings.team.jsonc`. On a joiner's fresh
Mac that clone does not exist until `team.join`, which runs **inside** Install.
`enrichSnapshotForge` back-fills `integrations.forge` from the invite pointer
but never tracking. So at checklist time a joiner's `trackingIdentities` is
`[]`, the row would not render, `canInstall` would be true, Install would run
with no repo root, and `repos.clone` would skip. A first-time joiner would
clone zero repos: a regression caused by the fix.

**`team.mode` alone goes blind after Install.** `teamRefFromIntent` returns
`mode: "none"` for a machine whose teams are already cloned, because there is
no live intent any more. A root that later went missing would then have no row
to report it.

Together they cover both: the intent carries the pre-Install case, the snapshot
carries the post-Install case.

A genuinely team-less install (no intent, no cloned team) still never sees the
row, which is the original ruling. A solo user who later joins a team meets the
question at that point.

Three states:

| Condition | Status | Detail | Action |
|---|---|---|---|
| `rt.repoRoots[0]` set, exists, and is a usable directory | `ready` | names the path, plus the TCC note when it applies | none |
| `rt.repoRoots` unset | `needs-you` | "choose where rt should clone your team's repos" | choose-folder |
| set, but missing or unusable | `needs-you` | names the path and what is wrong with it | choose-folder |

The row and the verb share one validator (`checkRepoRoot`), so "the row says
ready" and "the verb would accept it" can never disagree. A path that exists
but is a file, or is not writable, reads `needs-you` rather than `ready`,
because `repos.clone` would fail on it.

The read of `rt.repoRoots` is wrapped in try/catch. `getSetting` on this key has
a documented throw path for an authored `${repoRoot}` value, and `lib/repo-index.ts`
already guards it for that reason. Unguarded here, a throw propagates to
`buildGroup`'s catch, which replaces every tools row with a single required
`tools.group-error` row whose only action re-runs the same failing read: a
permanently unclearable Install block, fixable only by hand-editing the machine
store. A throw must read as `needs-you` with the picker offered, never as an
exception.

`required: true` means Install cannot start until the question is answered.
That ordering is deliberate: choose, then clone. It also means the row must
obey the rule in §9 of the distribution checklist... a row that only Install
can satisfy must not gate Install. This row is satisfied by the user, before
Install, so it is not in that class and must NOT be added to
`INSTALL_SATISFIED_IDS`.

### What `settings.seed` becomes

`detectOrCreateDefaultRoot` is deleted, and so are `detectRepoRoots`,
`CANDIDATE_ROOT_NAMES` and `DEFAULT_ROOT_NAME`. The candidate list moves to the
new `lib/setup/repo-root.ts` and lives in exactly one place; leaving a second
copy behind in `settings.ts` is how the two drift.

`settings.seed` no longer writes `rt.repoRoots` and no longer calls `mkdirp`.
rt stops creating directories on anyone's machine. Detection survives only as
the *starting directory* the folder panel opens at, which is a suggestion the
user confirms rather than a decision rt makes.

`repos.clone`'s existing `skipped` branch already covers "no root configured
yet" and needs no change. It stays reachable: the GUI answers the row before
Install, but a CLI install can still reach Install with the row unanswered.

### The CLI has to be able to answer it too

`rt setup apply` in a terminal cannot open a folder panel, so a required row
whose only affordance is a GUI action would dead-end a CLI install. Two things
prevent that:

- The row's `detail` names the verb (`rt setup repo-root set`) as well as
  describing the problem, so `missingRowLines` in `commands/setup.ts` prints
  something a terminal user can act on rather than just a row title and a
  button label they cannot click.
- `rt setup repo-root set` accepts the path as an argument as well as on stdin.
  Reading stdin unconditionally would block on EOF at a real terminal, which is
  why `connectCredential` checks `isTTY()` before any stdin read. This verb
  follows that precedent: a TTY with no argument prompts, a pipe reads stdin.

### The action

A new variant on the `Action` union in `lib/setup/contract.ts`:

```ts
| { type: "choose-folder"; label: string; startAt: string | null }
```

`startAt` is the first detected candidate, or null when none exists. It is a
suggestion for where the panel opens, never a value rt writes.

Swift side, `rt-tray/Sources-core/Contract/PlanModels.swift`:

- `ActionType` gains `case chooseFolder = "choose-folder"`
- `RowAction` gains `public var startAt: String?`

`ActionType.init(from:)` already maps an unrecognized string to `.unknown`,
and the dispatcher returns `.none` for `.unknown`, so an older tray meeting
this action renders a dead button rather than failing the decode. rt ships
inside the app bundle so the two move together in practice, but the
degradation is worth keeping.

### The dispatcher

`RowActionDispatcher` mirrors `connect` exactly, which is the existing
two-phase pattern: first dispatch collects, second dispatch acts.

```
case .chooseFolder:
    if let path = fieldValues?["root"] {
        return .rtVerb(args: ["setup", "repo-root", "set", "--json"], stdin: json(["root": path]))
    }
    return .chooseFolder(startAt: action.startAt)
```

`DispatchedAction` gains `case chooseFolder(startAt: String?)`.

`ChecklistScreen`'s switch gains one case that runs `NSOpenPanel` with
`canChooseDirectories = true`, `canChooseFiles = false`, and
`canCreateDirectories = true` so the user can make a folder in place rather
than cancelling out to Finder. On a chosen URL it re-dispatches the same
action with `fieldValues: ["root": url.path]`. On cancel it does nothing:
no error, no state change.

Reusing the existing `fieldValues` channel rather than adding a parallel one
keeps the second dispatch identical in shape to `connect`'s, which is what
makes this a small change rather than a new mechanism.

### The verb

`rt setup repo-root set --json`, taking the path as an argument or, from a
pipe, as `{"root": "<path>"}` on stdin.

A new verb rather than `rt settings set rt.repoRoots`, because `settings set`
accepts any JSON value and would happily record a path that does not exist.
This verb validates through the same `checkRepoRoot` the row uses:

- the path must exist and be a directory
- it must be writable by the current user
- `~` and `${home}` are expanded before validation, matching what the
  `rt.repoRoots` registry entry documents

On success it writes `rt.repoRoots` to the **machine** scope, matching the
registry entry's `scopes: ["machine"]`.

**A validation failure exits 2, not 1.** `RtResult.userError` decodes the JSON
error envelope only at exit 2; at any other non-zero code the app falls through
to generic failure copy. Compounding that, `ChecklistScreen` sets
`redactStderr = stdin != nil`, on the reasoning that only `connect` and
`owner-once` put anything on stdin and those carry secrets. A path is not a
secret, so this action breaks that assumption: at exit 1 with stdin present the
user would be told "details withheld because the command carried a secret"
instead of "that folder is not writable". Exiting 2 routes through the envelope
and sidesteps the heuristic; narrowing the heuristic to the two secret-carrying
action types is the cleaner follow-up and is noted as out of scope here.

**The TCC warning is advisory, never a refusal.** A path under `~/Documents`,
`~/Desktop` or `~/Downloads` is accepted and recorded, and the row's `ready`
detail names the hazard: those directories are TCC-protected, so tools other
than rt may hit permission prompts against repos stored there. It is the
user's machine and `~/Documents/GitHub` is a genuinely common convention;
refusing it would substitute rt's judgment for theirs, which is the defect
this whole design exists to remove.

Picker conformance: `repo-root` is a branch node with a `set` leaf under it,
not a leaf itself. The leaf's path argument is optional (a TTY prompts, a pipe
reads stdin), so no `omitBehavior` is required. Registering `repo-root` as a
leaf with a required `set` positional would fail `bun run picker:check`.
Confirm with that command rather than assuming either way.

## Error handling

- Panel cancelled: nothing happens. Not an error state.
- Path does not exist, is a file, or is unwritable: the verb returns a
  `--json` error and the row shows it; `rt.repoRoots` is unchanged.
- The chosen directory disappears later: the row's third state catches it on
  the next recheck and offers the picker again.
- `getSetting("rt.repoRoots")` throws on an authored `${repoRoot}` value: the
  row catches it and reads `needs-you` with the picker offered. Unguarded, the
  throw reaches `buildGroup`'s catch and collapses every tools row into one
  unclearable required error row.
- No app (CLI or the VM harness): the row is `needs-you`, and its detail names
  `rt setup repo-root set` so a terminal user has something to run. This is
  why the harness must set `rt.repoRoots` before
  driving Install, and the harness change is part of the work, not a
  follow-up.

## Testing

- The row's three states, including the set-but-missing directory case.
- The row is absent when the team declares no tracked repos, and present when
  it declares one.
- `settings.seed` writes no `rt.repoRoots` and creates no directory, on both
  a machine with a detected candidate and one without. This is the regression
  test for the behavior being removed, so it must fail against today's code.
- The verb: valid directory, nonexistent path, a file, an unwritable
  directory, `~` expansion, and that a `~/Documents` path is accepted with the
  advisory rather than refused.
- Dispatcher: `choose-folder` with no `fieldValues` returns `.chooseFolder`;
  with `fieldValues["root"]` returns the `.rtVerb` with the path on stdin.
- Decoding an unknown action type still yields `.unknown` and `.none`, so the
  forward-compat property is pinned rather than assumed.
- The VM harness sets `rt.repoRoots` before Install and asserts the row reads
  `ready`.

No test drives `NSOpenPanel`. The panel is three lines of configuration and a
`runModal`; the logic worth testing is the dispatcher on either side of it.

## Out of scope

- Multiple repo roots. `rt.repoRoots` is an array and the resolver already
  handles several, but the question "where do your repos go" has one answer
  at setup time. Adding roots later stays a `rt settings set`.
- Moving repos already cloned into a previously-chosen root.
- Changing `CANDIDATE_ROOT_NAMES`. The list is fine as a detection heuristic;
  the defect was treating a detection as a decision.
