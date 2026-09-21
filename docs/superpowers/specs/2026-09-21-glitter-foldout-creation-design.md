# Creating branches and worktrees from glitter's foldouts

**Status:** approved 2026-09-21
**Ticket:** the "create branches and provision worktrees from the foldouts" item on the glitter v2 milestone

## Problem

The branch foldout's "New branch from &lt;current&gt;…" row and the worktree
foldout's "Provision new worktree…" row both exist, are reachable by click and
by ctrl-n, and both answer with the notice "use rt worktree provision". The
rows look live and do nothing.

Neither can be wired without first answering a question v1 left open: the
modal engine has no way to accept a name. Its `query` string filters the list
and is never emitted, so there is no precedent for collecting text inside a
foldout.

## Decisions

Three choices were ratified before this was written. Each closes an option the
build would otherwise have to guess at.

**1. Name entry is inline, replacing the filter line.** While naming, the
modal's existing filter line becomes the name field. The modal stays open and
the box keeps its exact geometry.

The alternative, a new input row below the list, costs a line in
`modalBoxLines` that must be mirrored by hand in `modalHitTest`
(`ui/internal/views/mission/mission.go:871-925`), which is a parallel
hand-rolled copy of the box layout. Any desync there misplaces every click in
the modal. Reusing the filter line needs no layout change at all, so that
whole class of bug does not arise.

**2. A worktree needs a branch name, and the field cannot be empty.** Enter is
inert until something is typed.

This is not a UX preference, it is what the underlying verb does.
`worktree:provision` resolves its branch from `payload.branch`, or by
slugifying `payload.ticket`, and returns `branch-unresolved` given neither
(`lib/daemon/handlers/worktree.ts:307-323`). rt picks the worktree's *folder*
name from a pool (`pickName` in `lib/worktree/create.ts:54`, the source of
`theoden` and `eored`), never the branch name. A blank field would have
nothing to fall back on.

**3. Provisioning switches the board immediately and shows readiness.**
`worktree:provision` replies as soon as the branch is real, then runs installs
and hooks in the background; `wait: true` blocks until they settle, and those
settles "can legitimately run for minutes".

Blocking a TUI for minutes reads as a hang. Switching silently would point the
board at a tree whose dependencies are still installing with no sign of it. So
the board switches at once and carries a settling state that clears when the
daemon says the tree is ready.

## Units

### Unit 1: a naming sub-mode in the modal engine

`modalState` (`ui/internal/views/mission/modal.go:52-75`) gains a naming mode
and a `textinput.Model`. The text input is the same component the commit box
uses, so the field gets a real cursor, and `newCommitInput`
(`mission.go:120-134`) is parameterized on width rather than copied, since it
currently hardcodes `commitBoxInner`.

`modalActionRow` (`modal.go:45-48`) currently freezes its payload at
construction as a `json.RawMessage`. It gains the `buildPayload(value string)`
treatment ordinary rows already have (`modal.go:56`), so the typed name can
reach the payload.

Entering: ctrl-n, and enter on the action slot, both currently run
`selectModalAction` (`modal.go:405-413`), which emits and closes
unconditionally. They now enter naming mode instead. Only the second enter
emits.

While naming:

- `enter` emits the intent with the typed name and closes the modal. A blank
  or whitespace-only field does nothing, matching the commit button's own
  `commitEnabled()` gate.
- `esc` leaves naming mode and returns to filtering. The modal stays open. A
  second `esc` closes it as it does today.
- every other key goes to the text input.
- arrows and the row list are inert. The cursor indicator is hidden so it is
  clear enter no longer means "pick this row".

Rendering changes are confined to two lines that already exist:
`modalFilterLine` (`modal.go:502-515`) paints the input instead of the query,
and the per-zone keybar (`modal.go:673-684`) reads `enter create · esc cancel`.
`modalFixedRows`, `modalBoxLines`, and `modalHitTest` are untouched, which is
the point of decision 1.

The repo foldout has no action row and is unaffected.

### Unit 2: creating a branch

Wire: `mission:checkout` gains `name`, so the action row emits
`{new: true, from: "<current>", name: "<typed>"}`.

The driver's `handleCheckout` (`lib/mission/driver.ts:733-755`) branches on
`payload.new === true` rather than on the absence of `payload.branch`, and
calls the client method that already exists:

```ts
await client.createBranch(payload.name, { from: payload.from, checkout: true });
```

`createBranch` (`packages/git-core/src/branch-ops.ts:9-25`) validates the name,
and with `checkout: true` runs one atomic `git checkout -b`, so a failure
cannot strand a created-but-unchecked-out branch. No new dependency is needed;
the driver already holds this client.

After creation the handler takes the same path the existing checkout does:
clear the notice, drop the selected path and the selection map, refresh, push.

Failures (an invalid name, a dirty tree that blocks the checkout) surface as a
notice. The typed name is lost on failure, which matches how the branch list
behaves today and is a smaller problem than the commit box's, since a branch
name is short. Preserving it is out of scope.

### Unit 3: provisioning a worktree, and readiness

Wire: `mission:worktree` gains `name`, so the action row emits
`{new: true, name: "<typed>"}`.

The driver's `handleWorktree` (`lib/mission/driver.ts:757-771`) branches on
`payload.new === true` and calls the daemon verb through the dep it already
holds:

```ts
const res = await this.deps.daemonQuery("worktree:provision", {
  repoName: this.state.currentRepo,
  branch: payload.name,
  owner: "glitter",
}, PROVISION_TIMEOUT_MS);
```

`owner: "glitter"` follows the precedent of the Claude hook's `owner: "claude"`
(`commands/worktree-hook.ts:253`) and the herd handler's `owner: herd:<id>`
(`lib/daemon/handlers/herd.ts:379`), so a tree's origin stays legible in the
registry.

On success the board switches to `res.data.path` exactly as selecting an
existing worktree does, then refreshes. The typed refusals
(`repo-unknown`, `busy`, `branch-unresolved`, `handoff-write-failed`) each
become a notice; `busy` is the one a user will actually hit, so it gets wording
that says to try again rather than repeating the raw code.

**Readiness.** `Current` (`ui/internal/views/mission/model.go:95-103`) gains
`settling bool`. The driver sets it when the provision reply carries
`readyPending`, and the worktree segment in the top bar renders a settling
suffix while it is true.

The driver's daemon subscription (`driver.ts:214-219`) currently drops every
event that is not `git-status`. It gains a second branch for
`worktree:ready-settled`, which `lib/worktree/ready-async.ts:89,100` emits as
`{repo, tree, path, ok}`. A settled event for the current tree clears the flag
and refreshes; `ok: false` also leaves a notice saying dependencies may be
stale, mirroring what the provision CLI prints today.

`readyHeld` (team ready steps awaiting approval) is reported as a notice naming
`rt worktree ready-approve`, again matching the CLI. Wiring approval into the
board is out of scope.

## Wire contract

Three additions, all backward compatible in the decoder's direction (Go's
`decode` tolerates unknown fields by design):

| Field | Direction | Shape |
|---|---|---|
| `name` on `mission:checkout` | Go to TS | `{new, from, name}` |
| `name` on `mission:worktree` | Go to TS | `{new, name}` |
| `settling` on `current` | TS to Go | `bool` |

`ui/fixtures/session-model-mission.json` is the golden handshake and gains
`current.settling`. It must stay reproducible by `buildModel` by construction,
not by hand-editing the JSON to match.

## Testing

Go, in `ui/internal/views/mission/`:

- ctrl-n on each foldout enters naming mode rather than emitting. This
  replaces the four existing tests at `mission_test.go:479-537`, which assert
  the current emit-immediately behavior and are now wrong by design.
- enter with a name emits the intent carrying that name; enter with a blank or
  whitespace field emits nothing.
- esc from naming returns to filtering with the modal still open.
- a render test pinning that the box height and every hit zone are unchanged
  between filtering and naming. This is the assertion that decision 1 actually
  held.

TypeScript, in `lib/mission/__tests__/driver.test.ts`:

- `mission:checkout` with `{new, name}` calls `createBranch` with
  `{from, checkout: true}` and the board follows.
- `mission:worktree` with `{new, name}` calls `worktree:provision` with the
  right payload and switches the board to the returned path.
- a `readyPending` reply sets `settling`; a `worktree:ready-settled` event for
  that tree clears it; one for a different tree does not.
- each typed refusal becomes its notice.
- the two tests at `driver.test.ts:1000-1029` asserting the
  "use rt worktree provision" notice are deleted, since that notice is the
  thing being removed.

The pty gate (`e2e/pty/glitter.test.ts`) is not extended here. It drives keys
and asserts git state, and provisioning inside it would need a daemon, which
the sandbox deliberately does not have.

## Out of scope

- Approving held ready steps from the board.
- Preserving a typed name across a failure.
- Provisioning a tree for a branch that already exists. It is a real use, and
  the natural home for it is a row action in the branch foldout rather than
  this row.
- Ticket-derived branch names. The verb supports `ticket`, but glitter has no
  ticket context to derive one from.

## Design boards

`docs/design/mission/README.md` gains the naming affordance under its parity
checklist, and the two rows come off its "Deferred to v2" section. The milestone
rule is that every line there has a ticket and every ticket has a line, so both
move together.
