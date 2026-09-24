# glitter: stash, ported from GitHub Desktop (design)

Status: approved by the owner 2026-09-23 (conversational design; this written
spec awaits review).

## Goal

`rt glitter` stashes the way GitHub Desktop does: at most one stash per
branch, created by Stash All Changes or by leaving changes behind on a branch
switch, viewed as a read-only file list and diff, and restored or discarded
from that view. Switching branches with uncommitted changes asks Desktop's
question, leave them on this branch or bring them along.

Governing rule for glitter features: port GitHub Desktop's atomic git methods
first (verbatim arguments), then its store behavior, then the UI.

## GitHub Desktop sources (clone at ~/Documents/GitHub/github-desktop, 9dfe6e60)

- Git layer: `app/src/lib/git/stash.ts` (whole file: marker, `getStashes`,
  `getLastDesktopStashEntryForBranch`, `createDesktopStashMessage`,
  `createDesktopStashEntry`, `dropDesktopStashEntry`, `popStashEntry`,
  `getStashedFiles`). `moveStashEntry` is not ported (glitter cannot rename
  branches).
- Untracked staging: `app/src/lib/git/update-index.ts`, `stageFiles`.
- Store: `app/src/lib/stores/app-store.ts`: `_checkoutBranch` (4582),
  `checkoutImplementation`, `checkoutAndLeaveChanges` (4682),
  `checkoutAndBringChanges` (4709), `_createStashForCurrentBranch` (4838),
  `createStashAndDropPreviousEntry` (8916), `createStashEntry`,
  `_popStashEntry` (8947), `_dropStashEntry` (8958),
  `isLocalChangesOverwrittenError` (10810).
- Stash state: `app/src/lib/stores/git-store.ts`, `loadStashEntries` (1195),
  `currentBranchStashEntry`, `loadFilesForCurrentStashEntry` (1250).
- Strategy enum: `app/src/models/uncommitted-changes-strategy.ts`.
- UI copy: `app/src/ui/stashing/stash-diff-header.tsx`,
  `confirm-discard-stash.tsx`, `stash-diff-viewer.tsx`;
  `app/src/ui/stash-changes/stash-and-switch-branch-dialog.tsx`,
  `overwrite-stashed-changes-dialog.tsx`;
  `app/src/ui/changes/filter-changes-list.tsx` (`onContextMenu` 535,
  `renderStashedChanges` 1105); `app/src/ui/changes/no-changes.tsx`
  (`renderViewStashAction` 398);
  `app/src/ui/discard-changes/discard-changes-dialog.tsx` (discard-all copy);
  `app/src/main-process/menu/build-default-menu.ts` (Stash All Changes
  ⌘⇧S, Show/Hide Stashed Changes Ctrl+H).
- `LocalChangesOverwritten`: dugite's `lib/errors.ts` regex for that error
  (dugite is not in the local clone; copy the pattern verbatim from the
  published dugite package).

## 1. git-core: `packages/git-core/src/desktop-stash.ts`

A verbatim port of Desktop's `stash.ts`, same git arguments, exposed on
`GitClient`. The index-based `stashes/stashPush/stashApply/stashPop/stashDrop`
stay as they are for `rt git stash`.

- `DesktopStashEntryMarker = "!!GitHub_Desktop"` and
  `createDesktopStashMessage(branch)` returning `!!GitHub_Desktop<branch>`.
  Byte-identical to Desktop, so a stash made in glitter shows in GitHub
  Desktop and the reverse.
- `DesktopStashEntry { name, stashSha, branchName, tree, parents }`, where
  `name` is the `%gD` selector (`stash@{n}`) as read at list time.
- `getDesktopStashes(): { desktopEntries, stashEntryCount }`: `git log -g`
  with Desktop's format fields (`%gD`, `%H`, `%gs`, `%T`, `%P`) over
  `refs/stash --`; exit 128 yields no entries and a count of 0. Entries whose
  message does not end in `!!GitHub_Desktop<branch>` are counted but not
  returned. Port Desktop's `stashEntryCount` arithmetic verbatim and pin it
  with a real-git test.
- `getLastDesktopStashEntryForBranch(branch)`: the first matching entry in
  reflog (LIFO) order, or null.
- `createDesktopStashEntry(branch, untrackedPaths): boolean`: stage the
  untracked paths fully first (Desktop's `stageFiles` with every selection
  set to All: `git update-index --add --remove --replace` semantics, the
  same path `stageFileFully` already takes), then
  `stash push -m !!GitHub_Desktop<branch>`. Exit 1 with no line starting
  `error: ` in stderr counts as created; any other failure throws. Stdout
  exactly `No local changes to save\n` returns false.
- `dropDesktopStashEntry(sha)`: re-list, find the entry by sha, then
  `stash drop <name>`; a missing entry is a silent no-op.
- `popStashEntry(sha)`: re-list, find by sha, `stash pop --quiet <name>`.
  Exit 1 with empty stderr (the pop applied with conflicts and git kept the
  entry) drops the entry by sha. Any other failure throws. A missing entry
  is a silent no-op.
- `getStashedFiles(sha)`: `stash show <sha> --raw --numstat -z
  --format=format: --no-show-signature --`, parsed into the same
  `CommittedFileChange` shape History's `changedFiles` returns, with
  `<sha>^` as the parent, so the existing `commitDiff(file, sha)` serves the
  stash diff.
- `isLocalChangesOverwrittenError(err)`: true when a git error's stderr
  matches dugite's `LocalChangesOverwritten` pattern.

Entries are always addressed by sha and re-resolved to `stash@{n}` at the
moment of the git call, never cached by index: the stash stack is shared by
every worktree of the repo and other sessions push and pop it.

## 2. The store: `lib/mission/stash.ts`

Desktop's app-store sequencing, in its own module the driver calls, so
`driver.ts` does not grow further.

- `createStashAndDropPreviousEntry(branch)`: read the branch's current
  entry, create the new stash (untracked files from a fresh snapshot), and
  only when creation returned true drop the previous entry by sha. Returns
  whether a stash was created.
- `checkout(branch, strategy)` with Desktop's three strategies:
  - `leave` (StashOnCurrentBranch): when the tip is a branch and the tree
    has changes, `createStashAndDropPreviousEntry(current)`, then a plain
    checkout. A failed stash is reported as a notice and the checkout still
    runs (Desktop's `performFailableOperation` sequencing, ported as is).
  - `bring` (MoveToNewBranch): a plain checkout. Only on a
    `LocalChangesOverwritten` failure: create a stash tagged with the
    TARGET branch, re-read its entry, check out, and pop that entry by sha.
    If no stash was created, rethrow the original checkout error.
  - none: a plain checkout, used when the tree is clean.
- When to ask, decided by the driver on a fresh snapshot (Desktop's
  `_checkoutBranch`): same branch is a no-op; the worktree guard still
  refuses branches another worktree owns; a detached or unborn HEAD forces
  `bring`; a dirty tree with no strategy in the intent does not check out
  and sets `switchPrompt` instead; a clean tree checks out directly.
- `createStashForCurrentBranch()`: `createStashAndDropPreviousEntry` on the
  current branch; refused (no-op) on a detached or unborn HEAD.
- `restore(sha)` pops; `discard(sha)` drops. Both then refresh.
- Stash state on each refresh (Desktop's `loadStashEntries` plus
  `loadFilesForCurrentStashEntry`): keep only the newest entry per branch,
  expose the current branch's entry, and load its file list. A file list is
  cached by sha and reused while the sha is unchanged.

## 3. Wire

- `stashCount` is removed. `stash: { sha, branch, files } | null` carries
  the current branch's Desktop entry; `files` is `HistoryFileRow[]`, or null
  while loading.
- `stashDiff`: the selected stash file's diff, the same shape as
  `historyDiff`.
- `switchPrompt: { seq, branch, current, hasStash } | null`: one-shot. The
  view opens the question when `seq` is new and never reopens a seq it has
  seen, so a later refresh cannot bring a dismissed prompt back.
- Intents:
  - `mission:stash {}`: Stash All Changes (any overwrite confirm has
    already happened in the view).
  - `mission:stash-restore {sha}`, `mission:stash-discard {sha}`.
  - `mission:stash-select {path}`: load `stashDiff` for a stashed file.
  - `mission:checkout` gains `strategy?: "leave" | "bring"`.
  - `mission:menu-action {action: "discard-all"}`: Discard All Changes,
    through the shipped `discardChanges` port over every changed file (the
    driver re-reads the snapshot first, as the single-file discard does).
- Stash actions run under the same busy handling as commit and undo.

## 4. The view

### Strip

"Stashed Changes" with the stash icon and a chevron, Desktop's label and no
count. It shows only when `stash` is non-null (Desktop's
`renderStashedChanges`), and paints selected while the stash view is open.
Click or `h` toggles the view.

### Stash view

On the Changes tab, the right pane takes History's layout:

- A header in place of the commit header: title "Stashed changes", buttons
  **Restore** and **Discard**, and Desktop's line "Restore will move your
  stashed files to the Changes list."
- History's "N changed files" column and its read-only diff (no stage
  gutter), fed by `stash.files` and `stashDiff`.
- The Changes list stays on the left with no row selected. Opening the view
  selects the first stashed file.
- Keys: `↑`/`↓` move through stashed files, `R` restores, `D` discards,
  `h` or `esc` leaves; choosing a Changes file also leaves (Desktop hides
  the stash on a working-directory selection).
- When the entry disappears (restored, discarded, or dropped elsewhere),
  the view closes.

### Dialogs (picker.Menu question steps, Desktop copy)

- **Switch Branch**, opened by `switchPrompt` in place of the branch
  foldout: title "Switch Branch"; a quiet line "You have changes on this
  branch. What would you like to do with them?"; rows "Leave my changes on
  <current>" and "Bring my changes to <branch>". The cursor row's Desktop
  description shows as a quiet footer ("Your in-progress work will be
  stashed on this branch for you to return to later" / "Your in-progress
  work will follow you to the new branch"). When `hasStash` and the cursor
  is on Leave, a greyed row reads "⚠ Your current stash will be overwritten
  by creating a new stash". Choosing Bring, or Leave without a stash, sends
  `mission:checkout {branch, strategy}`. Choosing Leave with a stash goes to
  Overwrite Stash?.
- **Overwrite Stash?**: quiet line "Are you sure you want to proceed? This
  will overwrite your existing stash with your current changes."; rows
  "Overwrite" and "Cancel". Reached from Switch Branch (then checkout with
  `leave`) and from "Stash All Changes…" (then `mission:stash`).
- **Discard Stash?**: quiet line "Are you sure you want to discard these
  stashed changes?"; rows "Discard" and "Cancel". Always asked.
- **Discard All Changes**: title "Discard all <N> changed files?"; rows
  "Discard All Changes" and "Cancel".

### Changes list menu

Right-click on the "N changed files" header row opens Desktop's list-level
menu (`filter-changes-list.tsx` `onContextMenu`), plus the board-wide
section every glitter menu carries:

- "Discard All Changes…": enabled when there are changes.
- "Stash All Changes", or "Stash All Changes…" when the branch has a stash:
  enabled when there are changes, the tip is a branch, and nothing is
  conflicted. The "…" form goes through Overwrite Stash? first.

The board-wide section (ctrl-k) gains `S` Stash All Changes and `h`
Show/Hide Stashed Changes, with the same enablement.

### Keys

- `S`: Stash All Changes (Desktop's ⌘⇧S without ⌘).
- `h`: Show/Hide Stashed Changes (Desktop's Ctrl+H; most terminals send
  Ctrl+H as Backspace).
- Stash view: `↑`/`↓`, `R`, `D`, `h`, `esc`, shown on its keybar.

### Empty state

With no changes and a stash, the "No local changes" card gains Desktop's
"View your stashed changes" line with its `h` hint.

## 5. Boards and README (first task)

- New `docs/design/mission/Stash.png`: the strip at rest and selected, and
  the stash view (header, file column, read-only diff).
- New `docs/design/mission/StashStates.png`: Switch Branch (Leave with the
  overwrite warning, Bring), Overwrite Stash?, Discard Stash?, Discard All
  Changes, the Changes list menu (enabled and greyed), and the empty-state
  line.
- `mission.pen` carries both boards. Implementation waits on the owner's
  approval of the boards.
- README: add both boards; drop "Stash foldout" from Deferred; rewrite the
  guarded-checkout deviation to cover only branches another worktree owns
  (Desktop switches to that worktree; glitter refuses); add deviations for
  `S`/`h` as key stand-ins and the always-asked Discard Stash?.

## 6. Errors

- Restore that git refuses (for example local changes that the pop would
  overwrite): the entry stays and git's message shows as a notice; `R`
  retries (Desktop's retry action).
- Restore with conflicts: the entry is dropped and the conflicted files show
  in the Changes list, as in Desktop.
- A failed stash under `leave`: notice, and the checkout still runs.
- `bring` unable to make its temporary stash: the original checkout error
  shows and nothing moves.
- A stash gone before Restore or Discard: the sha lookup finds nothing, the
  action is a no-op, and the refresh hides the strip.

## 7. Testing

- git-core, against real sandbox repos: marker round trip; newest entry per
  branch in LIFO order; non-Desktop stashes counted but not returned;
  untracked files land in the stash; "No local changes to save" returns
  false; a conflicting pop drops the entry; drop and pop by sha after
  another stash shifted the stack; `getStashedFiles` lists a formerly
  untracked file; `isLocalChangesOverwrittenError` against real git stderr.
- `lib/mission/stash.ts`: sequencing against a fake client (create then
  drop only on success; leave on a failed stash still checks out; bring
  retries only on the overwrite error), plus a compose test with the real
  driver and real git asserting git's state: Stash All Changes; leave, then
  return and see the strip; bring across an overlapping file; Restore;
  Discard; a second Stash All Changes leaves one entry.
- Go: strip visibility and selected paint; stash view layout and keys;
  every dialog's copy, rows, greyed state, and the one-shot `seq`; the list
  menu's enablement; the `S`/`h` board rows.
- pty: `S`, the strip appears, `h`, `R`, the files are back, through the
  binary.
- A live frame check of every state against the boards before hand-off.
