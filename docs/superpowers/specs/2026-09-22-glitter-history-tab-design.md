# glitter's History tab

**Status:** approved in conversation 2026-09-22, written spec pending review
**Ticket:** the "History tab" item on the glitter v2 milestone

## Problem

The sidebar's History tab renders dimmed with a "v2" marker and answers a
click with "History lands in v2". No commit data reaches the view: the wire
model carries changes but no commit list, and the driver calls `log()` only
once, for the last-commit strip. Browsing history is one of the reasons
GitHub Desktop is still open next to glitter.

## Governing rule: port GitHub Desktop, then draw it

The build order is the one this epic has followed from the start. First the
atomic git methods that GitHub Desktop (GHD) uses for the feature, ported
with GHD's own git arguments and parsers. Then the store behavior that
sequences them. Then the UI that shows the result. Where this spec and GHD
disagree on a behavior, GHD wins unless a line below ratifies the deviation.

Source of truth is the local clone at `~/Documents/GitHub/github-desktop`,
commit `9dfe6e60` (the same commit `packages/git-core/src/vendor/ghd/` was
vendored from). Paths below are relative to its `app/src/`.

## Scope

In:

- Single-commit browsing: commit list, commit header, changed-file list,
  read-only per-file diff.
- Contiguous range selection (shift+arrow, shift+click) with one combined
  diff; a non-contiguous selection shows GHD's blank slate.
- Paging, unpushed and tag indicators, tip-change refresh.
- The tab strip: History becomes selectable, the "v2" marker and the
  "History lands in v2" notice go.

Deferred, each with its own ticket on the glitter v2 milestone and a line in
`docs/design/mission/README.md`'s "Deferred to v2" list:

- **Branch compare**, GHD's "Select Branch to Compare" box and merge
  call-to-action (`ui/history/compare.tsx`). A separate mode with its own
  merge-base methods.
- **Hide whitespace** (`-w`) for diffs. glitter has no diff options on either
  tab yet; it lands for both together.
- **Commit actions** (revert, cherry-pick, reset to commit, create branch or
  tag from commit, copy sha). These hang off the row context menu, which is
  its own ticket.

Not copied (already in the README's list): drag-and-drop cherry-pick,
squash, and reorder; image diffs; avatars.

## Part 1: atomic methods (packages/git-core)

Each is a new `GitClient` method in its own module, with GHD's arguments
verbatim. The existing `log()` (`getLog`) and its callers stay as they are;
the new `commits()` sits beside it.

| Method | GHD source | Contract |
|---|---|---|
| `commits(range?, limit?, skip?, extraArgs?)` | `lib/git/log.ts` `getCommits` | `git log --date=raw` with GHD's format (sha, shortSha, summary, body, author ident, committer ident, parents, `%(trailers:unfold,only)`, `%D`), `--max-count`, `--skip`, `--no-show-signature --no-color`, GHD's `--not` toggle rule for `extraArgs`, then `--end-of-options <range> --`. Exit 128 (unborn HEAD) returns `[]`. Tags come from `%D` split on `", "` keeping the `tag: ` entries, so tag names containing commas survive. Summary and body are capped at 100 KiB as GHD does. |
| `changedFiles(sha)` | `lib/git/log.ts` `getChangedFiles` + `parseRawLogWithNumstat` + `mapStatus` | `git log <sha> -C -M -m -1 --no-show-signature --first-parent --raw --format=format: --numstat -z --`. Parser ported verbatim: status (modified, new, deleted, renamed with `renameIncludesModifications`, copied, submodule via mode `160000`), `oldPath`, `linesAdded`, `linesDeleted`. |
| `commitDiff(file, sha)` | `lib/git/diff.ts` `getCommitDiff` + `buildDiff` + `diffFromRawDiffOutput` | `git log <sha> -m -1 --first-parent --patch-with-raw --format= -z --no-color -- <path> [<oldPath>]`. The last NUL-separated piece goes through the vendored `DiffParser`. A submodule file returns the binary kind (rt has no submodule diff). Returns the same `{ path, kind, hunks }` shape `stagingDiff` returns, so the driver's existing wire conversion and oversized gate apply unchanged. |
| `commitRangeChangedFiles(shas)` | `lib/git/diff.ts` `getCommitRangeChangedFiles` | `git diff <oldest>^ <latest> -C -M -z --raw --numstat --`, same parser. On a bad revision (the oldest commit is a root) retry once against the null tree `4b825dc642cb6eb9a060e54bf8d69288fbee4904`. |
| `commitRangeDiff(file, shas)` | `lib/git/diff.ts` `getCommitRangeDiff` | `git diff <oldest>^ <latest> --patch-with-raw --format= -z --no-color -- <path> [<oldPath>]`, same null-tree retry. |
| `localCommits(branch, skip?)` | `lib/stores/git-store.ts` `loadLocalCommits` | With an upstream: `commits("<upstream>..<branch>", 100, skip)`. Without: `commits("HEAD", 100, skip, ["--not", "--remotes"])`. The result is the unpushed set. The upstream name comes from the snapshot's tracking ref, never `@{u}`. |

Commit identities port `models/commit-identity.ts` `parseIdentity` (name,
email, raw date and offset). Co-authors port `lib/git/interpret-trailers.ts`
`parseRawUnfoldedTrailers` and the `Co-Authored-By` check. The byline ports
`models/avatar.ts` `getAvatarUsersForCommit` without the avatars: author,
then co-authors, then the committer when they are not the author, not a
co-author, and not GitHub's web-flow committer (name `GitHub`, email
`noreply@github.com`); deduped by name + email.
It renders as `ui/lib/commit-attribution.tsx` does: "A", "A, B", or
"N people".

## Part 2: store behavior (lib/mission/driver.ts)

Ported from `lib/stores/app-store.ts`:

- **Lazy first load.** Nothing touches history until the tab is first
  opened, so a Changes-only session never runs `git log`.
- **Tip-unchanged skip.** Re-opening the tab with the same tip sha does not
  reload (GHD's `tipIsUnchanged` check).
- **First batch** is `commits("HEAD", 100, 0)`, then
  `updateOrSelectFirstCommit`: keep the selected sha if it is still in the
  list, otherwise select the first commit.
- **Next batch** (`_loadNextCommitBatch`): if the last loaded commit is in
  the local set, page `localCommits` first; when that yields nothing, page
  `commits("HEAD", 100, <loaded count>)`. Triggered when the cursor comes
  within 10 rows of the end.
- **Commit selection** (`_loadChangedFilesForCurrentSelection`): one sha
  loads `changedFiles`, a contiguous range loads `commitRangeChangedFiles`
  in history order, a non-contiguous range loads nothing. The first file is
  auto-selected when none is.
- **File selection** (`_changeFileSelection`): one sha loads `commitDiff`,
  a contiguous range loads `commitRangeDiff`.
- **Stale guard.** Both loads compare the selection before and after the
  await and drop a result whose selection moved, exactly as GHD does. The
  view debounces the cursor before it emits (the Go-side `selectTick`
  debounce the Changes cursor already uses), so holding an arrow key does
  not run git per row.
- **Tip change.** A new tip (a commit made on the Changes tab, a pull, a
  checkout) reloads the first batch on the next History render and runs
  `updateOrSelectFirstCommit`.
- **Tab state is kept.** Each tab keeps its own selection and scroll across
  switches. The driver holds a Changes diff and a History diff; `model.diff`
  carries the active tab's.

## Part 3: the UI

The design board comes first: a `History.png` board in
`docs/design/mission/mission.pen`, drawn by the controller and signed off by
Matt before any Go work starts (the README makes the boards the contract).

Mockup of the intent (not the board):

```
 Changes   History    │ Fix pty paint predicate                         ⌄
 ────────▔▔▔▔▔▔▔▔▔▔▔▔ │ The first byte is not a painted screen; wait for a
▌Fix pty paint pred… ↑│ drawn cell…
 Matt · 3h ago        │ Matt, Claude · 407752bc · +12 −4 · v0.9.1
 Guard badges  v0.9.1 │─────────────────────────┬───────────────────────────
 Matt · 5h ago        │ 3 changed files         │ M lib/mission/model.ts
 Hover states         │▌M lib/…/model.ts        │ @@ -170,6 +170,9 @@
 Matt, Claude · 1d ago│ M lib/…/driver.ts       │ 172   const byPath = …
```

**Sidebar (History active).** The tab row with the underline under History,
then the commit list to the bottom of the body. No filter row, commit box,
or last-commit strip: GHD's History sidebar has none of them. Rows are two
lines (`ui/history/commit-list-item.tsx`): the summary, or "Empty commit
message" dimmed; then byline · relative time. The right edge carries the
first tag as a pill, with a "more" marker when there are others, and the
unpushed ↑. Every row in a range selection takes the selection background.

**Header** (`ui/history/expandable-commit-summary.tsx`). Collapsed: the
summary ("Empty commit message" dimmed when blank) and a ⌄ expander; the description clipped to 2 lines; a meta line of
authors · short sha · +N −M · tags. Expanded: the full description, one
author per line, the full sha, "N added lines" and "N removed lines". The
+N −M item hides when both are zero. A range reads "Showing changes from N
commits" with no meta line. Expansion is view-local state.

**File column** (`ui/history/selected-commits.tsx`, `committed-file-item.tsx`).
"N changed file(s)", then status glyph + path. Paths clip in the middle so
the filename survives. Width is a third of the right pane, clamped to
[24, 40] columns, where GHD has a resizable panel.

**Diff.** The existing renderer with `readOnly`: no checkbox gutter, and a
hunk header row does not toggle anything. The per-file header row, binary
slate, and oversized slate are the Changes pane's.

**Blank slates.** No commits (unborn HEAD): "No history". A non-contiguous
selection: GHD's "Unable to display diff when multiple non-consecutive
commits are selected." A commit with no files: an empty file column and no
diff message, as GHD suppresses the double empty state.

**Keys.**

- `1` and `2` switch to Changes and History. Ratified deviation: GHD binds
  ⌘1 and ⌘2, which a terminal cannot receive.
- ↑/↓ move within the focused region; shift+↑/↓ extend a contiguous range.
- Enter steps focus commit list → file column → diff; Esc steps back.
- `e` toggles the header's expanded state. Ratified deviation: GHD's
  expander is a tabbable button.
- The keybar is per tab: History gets its own strip, as Changes has one.
- Shift+click reaches the view only in terminals that forward
  shift-modified clicks (not Ghostty or Terminal.app by default);
  shift+↑/↓ is the dependable range gesture.

**Mouse.** Hover on every commit row, file row, tab, and the expander. Click
selects; shift+click extends the range. The wheel scrolls the region under
the pointer. Every new scrolling region uses `picker/scroll.go`'s
`Viewport` and thumb, and all clipping goes through `clip`/`clipOn`
(CLAUDE.md's lift-don't-duplicate rule). A middle-clip helper, if needed,
is added beside them rather than inline.

## Wire (lib/ui/protocol.ts, mirrored in Go)

- `MissionModel.tab: "changes" | "history"`.
- `MissionModel.history`: `commits` (rows of sha, shortSha, summary,
  byline, when, tags, unpushed, selected), `hasMore`, `loading`, `header`
  (summary, body, byline, authors as "Name <email>", sha, shortSha,
  linesAdded, linesDeleted, tags, rangeCount, contiguous) or null, `files`
  (path, origPath, status), and `selectedFile`.
- `MissionDiffModel.readOnly: boolean`.
- Intents: `mission:tab` (tab), `mission:history-select` (shas, newest
  first: the view owns the cursor and range anchor, so it sends the whole
  selection), `mission:history-file` (path, showOversized),
  `mission:history-more`.

Hover, cursor position within a region, focus, and header expansion stay in
the Go model, like every other view-only state.

## Errors

A failed git read posts a notice and keeps the last good list, which is rt's
form of GHD's `performFailableOperation`. Too-large and binary diffs reuse
the Changes pane's slates. Submodule changes show the binary message, as the
README already records for Changes.

## Testing

- **git-core:** port GHD's `test/unit/git/log-test.ts`,
  `log-revision-exclusions-test.ts`, and the commit and range cases from
  `diff-test.ts` onto real temp repos: renames and copies, a merge commit
  diffed against its first parent, the root commit's null-tree retry, a tag
  whose name contains a comma, co-author trailers, a submodule bump, and an
  unborn HEAD.
- **Driver:** fake-dep tests for the lazy load, the tip-unchanged skip,
  local-first paging, the stale-selection drop on both loads, range
  selection, and each tab keeping its own state.
- **Go:** render and hit tests, plus session-driven tests that push real key
  and mouse messages through `Update` and assert the emitted intents. A
  renderer test proves the pixels, not the plumbing; the hover bug shipped
  behind passing renderer tests.
- **pty gate** (`e2e/pty/glitter.test.ts`): press `2`, assert a known
  commit's subject and one line of its diff.
- **By eye:** Matt test-drives the built binary against the board and GHD
  before merge.

## Docs

`docs/design/mission/README.md`: History comes off the deferred list and
the "History tab is deferred" deviation; the `1`/`2` deviation is added;
branch compare and hide whitespace are added to the deferred list; the
boards list gains `History.png`.
