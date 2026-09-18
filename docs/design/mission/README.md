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

## Terminal-fidelity deltas (same set the picker ratified)

No drop shadows (modal lift = Surface token + Panel border + parent dim),
rounded corners only as box-drawing glyphs, 1-cell scrollbar thumb, fixed
cell line-height. Everything else on the boards is the contract: exact
tokens, glyphs, spacing rhythm, keybar grammar, and every interaction state.
