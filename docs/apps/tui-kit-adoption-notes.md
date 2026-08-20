# tui-kit adoption notes

Durable notes from the `feat/tui-kit-adoption` branch (merged into `main`).
This is what's worth keeping after the merge decision itself is made; see
`docs/tui-kit-devloop.md` for the install/dev-loop mechanics.

## Running the worktree board

```sh
bun run serve            # http://localhost:7930 (or $PORT if set)
PORT=8080 bun run serve  # pin a different port
```

Needs a `config.json` (copy `config.team.example.json` for a fake demo roster
— `ada`/`grace`/`linus` — if you just want to see the layout without wiring a
real GitLab project). The client is bundled in-memory at startup; restart to
pick up changes.

**Fixture mode** (what the capture harness uses, and a fast way to see the
board without any GitLab/Slack config at all):

```sh
BOARD_FIXTURE=tests/fixture PORT=7941 bun run src/server.ts
```

`BOARD_FIXTURE` points `server.ts` at a canned data directory instead of
live GitLab/Slack/switchboard — no tokens loaded, no team-config
materialize, no real network calls.

**Capture harness** (pixel-diff gate against `tests/baselines/`):

```sh
bun run capture          # boots the fixture server on :7941, screenshots
                          # 20 states (10 views × light/dark) into tests/.captures
bun run capture:compare  # diffs tests/.captures against tests/baselines
bun run capture:baseline # (only if you WANT to move the baseline — don't,
                          # unless you're deliberately accepting a visual change)
```

At merge time: 20/20, zero diffs, against the untouched pre-adoption
baselines — the kit swap is pixel-identical everywhere the capture set looks.

Other gates: `bun run typecheck`, `bun test`.

## Accepted deltas (kit behavior that diverges from the pre-adoption board, on purpose)

- **Ruling R18** (Task 19): two behavioral deltas in states the capture set
  can't reach, both the kit's deliberate design, neither restored board-side:
  - Clickable-chip hover changed from `background: var(--card)` to an
    intent-tinted 14% wash (`color-mix(in srgb, <intent> 14%, transparent)`)
    — the same weight the board already uses for its accent hover surface.
  - The chip pulse now honors `prefers-reduced-motion: reduce`; the board's
    old perpetual opacity animation never did. Strictly better a11y.
  - A third, related minor recorded under R18's umbrella: flag chips gained
    `flex-shrink: 0` from the Chip recipe (the old `.tui-flag` didn't set it)
    — benign, not restored.
- **Note-mode animation replay** (Task 20): the note-mode menu needs its own
  React key to remount/re-measure when swapping from the item list. That
  remount replays ContextMenu's 90ms `contextmenu-in` entry animation on
  every item-list → note-mode swap; the old board reconciled in place and
  never re-animated there. No capture catches it (no note-mode state in the
  capture set, and `capture.ts` disables all animation before every shot).
  Recorded as an accepted transient delta.
- **rAF-focus timing** (same note-mode remount, `src/client/board/RowMenu.tsx`):
  the note textarea is focused via `requestAnimationFrame(() => noteRef.current?.focus())`
  rather than React's `autoFocus`. The recipe renders itself `visibility:
  hidden` until its layout effect has measured and clamped the box, and a
  `visibility: hidden` subtree cannot take focus at all — `focus()` on it is a
  silent no-op (verified in Chromium: the element never becomes
  `activeElement`, and un-hiding does not retroactively grant focus). React
  fires `autoFocus` in the same commit that leaves the menu hidden, and so
  does any passive effect (React flushes those before the clamp's own state
  update re-renders), so a frame is the earliest honest moment to focus. This
  only matters because note mode now remounts (see above); before the
  adoption the div was reconciled in place and never went hidden, so
  `autoFocus` worked. Accepted as part of the same delta.

## Task 21 sweep results

- **`client/ui` grep**: `src/client/ui/` is gone; no live `src`, test, or
  config file references the old path. The only hits are in
  `docs/superpowers/plans/` and `docs/superpowers/specs/` — historical
  planning docs, expected to still name it.
- **Orphaned `.tui-` rules**: checked all 134 `.tui-*` selectors in
  `src/style.css` against every TSX file. Three had no producer anywhere and
  predate this adoption (introduced in `af71753` and `bcda722`, long before
  the kit existed) — deleted: `.tui-mascot`, `.tui-iid`, `.tui-card-review`.
  Re-ran typecheck/test/capture/compare after deleting — still 20/20, zero
  diffs, confirming they were inert.
- **`[data-part]` scoping**: all kit-facing selectors in `style.css` are
  either `[data-part=...]`-scoped (the chip state selectors additionally key
  on board-domain data attributes — `data-review`, `data-respond`,
  `data-peer`, `data-doctor`, `data-nudge`, `data-held-draft`, `data-flag`,
  `data-draft` — sitting on the kit's `[data-part="chip"]` element; that's
  intentional, documented in the big comment above them) **or one of three
  documented `[data-copied]` state hooks on a CopyButton recipe root**,
  reached via className pass-through with no `[data-part]` in the selector:
  `.tui-copy-inline[data-copied]`, `.tui-drawer-action[data-copied]`, and
  `.tui-invite-btn[data-copied]` (the last is one of two sanctioned producers
  for that green state — the CopyButton "copy invite" instance stamps
  `data-copied`, while the plain-button armed re-invite sets `.copied` as a
  class itself; both selectors are load-bearing). `.tui-row[data-local="1"],
  .tui-card[data-local="1"]` is a separate, purely board-domain attribute
  selector (`data-local` marks locally-known rows/cards) — not kit-facing at
  all.
