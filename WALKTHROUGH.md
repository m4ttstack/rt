# tui-kit adoption — walkthrough

Task 21 handoff. Nothing here has been merged or pushed — read it, poke at the
board, then decide what to do next.

## The kit repo (`~/Documents/GitHub/tui-kit`, branch `main`)

- `src/theme.ts` + `src/generated/theme.css` — the token layer (`createTheme`,
  `--surface-wash-*`, the 19 alias names). `soribashi build` (i.e. `bun run
  codegen`) regenerates the CSS from `theme.ts`; the `gates` script fails the
  build if that regeneration produces a diff, so the two can't drift.
- `src/recipes/` — one folder per compound component: `Chip`, `ContextMenu`,
  `CopyButton`, `Icon`, `Markdown`, `Modal`, `Panel`, `Segmented`, `SelectBox`,
  `SideDrawer`, `StatusDot`, `ToastHost`. Each is a `.module.css` + component
  pair, `data-part`-addressed.
- `src/hooks/` — the genericized `layers`, `scroll-lock`, and `toasts` hooks
  (`@mattstack/tui-kit/hooks`), used board-side via `useEscapeClose` etc.
- `src/provider.ts` — `registerTheme` / `SoribashiProvider`.
- `workshop/` — a small Vite + React app that renders every recipe live, in
  both light and dark. Run it with `bun run dev:workshop` (`cd workshop &&
  bunx vite`) — Vite's default dev URL, **http://localhost:5173**. Its
  `vite.config.ts` aliases `@mattstack/tui-kit` straight at the live `../src`
  tree, so it's always exercising the real source, not an installed copy.
- Three gates, run in order: `bun run typecheck` (`tsc --noEmit`), `bun run
  test` (`vitest run`, 31 files / 362 tests), `bun run gates` (the
  no-hardcoded-values / token-existence / no-node-builtins suites, then
  `codegen` + `git diff --exit-code src/generated/theme.css`). All three are
  green right now — see the report for verbatim output.
- Depends on a sibling `../soribashi` checkout via `file:` + `overrides`
  wiring (not workspace protocol — soribashi isn't a workspace member). See
  the kit's README "Setup" section if that checkout ever needs re-wiring.

## The adoption branch (`feat/tui-kit-adoption`, this worktree)

Base: `main` @ `520f73c` (2026-08-19). Ten commits on top, oldest first:

1. `2f7e374` — chore: adopt `@mattstack/tui-kit` dependency
2. `405c4e7` — feat: theme + canvas served from tui-kit — token blocks deleted
3. `1e3261a` — refactor: Icon/Segmented/CopyButton/SelectBox served from tui-kit
4. `c9bfc8f` — refactor: Panel + Toast served from tui-kit
5. `8fbe94a` — refactor: Modal + SideDrawer served from tui-kit
6. `6e58355` — refactor: ui/ layer served from tui-kit; style.css is board-domain only (`src/client/ui/` deleted)
7. `6468a1c` — fix: armed re-invite keeps its green; server program is DOM-free again
8. `9b47c7f` — refactor: badges ride the Chip primitive; StatusDot wraps the kit dot
9. `b7970ce` — refactor: RowMenu rides ContextMenu
10. `1289a52` — fix: delete three dead `.tui-` rules with no TSX producer (this task's sweep — see below)

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

Current state: 20/20, zero diffs, against the untouched pre-adoption
baselines — the kit swap is pixel-identical everywhere the capture set looks.

Other gates: `bun run typecheck`, `bun test` (587 tests / 52 files).

## Task 21 sweep results (this task)

- **`client/ui` grep**: `src/client/ui/` is gone; no live `src`, test, or
  config file references the old path. The only hits are in
  `docs/superpowers/plans/` and `docs/superpowers/specs/` — historical
  planning docs, expected to still name it.
- **Orphaned `.tui-` rules**: checked all 134 `.tui-*` selectors in
  `src/style.css` against every TSX file. Three had no producer anywhere and
  predate this adoption (introduced in `af71753` and `bcda722`, long before
  the kit existed) — deleted in `1289a52`: `.tui-mascot`, `.tui-iid`,
  `.tui-card-review`. Re-ran typecheck/test/capture/compare after deleting —
  still 20/20, zero diffs, confirming they were inert.
- **`[data-part]` scoping**: every remaining kit-facing selector in
  `style.css` is `[data-part=...]`-scoped (the chip state selectors
  additionally key on board-domain data attributes — `data-review`,
  `data-respond`, `data-peer`, `data-doctor`, `data-nudge`, `data-held-draft`,
  `data-flag`, `data-draft` — sitting on the kit's `[data-part="chip"]`
  element; that's intentional, documented in the big comment above them). No
  exceptions found.

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

## Your calls, not made for you

- **Merge**: nothing in this worktree has been merged into `main` or pushed
  anywhere. The branch is exactly as far as commit `1289a52`.
- **gitq adoption**: whether/how this lands via the gitq stack workflow is
  yours to decide — not attempted here.
