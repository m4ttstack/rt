# mr-board client refactor (Phase 1)

Date: 2026-08-19
Status: approved in brainstorming

## Purpose

`src/client.tsx` holds the entire React app in one 3,169-line file, typechecked
under a server tsconfig that omits the DOM lib (forcing `useRef<any>` and
documented "load-bearing" double-casts). This refactor makes the frontend
modular and honestly typed, dedupes the copy-pasted handler/badge code, and
fixes six approved UI paper cuts — with zero behavior change outside those six.

This is Phase 1 of a two-phase effort. Phase 2 (out of scope here) extracts the
board's look and feel into a soribashi-driven UI library ("tui-kit") shared
across mattstack surfaces (mr-board, gitq board). Phase 1's `ui/` vs `board/`
boundary is deliberately the Phase 2 extraction seam.

## Scope

In scope:

- Commit the finished-but-uncommitted stacked-chains work (BOARD-12) first.
- Split tsconfig into server (root, unchanged libs) and client (DOM lib).
- Carve `src/client.tsx` into a `src/client/` module tree.
- Dedup: one POST helper + launch-action hook, one optimistic-lifecycle hook,
  one `BoardBadges` component, condensed row-context props.
- Six approved UI paper cuts (listed below).

Out of scope (decided during brainstorming):

- `server.ts` restructuring (backend is already well-factored elsewhere).
- `style.css` restructuring, CSS Modules, tokens rework — Phase 2.
- State-management libraries, context providers for board data, memoization.
- Arrow-key menu navigation; touch-hover rework.

## Module layout

Everything browser-side moves from `src/client.tsx` into `src/client/`:

```
src/client/
  main.tsx            entry: createRoot + <Board/> (Bun.build entrypoint)
  tsconfig.json       extends root; lib ESNext+DOM+DOM.Iterable; no bun types
  types.ts            BoardData, BoardMRWithReview, ReviewInfo/RespondInfo/
                      DoctorInfo, SlackInfo, PeerReviewInfo, nudge types, Toast
  api.ts              typed fetch layer: getData/getMember/getDiscussions +
                      postAction() that every POST route goes through
  ui/                 generic, board-agnostic (the future tui-kit shortlist)
    Icon.tsx  Segmented.tsx (+LabeledSeg)  CopyButton.tsx  SelectBox.tsx
    Panel.tsx  Modal.tsx (overlay+frame)  SideDrawer.tsx
    ContextMenu.tsx (MenuItem)  Toast.tsx
    Markdown.tsx (.tui-md wrapper)
    hooks.ts          useEscapeClose, useAutoGrowTextarea, useRevealOnChange,
                      useBodyScrollLock
  board/              domain components
    Board.tsx         top-level state + data flow (thin)
    RowView.tsx  GridView.tsx  BoardBadges.tsx  Sidebar.tsx  SelectionBar.tsx
    RowMenu.tsx  SettingsModal.tsx  ReviewModal.tsx  DraftModal.tsx
    CommentsDrawer.tsx  Controls.tsx  StatusDot.tsx
    format.ts         ago, cleanTitle, statusReasons, statusPhrase, …
    hooks.ts          useBoardData (poll/SSE/visibility), useOptimisticLifecycle,
                      useToasts
```

Boundary rules:

- `ui/` never imports from `board/`; `ui/` components take props, never
  `BoardMR`. (This is why `StatusDot` lands in `board/`: its API takes a
  `BoardMR`, and reworking that API would break the "mechanical move" rule —
  Phase 2 can generalize it.)
- `BoardBadges` lives in `board/` (welded to the MR lifecycle) but renders its
  chips through a generic `ui/` chip/badge primitive so Phase 2 can lift the
  visual family.
- Shared pure modules used by both server and client stay in `src/` untouched:
  `view.ts`, `template.ts`, `selection.ts`, `data.ts`, `respond-outcome.ts`.
- `server.ts`'s Bun.build entrypoint changes to `client/main.tsx`. `style.css`
  stays one file.

## tsconfig split + type-safety cleanup

- Root `tsconfig.json`: unchanged except `"exclude": ["src/client"]`.
- `src/client/tsconfig.json`: extends root, `"lib": ["ESNext", "DOM",
  "DOM.Iterable"]`, no `"types": ["bun"]`.
- Add `@types/react` and `@types/react-dom` as devDependencies (currently
  riding in transitively).
- Nearest-config-wins gives editors and `tsc --noEmit` the right world per file.

`extends` inherits the root's `"types": ["bun"]`, so the client config must
explicitly override with `"types": []` — omitting the key is not enough.

This mechanically dissolves:

- Every `useRef<any>` → real element types.
- The four `(e.target as unknown as { value: string })` double-casts →
  `e.currentTarget.value` (all four are direct `onChange` handlers where
  target === currentTarget, so the conversion is safe; the "Don't clean this
  up" comments go with them). The two bubbled-event `e.target` checks
  (onRowClick, RowMenu outside-click) are correct as-is and stay.
- All 38 `document`/`window`/`location`/`navigator` diagnostics (of the 60
  total live errors in client.tsx).

Caveat: under the DOM lib, `res.json()` returns `Promise<any>`, so the
current `body is unknown` errors vanish silently at the tsconfig step — real
type safety on POST results arrives with `postAction()` in the dedup step.

Casting moves to the data boundary: `api.ts` returns `BoardData` with
`mrs: BoardMRWithReview[]`, typed once at the fetch. The ~20 scattered
`(mr as BoardMRWithReview)` casts disappear; components receive the wide type
and narrow down. Untyped `r.json()` results (`body?.focused`, `body?.queued`)
become a small typed result shape from `postAction()`.

## Dedup refactors

**`postAction()` + `useLaunchAction`.** Board()'s eight near-identical
callbacks (launch/re-review/respond/doctor/resume/nudge/draft-state/slack-*)
each hand-roll fetch → parse → toast-on-fail → reload. One `postAction(path,
body)` in `api.ts`; one `useLaunchAction(kind)` hook packaging the shared
choreography (optimistic-set → POST → on-fail rollback + toast → on-ok
"already running, focused its tab" toast + reload). The eight callbacks become
one-line configurations — six go through `useLaunchAction`; two stay explicit
rather than forced through the mold: nudge (surfaces the server's plain-text
refusal) and draft-state (deliberately non-optimistic).

**`useOptimisticLifecycle<T>`.** The `optimistic` / `optimisticRespond` /
`optimisticDoctor` state triple, their three identical clear-on-server-truth
effects, and the three `*Active` fast-poll derivations collapse into one hook
keyed by axis (`review`/`respond`/`doctor`). Each axis declares its active
status set (existing constants `RESPOND_ACTIVE`, `DOCTOR_ACTIVE`).

**`BoardBadges` once.** The chip row duplicated between RowView (client.tsx:
1639-1660 pre-refactor) and GridView (1743-1764) becomes one component. The
13 identical RowView/GridView props condense into a single `rowContext`
object, which also shrinks RowMenu's 22 props (14 callbacks + 4 capability
flags + the rest) to menu state + that context.

## UI paper cuts (all six approved)

Each lands as its own commit with before/after screenshots:

1. **Transparent header controls** — `.tui-seg` and `.tui-copy` get
   `background: var(--panel)`; the body's grid pattern stops showing through.
2. **Native `confirm()` on re-invite** (SettingsModal) — becomes the armed
   two-click confirm pattern DraftModal already uses.
3. **`:focus-visible` styles** — one consistent accent outline rule for the
   controls that currently have none (seg buttons, copy buttons, rows; menu
   items and the panel title already have theirs).
4. **Escape scoped to topmost layer** — five-plus components independently
   register document-level keydown listeners (useEscapeClose, RowMenu,
   CommentsDrawer, …), so one Escape press fires them all and can close
   stacked layers together. Consolidate so Escape only closes the topmost
   open layer.
5. **Unified body scroll lock** — only CommentsDrawer locks the page today;
   settings/review/draft modals and the mobile drawer get the same
   `useBodyScrollLock`.
6. **RowMenu measured positioning** — replace the hand-estimated height
   formula (`H = 60 + …`) with a post-render measurement so the menu can't
   drift off-screen as item counts grow.

## Regression harness

- **Worktree:** all work happens in a dedicated git worktree
  (`~/Documents/GitHub/mr-board-wt-client-refactor`, following the existing
  `mr-board-wt-*` sibling convention) on branch `refactor/client-modules`.
  The main checkout — and the launchd service running from it — stays on
  `main`, completely untouched until final sign-off.
- **Fixture mode is the worktree's whole runtime.** `config.json`, `.env`,
  and `state/` are gitignored, so a fresh worktree has none of them and
  `loadConfig()` throws at boot (`src/config.ts:281-286`). `BOARD_FIXTURE=
  <path>` therefore does more than can `/data.json`: it supplies a committed
  fixture config (bypassing `config.json` entirely), serves canned responses
  for every endpoint the capture set touches (`/data.json`, `/discussions`,
  `/review/report`, `/peer/boards`, `/member`), makes zero GitLab/Slack/
  switchboard calls, and disables the outbound timers (Slack auto-resolve,
  peering/outbox ticks) — the machine-global rt secrets ARE readable from a
  worktree, so a fixture server must be inert by construction, not by luck.
- **Distinct port.** The fixture config pins a port that is not the live
  board's (`config.port` / `$PORT`, live default 7930), and the Playwright
  capture script targets that port explicitly — so a capture run can never
  silently screenshot the live board.
- **Deterministic captures.** The fixture snapshot (captured once from the
  live board, augmented if needed so it contains a stacked chain; repo is
  private so real MR titles stay as-is) is committed alongside a pinned
  timestamp, and every capture run uses Playwright's fixed-clock support
  (`clock.setFixedTime`) with that timestamp — otherwise "3h ago" vs "26h
  ago" relative-time text diffs every re-shoot. Baselines are shot against
  the fixture server, never the live board, so baseline and re-shoot compare
  like with like.
- **Baseline location:** `tests/baselines/` (tracked). `.local-dev/` is
  gitignored and can't hold them.
- **Capture set:** rows + grid × light + dark, mobile drawer, each modal and
  the row menu open, the comments drawer, a stacked chain, plus
  focused-element shots (tab-stops) for the `:focus-visible` paper cut.
- **Behavioral assertions where pixels can't see:** the Escape-layering paper
  cut is verified by a scripted Playwright assertion (open drawer over menu,
  press Escape, assert only the top layer closed), not screenshots. Transient
  states (optimistic chips, toasts) are covered by the characterization
  tests, not the capture set.
- **Per-step commits:** each move/dedup is its own commit; the full existing
  test suite (42 files) must pass before the next step starts. A regression
  bisects to one small commit and reverts cleanly.
- **Pixel diffs as merge gate:** refactor commits must be pixel-identical
  against the baseline; only the six paper-cut commits may change pixels,
  each showing its own before/after.
- **Characterization tests before behavior moves:** where Board() logic moves
  into hooks (`useOptimisticLifecycle`, the handler factory), tests are
  written against the current behavior first (TDD flow), explicitly covering
  the optimistic set/rollback/clear transitions and toast emissions.
- **Revert over patch-forward:** if a step's diff isn't clean and the cause
  isn't obvious, the step reverts.
- **Final gate:** Matt's live walkthrough of his real board on the branch
  before merge.

## Sequencing

1. Commit stacked-chains work (`feat: stacked MR chains render as one unit
   (BOARD-12)`) after a green test run — this happens in the main checkout,
   since that's where the dirty work lives; everything after runs in the
   worktree.
2. Create the worktree (`mr-board-wt-client-refactor` on
   `refactor/client-modules`).
3. Land `BOARD_FIXTURE` mode (server change, per the harness section) +
   commit the fixture snapshot, fixture config, and pinned timestamp; then
   shoot the baseline capture set against the fixture server into
   `tests/baselines/`.
4. tsconfig split + `@types/react` + DOM-cast cleanups (legalized by the
   split), plus a small cleanup commit for the ~25 pre-existing type errors
   in test files (`board.test.ts` BoardConfig shape, `RequestInfo` /
   `typeof fetch` in the peer tests). Exit gate: `tsc --noEmit` fully clean
   under both configs; bundle serves.
5. Mechanical move into the `src/client/` tree — imports fixed, no logic
   changes. Exit gate: pixel-identical.
6. Dedup refactors (characterization tests first). Exit gate: pixel-identical.
7. Paper cuts 1–6, one commit each with before/after shots (plus the scripted
   Escape assertion for cut 4).
8. Live walkthrough, then merge.

## Risks / accepted tradeoffs

- `e.target` → `e.currentTarget` conversions and ref typings are
  behavior-relevant in edge cases (target vs currentTarget differ on
  bubbled events); each conversion site gets eyeballed, and the pixel/manual
  gates back it up.
- Screenshot diffs can't catch non-visual behavior (clipboard writes, POST
  payloads); the characterization tests and per-commit suite carry that.
- The `BOARD_FIXTURE` mode is real (small) server-code scope inside what is
  otherwise a client refactor: fixture config bypass, canned endpoint
  responses, timer suppression. It's accepted because it's also the seed of a
  permanent capture harness the repo keeps after this refactor.
- Pixel-diffing is inherently font-rendering-sensitive; captures run on this
  machine only, so baselines are valid locally, not cross-platform.
