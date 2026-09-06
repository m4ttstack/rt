# Deck Board Redesign Design

**Date:** 2026-08-21
**Repos:** `~/Documents/GitHub/local-apps` (deck board), `~/Documents/GitHub/tui-kit` (new recipes + font), `~/Documents/GitHub/mr-board` (font ripple, re-baseline only)
**Status:** approved design, pending plan
**Parity references (normative):** `docs/design/deck-redesign/` — `board-composite.html` (board + drawer), `drawer-states-atlas.html` (all drawer screens/states), `atlas-render-1.png` / `atlas-render-2.png` (approved renders). The mocks define structure, hierarchy, copy, and states; exact colors/spacing come from tui-kit tokens, not the mock CSS.

## 1. Overview and motivation

The deck board's per-app controls are crammed inline into the status table:
hover-revealed action chiclets, a click popover on the DEV chip, a
glyph-pair access button, per-cell tooltips that clip against the table's
overflow container. Every recent defect wave (ovals, tooltip collisions,
popover jank, alignment) descends from that one decision.

This redesign separates the two jobs:

- **The table is for status** plus the two everyday actions (public
  switch, restart). Nothing else lives in rows.
- **A per-row drawer owns all depth**: dev port, access, logs, edit,
  remove — organized as a small settings-style navigation surface with
  sub-screens, so no single surface ever overfills.

The drawer's *navigation grammar* is borrowed from iOS Settings (grouped
rows, dim value hints, chevrons to sub-screens, footer sentences, one
concern per screen). **It must not read as an iOS clone**: every piece is
rendered with tui-kit recipes and theme tokens, so the visual result is
Tokyo — the same panels, borders, badges, and switches the rest of the
board uses. The mocks' white-card-on-grey look is a stand-in; the kit's
own surface tokens replace it.

Retired outright: the DEV-chip popover (including the uncommitted
`DevPortOverrideChip` work on branch `fix-switch-alignment`), AccessModal,
the stderr modal, hover-revealed row actions, and the access glyph pair.

### Goals

- Calm, scannable status table; all depth behind one consistent drawer.
- Complete drawer state coverage per the atlas (roots for every row kind,
  dev port, access, logs, edit, remove, transients).
- New tui-kit recipes generic enough for the next consumer (gitq board).
- Kit-wide font change to Tomorrow.
- Zero regressions in board data behavior: `useBoardState` and the server
  API are untouched.

### Non-goals

- No gateway page changes (just rebuilt, zero-JS — out of scope).
- No changes to deck's server endpoints, launchd handling, or fixtures'
  data shape (fixture *content* may gain fields only if a drawer state
  needs one that exists in prod payloads already).
- No mobile-specific layout beyond the drawer's narrow-window fallback.
- No health-history/log-streaming features — the drawer makes room for
  them later; they are not in this cycle.

## 2. Typography (kit-wide)

`tuiTheme.font.family` becomes `"Tomorrow", "Noto Sans JP", monospace`.

- Font files are **vendored into tui-kit** (woff2, weights 400/500/600/700
  for Tomorrow; 400/500/700 for Noto Sans JP) and shipped via `@font-face`
  in the kit's base CSS. No runtime Google Fonts dependency: deck must
  render offline.
- Tomorrow's digits are proportional. The theme gains a numeric token
  (`font-variant-numeric: tabular-nums`) applied by recipes that render
  aligned numbers (Table cells, Badge latency, port values).
- Ripple: every tui-kit consumer's pixel baselines change. mr-board's
  participation in this cycle is the dep refresh + full re-baseline of its
  20 captures + eyeball pass; no code changes expected.

## 3. Board layout

Reference: `board-composite.html`.

### Header and stat strip
Unchanged in content: title, `reload proxy`, `+ add app`, the one-line
stat strip (`3/4 healthy · 3 public · 1 protected · next 11012 ·
auto-refreshes`), discovery footer. The healthy fraction renders in `ok`
tone when all healthy, `bad` tone otherwise.

### Table
Columns: **site · port · health · service · public · restart · ›**

- **site**: leading health dot (ok/bad/warn tone — the job-① scan column),
  name + dim `.mattstack ↗` link, THIS BOARD / MANAGED chips. Error text
  (e.g. cloudflare sync failure) renders as a second line under the name
  in `bad` tone — status stays inline; it is not drawer-only.
- **port**: number; `dev` info-tone chip when an override is active. The
  chip is display-only (no popover, no click).
- **health**: existing Badge (status + latency).
- **service**: dim `pid N` / `exit N` (bad tone when nonzero) — the
  launchd column, renamed.
- **public**: kit Switch, live toggle (kept in-row: highest-frequency
  action).
- **restart**: quiet icon Button, always visible (no hover reveal).
- **›**: dim chevron, the drawer affordance.

Visual grouping: whitespace gap between the facts columns and the
controls columns (public onward), per the composite.

### Sections
`services without routes` and `cloudflare tunnel` keep their headings and
render in the same table grammar with blank cells where a column doesn't
apply. Their rows open reduced drawers (§4 roots).

### Interaction contract
- Row click or `enter` (row focused) opens the drawer for that row; the
  row gets a selected highlight while its drawer is open.
- Clicks on the public switch, restart button, or the site link do **not**
  open the drawer.
- `esc` = back one drawer screen; at the root it closes the drawer. ✕
  always closes. `↑`/`↓` while the drawer is open moves it to the
  previous/next row (drawer resets to root).
- The drawer overlays from the right edge (~340px); the table does not
  reflow. Below ~720px viewport width the drawer covers the full width.
- Polling continues while the drawer is open; drawer content re-renders
  from the same board state that feeds the table.

## 4. Drawer

Reference: `drawer-states-atlas.html` — normative for screens, states,
copy, and hierarchy.

### Structure
A right-edge overlay panel with an internal navigation stack:

- **Nav bar**: back link (`‹ <parent>`) when below root, screen title,
  and either ✕ (reading screens) or a primary `save` action (editing
  screens).
- **Status strip** (root only): health dot, latency, service state,
  `open ↗` link. Broken apps add an error banner line below it.
- **Body**: grouped row lists with optional footer sentences under a
  group.

### Row grammar (one anatomy everywhere)
- **nav row**: label · dim value hint · chevron → pushes a sub-screen
- **toggle row**: label · kit Switch (single switches never get a
  sub-screen)
- **action row**: accent-colored label, full-row hit target
- **danger row**: bad-tone label, centered
- **fact row**: label · value, inert
- **input row**: label · kit TextField (editing screens only)
- **footer**: one dim sentence under a group explaining the consequence

### Screen inventory (states per the atlas)
1. **Root — app**: public toggle group (+footer), nav group (dev port /
   access / logs with value hints), actions group (restart, edit),
   danger group (remove). Same skeleton for every app; empty states are
   words ("none", "open", "not set"), never missing rows. Broken app:
   error banner + bad-tone logs hint. Restarting: the restart row becomes
   a spinner row; status dot goes warn-tone.
2. **Root — service without route**: logs nav row, restart, "give it a
   route…" action (opens the add-app modal prefilled with the service
   name).
3. **Root — tunnel**: carries fact row, logs, restart tunnel.
4. **dev port**: assigned port fact, override fact (when set) + revert
   action + `public follows dev` toggle with footer; or `set override…`
   action → editing screen with input row + save/cancel.
5. **access**: password nav row (value: set/not set), google sign-in
   toggle, `who` nav row (hidden until sign-in is on, per current
   behavior), footers explaining each gate.
6. **access › password**: password input + save; `remove password` danger
   row (no confirm — recoverable).
7. **access › who**: mode picker rows (anyone at these domains / these
   people, checkmark-selected), allowlist entries as rows with remove ✕,
   add-entry input row. Applies on save per current Cloudflare apply
   semantics; apply errors surface as an Alert in this screen.
8. **logs**: full stderr tail (last 200 lines, newest last, live while
   open), `copy all` action. Replaces the stderr modal.
9. **edit app**: name + base port input rows; command + directory input
   rows for managed apps only. Save in nav bar. Replaces the edit modal.
10. **remove**: danger row opens the kit **ConfirmDialog** (existing
    recipe — not an iOS action sheet) stating the blast radius; confirm
    removes and closes the drawer.

### What stays a modal
Board-level flows only: add app / add external (existing modal, restyled
by the font change) and ConfirmDialog for remove.

## 5. tui-kit additions

New recipes, all token-driven, registered in the workshop and the a11y
matrix classification:

- **Drawer**: right-edge overlay panel with nav-stack semantics — back /
  title / action bar, screen push/pop (CSS slide, reduced-motion aware),
  focus trapped inside while open, `esc` back-then-close, restores focus
  to the opening row on close. Owns the narrow-window full-width
  fallback.
- **ListGroup**: the grouped row list — group container + row variants
  (nav / toggle / action / danger / fact / input) + group footer. Rows
  are semantic buttons/labels with real focus states; chevrons and value
  hints are presentation. This is the recipe that must feel Tokyo, not
  iOS: kit surface/border tokens, kit Switch/TextField/Button inside.
- **Spinner row state** for ListGroup action rows (busy replaces trigger).

Explicitly reused, not rebuilt: Switch, TextField, Badge, Chip, Button,
Alert, ConfirmDialog, Modal, Table, Tooltip (which loses its deck
popover/glyph duties and stays for genuinely iconic controls).

Deleted from deck with the redesign: `.devport-extra`/popover CSS, the
AccessModal, stderr modal wiring, hover-reveal action CSS.

## 6. Testing

- **tui-kit**: workshop pages for Drawer + ListGroup (all row variants,
  both schemes); recipe unit/DOM tests per kit conventions; contrast
  matrix classification rows for the new recipes; Button/Chip baselines
  regenerate under the new font (expected: text-only diffs — reviewer
  confirms via diff masks).
- **deck**: DOM tests rewritten around drawer flows (open/close/back,
  keyboard contract, dev-port set/revert, access password + who flows,
  logs, edit save, remove confirm, restart transient) in fixture mode;
  pixel harness re-scoped to the new surface set — board default/day +
  night, drawer root (app/broken/service/tunnel), dev port, access, who,
  logs, edit, remove-confirm, empty board, modals. All baselines
  regenerated and eyeballed against the parity references.
- **mr-board**: full 20-capture re-baseline (font ripple), diff-mask
  eyeball, no behavior changes.
- `bun run test` (unit) green in local-apps; `test:e2e` remains a
  Matt's-terminal-only observation (known environmental limitation).

## 7. Sequencing

1. tui-kit: font vendoring + theme change + tabular-nums token; kit
   baselines re-captured; consumers get the ripple in one dep refresh
   each (mr-board re-baseline can land independently of deck work).
2. tui-kit: Drawer + ListGroup recipes with workshop pages and tests.
3. deck: table restructure (columns, dots, always-visible restart,
   chevron; strip retired inline controls).
4. deck: drawer integration screen-by-screen (root → dev port → access →
   logs → edit → remove), retiring the popover/AccessModal/stderr modal
   as each replacement lands.
5. deck: DOM test rewrite + full re-baseline + live deploy.
6. Branch hygiene: `fix-switch-alignment`'s uncommitted popover work is
   discarded (superseded); its committed switch-centering fix merges if
   still applicable to the new table, else the branch is closed out.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Drawer reads as an iOS clone | ListGroup/Drawer built exclusively from kit tokens + existing kit controls; workshop review against both schemes before deck integration; the mocks are structural references only |
| Font change breaks alignment everywhere | tabular-nums token; kit + both consumers fully re-baselined in step 1 before any structural work |
| Two-click depth slows a frequent action | public + restart stay in-row; drawer remembers nothing (always opens at root) so behavior is predictable |
| New recipes leak deck-specific shapes | ListGroup/Drawer API designed against the atlas's row grammar, reviewed for gitq-board reusability before deck integration |
| Access "who" apply semantics regress | drawer reuses the exact apply/error handling from AccessModal's logic (moved, not rewritten); apply errors assert in DOM tests |
| Pixel churn hides real regressions | re-baseline waves are separated: font ripple (step 1) lands before structural changes (steps 3–5), so each wave's diffs have one cause |
