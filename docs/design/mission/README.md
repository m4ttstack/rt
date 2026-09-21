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
- `Mouse.png`: every mouse affordance by zone; hover always previews.
- `DiffStates.png`: expand up / down / all handles, binary and oversized
  messages.
- `EmptyState.png`: the clean-worktree state (no GitHub Desktop card
  clone): zeroed sidebar, disabled commit button, and a centered
  "No local changes" card in the diff pane with key hints.

## Ratified deviations from GitHub Desktop

- `@@` hunk headers stay visible (terminal-native); the header row itself is
  the hunk stage toggle. GitHub Desktop hides hunk text behind expand
  handles and a hunk-handle gutter.
- Guarded checkout replaces the stash-and-switch dialog: rt's worktree model
  refuses checkout of a branch owned by another worktree instead of offering
  to move changes.
- Repository rows carry numeric badges where GitHub Desktop shows a dot plus
  bare arrows.
- A worktree segment and foldout exist; GitHub Desktop has no worktree
  surface.
- The History tab is deferred; the tab renders dimmed.

## Deferred to v2

The features v1 ships a placeholder for, or does not ship at all. This
list is the in-repo half of a pair: each line has a ticket on the
"glitter v2" milestone of the mission-control project, and the ids live
only there because the repo is public and the purity gate rejects them
in source. Adding a "lands in v2" notice to the code means adding a
line here and a ticket there; removing one means removing all three.

- **History tab.** Renders dimmed with a "v2" marker; a click answers
  "History lands in v2". No commit data reaches the wire model.
- **Stash foldout.** The strip shows a count and a chevron; a click
  answers "Stash foldout lands in v2". No restore, apply, or drop.
- **Publish repository.** The action segment renders the state for
  parity; activating it answers "publishing a repository is not wired
  yet".
- **Row context menus.** Right-click answers "menu lands with polish".
- **Not copied from GitHub Desktop at all:** the Pull Requests tab and
  its merge-into footer, image diffs (submodule diffs collapse into the
  binary message today), drag-and-drop cherry-pick, and clone or
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

RT-221's own "line-level unstage is impossible" residual dissolves
under this model: unchecking a line was always just deselecting it,
once staging stopped being a git call at all.

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
     The box keeps its exact height and hit zones, because an extra line
     would have to be mirrored by hand in the modal's own hit-test walk.
     Ratified 2026-09-21.
3. Iconography: every icon on the board and the exact glyph the build
   uses for it; a substitution is a finding to fix or explicitly ratify
   here, never a silent approximation.
4. Tokens: exact SGR triplet checks against theme.go for every accent,
   band, and state fill on the board.
5. States: every board state (rest/hover/cursor/disabled/empty) rendered
   and captured, including states the boards do NOT draw; an unboarded
   state (like empty) is a gap to board first, not to improvise.

## Terminal geometry (ratified 2026-09-19)

The board's cell unit is **26px per terminal row**. Quantizing a board
height by a plain px÷26 division silently drops anything under half a
cell — that dropped sub-cell padding is exactly what the 2026-09-19
vertical-rhythm pass found missing: a cramped top bar with no bottom
breathing, no gap between the tabs and the filter box, and a commit
button collapsed to one thin row. This table is the binding row spec —
the geometry class item 2 of the parity checklist calls for, the same
kind of written contract theme.go is for tokens — measured board
geometry on the left, the terminal row count the build renders on the
right, with the quantization ruling for anything that isn't a clean
division.

| Board element | px (pen doc) | ÷26 cells | Terminal rows | Ruling |
|---|---|---|---|---|
| TopBar | 56 | 2.15 | 3 | label row + value row + one blank BgSubtle band row (the board's own bottom breathing; its text block ends at 44px into the 56px band). Segment hover/open fills cover all 3 rows. |
| BarRule | 1 | 0.04 | 0 | sub-cell, absorbed — no separate row. |
| Tabs + TabsRule | 36 + 1 | 1.42 | 2 + 1 blank | the existing tabs row + underline row, then one blank Bg row before the filter box (the rule+gap reads as breathing in the terminal). |
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

Net effect on `sidebarBlocks` (mission.go): the top block gains 1 row (the
tabs-gap blank) and the docked block gains 4 (the commit-box top-pad blank,
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
- The main keybar lists the built action set (adds "enter diff" and
  "u undo", names the adaptive segment key "f action", omits "? help").
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
