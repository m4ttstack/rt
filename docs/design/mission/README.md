# Mission-control design boards: the parity reference

These boards (PNG exports plus `mission.pen`, the editable pencil source) are
the signed-off visual contract for the rt mission-control session view
(2026-09-18). They are the standard the built TUI is scrutinized against:
reviews compare real terminal captures against these boards, surface by
surface, and deviations are either fixed in the TUI or ratified by updating
the board in the same change.

The design mirrors GitHub Desktop, verified against its source at the local
clone (app/src/ui: toolbar push-pull-button state machine, changes sidebar,
commit area, diff view, repository and branch foldouts), rendered in rt-ui's
own dialect: every color is a theme.go token role (never inline), picker row
and modal conventions carry over unchanged (HoverBg hover distinct from
SelBg cursor rows, Surface + Panel modal lift over a dimmed parent, no
shadows, no radii).

## Boards

- `Main.png`: the full view. Top bar (repo / worktree / branch segments plus
  the adaptive action segment), changes pane, diff pane, commit box, keybar.
  The repository segment and the changes sidebar share one locked width; the
  divider runs unbroken through bar and body, and is not draggable.
- `ActionStates.png`: the adaptive action segment's complete state machine,
  matching GitHub Desktop's exactly: Fetch, Pull (a diverged repo shows both
  counts on the one Pull button; there is no combined pull-then-push state),
  Push, Publish branch, Publish repository, Force push (recommended after
  amend or rebase), in-progress. Wording rules: "Last fetched Xm ago" or
  "Never fetched"; "Pull origin with rebase" when pull.rebase is set.
- `RepoPicker.png`: the repository foldout as an rt picker: grouped by host
  and owner, fuzzy filter, badges per worktree (dirty count, ahead, behind,
  clean check).
- `InteractionStates.png`: rest / hover / cursor / action-row treatments for
  rows, segments, buttons, and the diff gutter's rest / hover-preview /
  staged ladder.
- `BranchModal.png`: the branch foldout in context over the dimmed parent,
  with current-branch marker, ahead/behind pills, guarded rows (branches
  checked out in another worktree refuse checkout), section grouping, and a
  new-branch action row.
- `WorktreeModal.png`: the worktree foldout (no GitHub Desktop analog): the
  current worktree, per-tree badges, on-deck pool rows, provision action.
- `History.png`: the History tab (GitHub Desktop's app/src/ui/history):
  the two-line commit list with cursor, hover, tag pills, and unpushed ↑;
  the collapsed commit header; the changed-file column; the read-only diff
  with no stage gutter; the History keybar.
- `HistoryStates.png`: the expanded commit header, a contiguous range
  selection and its "Showing changes from N commits" header, and the four
  blank slates (unborn repo, first load, nothing selected, non-contiguous).
- `Mouse.png`: every mouse affordance by zone; hover always previews.
- `DiffStates.png`: expand up / down / all handles, binary and oversized
  messages, and the diff rows themselves: add/del tints with a stronger
  gutter strip, the mark in its own column, a soft-wrapped line, hover
  and selection, and markdown heading/strong/emph weights.
- `EmptyState.png`: the clean-worktree state (no GitHub Desktop card
  clone): zeroed sidebar, disabled commit button, and a centered
  "No local changes" card in the diff pane with key hints.
- `ContextMenu.png`: a Changes file menu anchored at a right-click near the
  right edge (slid left to fit), and a commit menu, each followed by the
  board-wide section below a rule.
- `ContextMenuStates.png`: ctrl-k centered with only the board-wide section
  (titled "Actions"), disabled rows, the Discard question step, the Create
  Tag name step, the History "File Does Not Exist on Disk" menu, and hover
  versus cursor rows.
- `Stash.png`: the Changes tab with the stash view open over the file and
  diff panes -- header "Stashed changes" with Restore and Discard buttons
  and "Restore will move your stashed files to the Changes list.", a file
  column, a read-only diff, the "Stashed Changes" strip docked above the
  commit box, and the stash keybar.
- `StashStates.png`: Switch Branch with and without an existing stash on the
  current branch (Leave gains the overwrite-warning row only in the second
  case), the strip's rest / hover / selected treatments and its icon note,
  Overwrite Stash?, Discard Stash? (always asks), Discard All Changes…, the
  Changes list menu right-clicked with no stash yet versus with a stash and
  no changes (Discard All/Stash All greyed, Show Stashed Changes still
  live), ctrl-k inside the stash view, and the clean-tree empty state's
  added `h` hint line.

## Ratified deviations from GitHub Desktop

- `@@` hunk headers stay visible (terminal-native); the header row itself is
  the hunk stage toggle. GitHub Desktop hides hunk text behind expand
  handles and a hunk-handle gutter.
- A branch checked out in another worktree is refused; GitHub Desktop
  switches to that worktree instead.
- Repository rows carry numeric badges where GitHub Desktop shows a dot plus
  bare arrows.
- A worktree segment and foldout exist; GitHub Desktop has no worktree
  surface.
- `1` and `2` switch between Changes and History. GitHub Desktop binds
  ⌘1 and ⌘2, which a terminal cannot receive.
- `e` toggles the History commit header's expanded state. GitHub
  Desktop's expander is a button reached by tabbing; a terminal needs a
  key.
- Shift+click extends a History range only where the terminal forwards
  shift-modified clicks: Ghostty and Terminal.app keep shift+click for
  their own text selection while mouse reporting is on. Shift+↑/↓ always
  works.
- The History list's mouse wheel scrolls the view without moving the
  selection, and paging is an explicit "Load 100 more commits" row rather
  than GitHub Desktop's load-as-you-scroll.
- History groups commits under date headers (Today, Yesterday, Earlier
  this week, Last week, then by month) and has a `/` filter over loaded
  commits; GitHub Desktop has neither.
- The context menu filters by typing and carries a live key hint per row;
  GitHub Desktop's menus do neither.
- ctrl-k opens the menu for whatever has focus and always carries the
  board-wide section that lists every key, even when a file or commit menu
  is also showing; GitHub Desktop has no keyboard-opened menu.
- Ignore Folder is a follow-up list in the same box (deepest ancestor
  first), not GitHub Desktop's submenu.
- A failed move to the Trash reports the error and stops; glitter never
  offers GitHub Desktop's fallback permanent delete.
- View on GitHub is not offered yet.
- `S` and `h` stand in for GitHub Desktop's ⌘⇧S and Ctrl+H, which a terminal
  cannot receive.
- Discard Stash? always asks; GitHub Desktop offers a "Do not show this
  message again" setting on it.
- Switch Branch shows the Leave and Bring descriptions, and the
  overwrite-stash warning under Leave when the branch has a stash, as rows
  indented two spaces under their option rather than GitHub Desktop's
  radio-button layout: `picker.Menu` has no per-row color or footer, so the
  descriptions and the warning glyph together paint Faint like any other
  disabled row -- the menu engine cannot color just the glyph.
- There is no "always leave" or "always bring" setting. Every switch with
  changes asks.
- Publish Repository is two menu steps, the name (the repo's own, filled
  in) and then "Keep this code private" or "Public", instead of GitHub
  Desktop's single dialog. There is no description field and no
  organization dropdown: `owner/name` in the name field publishes to an
  organization. It runs `gh repo create --source --remote origin --push`
  (no `--push` for a repo with no commits yet), so it needs the GitHub CLI
  signed in.

## Deferred to v2

The features v1 ships a placeholder for, or does not ship at all. This
list is the in-repo half of a pair: each line names its ticket on the
"glitter v2" milestone of the mission-control project. Adding a "lands
in v2" notice to the code means adding a line here and a ticket there;
removing one means removing all three.

- **Branch compare** (RT-238). GitHub Desktop's "Select Branch to
  Compare" box atop History, with ahead/behind against another branch and
  the merge call-to-action. Not built.
- **Hide whitespace** (RT-239). GitHub Desktop's `-w` diff option.
  glitter has no diff options on either tab yet.
- **Commit actions follow-up** (RT-240). Reset to commit, checkout,
  reorder, revert, cherry-pick, copy tag, delete tag, and the multi-commit
  menu. Not built; Undo Commit, Create Branch from Commit, Create Tag, and
  Copy SHA ship on the commit row's context menu.
- **Not copied from GitHub Desktop at all** (RT-230): the Pull Requests
  tab and its merge-into footer, image diffs (submodule diffs collapse
  into the binary message today), drag-and-drop cherry-pick, and clone or
  create-repository flows.

## Staging model: rt adopts GitHub Desktop's own (ratified 2026-09-21)

The diff pane always shows a file's FULL change against HEAD (`git diff
HEAD -- <path>`), independent of what's actually in the index --
untracked files diff against `/dev/null` (whole file as additions),
renamed files diff against the index (GHD's own acknowledged
compromise: "technically incorrect, the best kind of incorrect"), and
every other status diffs against HEAD, so staged and unstaged content
show together in one view. A checkbox (per line, per hunk, or the
whole file) means "include this in the next commit," not "already in
the index" -- toggling one only ever mutates the driver's own
selection; it never runs a git command. Every file's selection seeds
to All the moment it first appears.

**The real git index is a scratch pad the commit step owns outright.**
At commit time the driver resets the WHOLE index to HEAD, then
rebuilds it file by file from each one's own selection (GHD's exact
sequencing, `app/src/lib/git/commit.ts`'s `createCommit`), then runs
the actual `git commit`. This means **anything staged outside
glitter -- a plain `git add`, another agent editing the same repo
concurrently, a leftover `git add -p` from a terminal session -- is
rebuilt away at the next commit and replaced with exactly what the
mission view's own checkboxes say.** This is GitHub Desktop's own
accepted behavior, not an oversight, and worth stating plainly given
this estate routinely has multiple agents working the same checkout.

A selection persists across the whole session, not just one render:
it survives an unrelated refresh (a git-status sweep, a badge update)
untouched, is seeded fresh only for a file that's newly appeared, and
is pruned only when a file is gone entirely. The one deliberate
exception is a Partial selection specifically -- a commit that took
some of a file's checked lines, or a discard, changes that file's
remaining diff shape, so a Partial selection's absolute line indices
no longer point at the same content; GHD's own fix (and rt's) is to
downgrade it to None rather than carry it forward or reseed it to All,
so the user reviews what's left rather than it silently riding along.

The old "line-level unstage is impossible" residual dissolves
under this model: unchecking a line was always just deselecting it,
once staging stopped being a git call at all.

## Worktree provisioning: the name field names the branch

When provisioning a worktree from a foldout, the inline name field captures the BRANCH name, not the worktree's directory name. rt picks the folder name itself from a pool (names like `theoden` or `denethor`); the provisioning verb refuses outright when given no branch, which is why the field cannot be blank. A reader seeing "Provision new worktree..." and a text entry naturally assumes the name typed is the folder -- this note clarifies it captures the branch instead.

## Context menu: GitHub Desktop's row menus, ported through rt nav's engine (2026-09-23)

Right-click on a Changes file row (label or checkbox), a History commit row,
or a History file row opens that row's menu; ctrl-k opens the same menu for
whatever has focus -- the Changes list or its diff, the History commit list
or a range, the History file column or its diff. ctrl-k inside a text field
(the commit summary or description) stays that field's own binding, never
the menu. A right-click always selects its row first, exactly as a
left-click would, and never pairs into a double-click; with a foldout
already open, a right-click only closes the foldout. With nothing to act
on, ctrl-k opens the board-wide section alone, titled "Actions".

The menu is `rt nav`'s picker menu (`ui/internal/views/picker/menu.go`)
lifted to a shared engine and driven from `ui/internal/views/mission/menu.go`;
row sets, enablement, and wording are GitHub Desktop's own, ported verbatim
-- see the row tables in
`docs/superpowers/specs/2026-09-23-glitter-context-menu-design.md` section 3
for the Changes file row, the History file row, and the commit row. A
menu's title is the file's full relative path, the commit summary ("Empty
commit message" for one with none), or "Actions" with nothing targeted.
Typing filters the rows (nav's fzf-backed rank), and each section stays
contiguous through a filter -- one rule per section boundary, never a rule
left over where every row on one side of it was filtered away. A row's key
hint is a live accelerator while the menu is open. Disabled rows paint
Faint; the cursor, hover, and clicks all skip them.

Below a rule in every menu, and the whole menu when nothing is targeted, is
the board-wide section: each row replays its own key exactly (`c` commits,
`f` runs the action segment's current verb, `b`/`w`/`r` open their
foldouts, and so on), and the two repo rows -- Open Repository in *Editor*,
Reveal Repository in Finder -- carry no path or sha. The editor name is
`rt code`'s resolved editor for the repo; an `open -a "App"` command labels
as *App*. With no editor resolved, the row reads "Open in External Editor",
and choosing it sets the notice "No editor set: run rt code once to pick
one".

**Steps.** Discard's confirmation, Ignore Folder's ancestor-folder list,
and Create Tag's name field each replace the row region in the same box:
esc steps back to the rows (or to the previous step), and the header reads
"esc back" mid-step, "esc dismiss" at the root. A step never shrinks the
box below the width it replaced. Discard's question names the file's base
name -- "Discard all changes to *name*?" -- with choices "Discard Changes"
and "Cancel".

**Fitting the frame.** Unlike `rt nav`'s inline list, which grows the frame
to fit, glitter caps the menu at the parent frame's height: a row region
too tall to show whole windows behind the shared scroll viewport and thumb
(`picker.Viewport`/`ThumbSpan`/`ThumbCell`), scrollable by wheel and by
keyboard exactly like every other scrolling region in rt-ui.

**Discard** moves the file to the Trash before touching git; the driver
re-reads git status immediately before discarding, since the cached
snapshot can lag the tree. A Trash failure partway through a multi-file
discard leaves the files already moved discarded and surfaces the failure
as the notice -- there is no permanent-delete fallback (GitHub Desktop
offers one; glitter does not).

**Create Tag** reloads the loaded History list in place, so the new tag's
pill shows immediately with no manual refresh.

The `ContextMenu.png` and `ContextMenuStates.png` boards (see Boards above)
are the signed-off reference for every state: anchored and centered
placement, disabled rows, both step kinds, the History "File Does Not
Exist on Disk" menu, and hover versus cursor treatment.

## Stash: GitHub Desktop's one-stash-per-branch model (2026-09-23)

Parity reference: GitHub Desktop's `app/src/ui/stashing` (stash-diff-viewer,
stash-diff-header, confirm-discard-stash) and `app/src/ui/stash-changes`
(stash-and-switch-branch-dialog, overwrite-stashed-changes-dialog).

**The marker and interop.** `S` (Stash All Changes) writes the stash with
the message `!!GitHub_Desktop<branch>` -- the same tag a real GitHub Desktop
writes -- so a stash created in either tool shows up, restores, and
discards correctly in the other. Each branch holds at most one such entry:
the new one is created before the branch's previous entry is dropped, never
the reverse, so a create that fails partway never leaves a branch with zero
stashes when it had one.

**The strip.** "Stashed Changes" docks above the commit box the moment the
current branch has an entry (`StashStrip` in the terminal-geometry table),
in rest / hover / selected (view open) treatments, with a leading icon
(Nerd Font `nf-oct-stack`, U+F51E -- GitHub Desktop draws its own stack
glyph) and trailing chevron. Clicking it, or pressing `h`, opens or closes
the view; `h` is also on the board-wide menu section as Show/Hide Stashed
Changes.

**The view.** Opening replaces the file and diff panes with the stash's own
committed pane, built on the same shared pane History's right side uses:
header "Stashed changes" with Restore and Discard buttons and "Restore will
move your stashed files to the Changes list.", a file column, and a
read-only diff (no stage gutter). `R` restores, `D` asks "Discard Stash?",
and `h` hides -- all three bound alike whether the stash file list or the
stash diff has focus, so a reader mid-diff never has to step back to the
file list first. esc hides from the file list; from the stash diff it
returns to the file list.

**The store owns the view state.** Which file is selected, its diff, and
whether the view is showing all live in the driver's `StashStore`
(`lib/mission/stash.ts`), not in the Go view: every key press just emits an
intent (`mission:stash-select`, `mission:stash-restore`,
`mission:stash-discard`, `mission:stash-hide`) and the view repaints from
whatever the next push carries, the same round trip every other glitter
action takes.

**The dialogs.** "Overwrite Stash?" (`S` when the branch already has an
entry) and "Discard Stash?" (`D`, or Discard from the stash view's header
button or its ctrl-k menu) are Desktop's own confirmations, ported as
centered question menus: prose row(s) above a rule, the choices below it.
Overwrite Stash?'s one-sentence body is split across two rows -- one row
would widen the box past most panes. The Switch Branch prompt arrives
unprompted on a push, whenever a checkout would clobber changes on the
current branch (never for a detached or unborn HEAD, which always bring):
"Leave my changes on *branch*" or "Bring my changes to *target*", each with
its own description as a row underneath; when the current branch already
has a stash, Leave also carries the warning "Your current stash will be
overwritten by creating a new stash". A switch prompt that arrives while
another menu is already open replaces it outright, the same rule every
question in this build follows.

**Leave versus bring.** Leave stashes the current branch's changes -- same
create-then-drop sequencing as `S` -- then checks out the target. Bring
checks the target out directly; only if git refuses because local changes
would be overwritten does it fall back to a transient stash tagged for the
*target* branch, checkout, then an immediate pop, and it never touches or
replaces the current branch's own stash entry.

The `Stash.png` and `StashStates.png` boards (see Boards above) are the
signed-off reference for every state: the strip's three treatments, the
view's header and buttons, both Switch Branch variants, and every dialog.

## Terminal-fidelity deltas (same set the picker ratified)

No drop shadows (modal lift = Surface token + Panel border + parent dim),
rounded corners only as box-drawing glyphs, 1-cell scrollbar thumb, fixed
cell line-height. Everything else on the boards is the contract: exact
tokens, glyphs, spacing rhythm, keybar grammar, and every interaction state.

## The parity checklist

A visual pass is a per-board FEATURE walk, not an impression. For each
board, before comparing anything else, extract and verify every item in
these classes (the 2026-09-18 pass missed composition-level features by
skipping straight to row content and token colors):

1. Surfaces: which regions are filled bands (top bar, keybar, strips,
   headers) and what token fills each; the frame's own canvas background
   (the view sets the terminal background to Bg; erased and never-drawn
   cells must resolve to it, verified through a real-renderer replay, not
   a byte scan of composed output).
2. Composition: what docks where (the commit block pins to the sidebar
   bottom with flexible fill above), what stretches, what stays fixed
   (sidebar width), where rules run unbroken.
   - **Foldout name entry.** A foldout that can create something collects
     the name inline: ctrl-n turns the filter line into a name field, the
     row list goes inert, and the keybar reads `enter create · esc cancel`.
     Esc is two-level: the first leaves naming and returns to filtering with
     the modal still open; the second closes the modal. The box keeps its
     exact height and hit zones, because an extra line would have to be
     mirrored by hand in the modal's own hit-test walk. Ratified 2026-09-21.
3. Iconography: every icon on the board and the exact glyph the build
   uses for it; a substitution is a finding to fix or explicitly ratify
   here, never a silent approximation.
4. Tokens: exact SGR triplet checks against theme.go for every accent,
   band, and state fill on the board.
5. States: every board state (rest/hover/cursor/disabled/empty) rendered
   and captured, including states the boards do NOT draw; an unboarded
   state (like empty) is a gap to board first, not to improvise.
   - **Worktree settling marker.** A freshly provisioned worktree wears a
     "settling" marker in the top bar until the daemon reports its ready
     steps finished. Its width is reserved so the worktree name clips first,
     keeping the marker visible on a narrow terminal.

## Terminal geometry (ratified 2026-09-19)

The board's cell unit is **26px per terminal row**. Quantizing a board
height by a plain px÷26 division silently drops anything under half a
cell — that dropped sub-cell padding is exactly what the 2026-09-19
vertical-rhythm pass found missing: a cramped top bar with no bottom
breathing and a commit button collapsed to one thin row. This table is the binding row spec,
the geometry class item 2 of the parity checklist calls for, the same
kind of written contract theme.go is for tokens — measured board
geometry on the left, the terminal row count the build renders on the
right, with the quantization ruling for anything that isn't a clean
division.

| Board element | px (pen doc) | ÷26 cells | Terminal rows | Ruling |
|---|---|---|---|---|
| TopBar | 56 | 2.15 | 3 | label row + value row + one blank BgSubtle band row (the board's own bottom breathing; its text block ends at 44px into the 56px band). Segment hover/open fills cover all 3 rows. |
| BarRule | 1 | 0.04 | 0 | sub-cell, absorbed — no separate row. |
| Tabs + TabsRule | 36 + 1 | 1.42 | 2 | label row + underline row; the filter box sits directly under the underline, with no blank row between them. Both rows of the inactive half are its button: hover fills its label row with HoverBg and swaps its underline for a HoverBg `▀` edge. |
| History top rows | n/a | n/a | 5 (tabs 2 + filter 3) | `historyFixedTopRows`: the same 2-row tabs strip (label + underline), then the same 3-row filter box the Changes sidebar has ("Filter history"), directly above the commit list. |
| History date header | n/a | n/a | 1 per run | One row before the first commit of each run of equal date group in the visible (filtered) list: the label two cells in, bold Dim on Bg. Inert to hover and click. |
| History commit row | n/a | n/a | 3 each | GHD's commit-list-item as a bold summary line (tag pill and unpushed ↑ flush right), a Dimmer byline · time line whose byline truncates before the time does, and a Rule separator row standing in for GHD's row border. The separator is inert to hover and click. |
| History action row | n/a | n/a | 1 | Closes the list while there is more to load: "Load 100 more commits", or "Search 100 more commits" under a filter, in Lav; a cursor stop with a commit row's cursor and hover treatments. While its page loads it reads "Loading…" in Faint and is inert. A filter that matches nothing centers a Faint "No matching commits" in the list, with this row below it. |
| FilterRow | 34 | 1.31 | 3 | border / text / border — already correct: a bordered box is 3 physical rows regardless of its own px height. |
| SummaryRow (master) | 24 | 0.92 | 1 | "N changed files · M staged". |
| ChangesList row | 26 | 1.00 | 1 each | exact unit match. |
| StashStrip | 26 | 1.00 | 1 | |
| CommitRule | 1 | 0.04 | 1 | kept as its own row — a rendered "─" separator, not sub-cell padding. |
| CommitBox top pad | 12 | 0.46 | 1 blank | one blank Bg row between the rule (or the amend banner, when present) and the summary box. |
| SummaryInput | 32 (bordered) | 1.23 | 3 | border / text / border. |
| CommitBox gap (summary→description) | 8 | 0.31 | 0 | absorbed — the two bordered boxes stay flush, their borders touching. |
| DescriptionInput | 64 (bordered) | 2.46 | 4 | border / text / text / border. |
| CommitBox gap (description→button) | 8 | 0.31 | 1 blank | one blank Bg row separates the button from the description box — unlike the summary/description seam, this gap is NOT flush (owner's round-2 ruling, 2026-09-19). |
| CommitButton | 32 | 1.23 | 3 (outer 2 half-height) | 1.23 cells is a genuine sub-cell height, not a clean 1 or a clean 3 -- one 1-row rendering read thin against the bordered boxes above it, three full rows read too big. Ratified 2026-09-20 ("mission commit button gains its half-cell padding"): a half-block glyph, full sidebar width, as a row's own FOREGROUND on a theme.Bg background paints only that row's half, so three physical rows carry it -- `▄` (lower half block) with the button color as foreground / theme.Bg as background, then the full solid centered-label row exactly as before, then `▀` (upper half block) with the same fg/bg rule. Half-blocks are the sanctioned way to hit a sub-cell height in this build; a hairline seam some fonts render between a half-block row and its solid neighbor is accepted, not chased. |
| UndoStrip | 30 | 1.15 | 1 | |
| Keybar | 28 | 1.08 | 1 | |
| DiffHeader | 34 | 1.31 | 1 | |
| Context menu | n/a | n/a | 2 + 3 + rows | 1 border row top and bottom (`modalBoxFrame`'s rounded border), `modalHeadRows`' 3 content rows (header, filter line, a rule) between them, then one line per menu row and one rule line per section boundary. Unlike every other foldout, which grows the frame to fit, glitter caps the box at the frame's remaining height and windows the row region behind the shared scroll viewport and thumb once rows don't fit, one column narrower beside the thumb. The Changes tab's shortest workable frame is 25 rows plus one per extra docked strip (pre-existing, for the docked commit block to fit; a stash strip makes 26), which is also the floor the menu-scrolling tests build against. |

Net effect on `sidebarBlocks` (mission.go): the top block is
`sidebarFixedTopRows` = 6 (tabs 2 + filter 3 + master 1) and the docked
block gains 4 (the commit-box top-pad blank,
the new description→button gap blank, plus 2 for the button's own half-block
caps above and below its solid label row). `layout()`'s own filler
arithmetic absorbs all of it unchanged — `sidebarDockedH` is measured by
actually rendering `sidebarDocked` (`lipgloss.Height`), not a hardcoded sum,
so `sidebarFillerH` shrinks by the same amount and floors at 0 once the
fixed chrome alone already meets or exceeds the pane. `sidebarHit`'s own
fixed-offset math is hand-maintained, not derived, so it was updated
separately: all three of the button's rows now resolve to the same
`hitCommitButton` target.

## Ratified at the build's visual pass (2026-09-18)

Deviations the terminal build keeps deliberately; the boards show the
pre-ratification drawing:

- Top-bar segment icons sit on the value row (a glyph cell before the
  value) instead of the boards' icon centered across both rows. The
  checkbox state family is the circle set (◉ current, ○ unchecked, ◪
  mixed) rather than the boards' squares, matching rt's picker language;
  the master row uses the same ◪ for its mixed state.
- Segment icons are Nerd Font glyphs (repository U+F401, worktree
  U+F402, branch U+F418), ratified 2026-09-18: rt runs on the owner's
  patched-font terminals, and the octicon set matches GitHub Desktop's
  iconography. An unpatched font shows fallback boxes there; accepted.
- The undo strip is one line ("Committed <when> · <summary>" clipped to the
  sidebar, Undo chip right) instead of the boards' two-line strip.
- The main keybar lists the built action set (adds "enter diff",
  "u undo", "S stash", and "h show stash", names the adaptive segment key
  "f action", omits "? help"). The stash keys sit last, so a narrow
  terminal clips them first.
  Both tabs also add "⌃k menu" right after the tab-switch key, so it
  survives a narrow terminal.
- The stash view is a third keybar mode, replacing the Changes keybar
  outright while showing: "↑↓ files · enter diff · R restore · D discard ·
  h hide · ⌃k menu · b branch · w worktree · r repo · q quit". `Stash.png`
  shows it in place.
- The commit button renders the disabled treatment whenever the wire says
  it cannot commit (empty summary); the boards draw the enabled pink for
  visual reference.
- The diff gutter's hover-preview bar is the exact 0.5 Pink-to-Bg blend
  (#8A3E60) via theme.GutterHoverBar; the boards' #8A4560 was hand-picked.
- Modal keybars list only wired keys: the boards' "ctrl-f fetch all"
  (repo), "ctrl-w worktrees" (repo), and "ctrl-d dispose" (worktree) stay
  off until those actions exist.
- A diverged current branch shows both count pills in the branch modal;
  the board drew only the ahead pill for the current row.
- Every foldout (repo, branch, worktree) spans the FULL frame height, per
  GitHub Desktop's own real behavior, ratified 2026-09-19: its top edge
  sits on the anchor row below the top bar, its bottom edge is the
  frame's own last row, and it stays that height regardless of match
  count -- covering the main keybar for as long as it is open, which GHD
  also does and which is intended here, not a bug. A short list top-aligns
  with Surface filler below it; a long list scrolls (cursor-follow, a
  Panel thumb) in a fixed-height row region above a pinned action/keybar
  block. This supersedes the content-height foldouts drawn on
  RepoPicker.png, BranchModal.png, and WorktreeModal.png; those boards
  will be re-exported separately, and this line is the behavior contract
  until they are.
