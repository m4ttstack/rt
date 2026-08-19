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
    ContextMenu.tsx (MenuItem)  Toast.tsx  StatusDot.tsx
    Markdown.tsx (.tui-md wrapper)
    hooks.ts          useEscapeClose, useAutoGrowTextarea, useRevealOnChange,
                      useBodyScrollLock
  board/              domain components
    Board.tsx         top-level state + data flow (thin)
    RowView.tsx  GridView.tsx  BoardBadges.tsx  Sidebar.tsx  SelectionBar.tsx
    RowMenu.tsx  SettingsModal.tsx  ReviewModal.tsx  DraftModal.tsx
    CommentsDrawer.tsx  Controls.tsx
    format.ts         ago, cleanTitle, statusReasons, statusPhrase, …
    hooks.ts          useBoardData (poll/SSE/visibility), useOptimisticLifecycle,
                      useToasts
```

Boundary rules:

- `ui/` never imports from `board/`; `ui/` components take props, never `BoardMR`.
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

This mechanically dissolves:

- Every `useRef<any>` → real element types.
- Every `(e.target as unknown as { value: string })` double-cast →
  `e.currentTarget.value` (the "Don't clean this up" comments go with them).
- All ~80 live `document`/`window`/`location`/`navigator` diagnostics.

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
one-line configurations. Two flows stay explicit rather than forced through
the mold: nudge (surfaces the server's plain-text refusal) and draft-state
(deliberately non-optimistic).

**`useOptimisticLifecycle<T>`.** The `optimistic` / `optimisticRespond` /
`optimisticDoctor` state triple, their three identical clear-on-server-truth
effects, and the three `*Active` fast-poll derivations collapse into one hook
keyed by axis (`review`/`respond`/`doctor`). Each axis declares its active
status set (existing constants `RESPOND_ACTIVE`, `DOCTOR_ACTIVE`).

**`BoardBadges` once.** The chip row duplicated between RowView (client.tsx:
1639-1660 pre-refactor) and GridView (1743-1764) becomes one component. The
12 identical RowView/GridView props condense into a single `rowContext`
object, which also shrinks RowMenu's 17 callback props to menu state + that
context.

## UI paper cuts (all six approved)

Each lands as its own commit with before/after screenshots:

1. **Transparent header controls** — `.tui-seg` and `.tui-copy` get
   `background: var(--panel)`; the body's grid pattern stops showing through.
2. **Native `confirm()` on re-invite** (SettingsModal) — becomes the armed
   two-click confirm pattern DraftModal already uses.
3. **`:focus-visible` styles** — one consistent accent outline rule for the
   controls that currently have none (seg buttons, copy, rows, menu items).
4. **Escape scoped to topmost layer** — modals/drawers currently each register
   their own document keydown, so Escape in the comments drawer also closes
   the row menu behind it. Scope Escape handling to the topmost open layer.
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
- **Per-step commits:** each move/dedup is its own commit; the full existing
  test suite (41 files) must pass before the next step starts. A regression
  bisects to one small commit and reverts cleanly.
- **Pixel diffs as merge gate:** before any change, Playwright screenshots of
  the live board (rows + grid × light + dark, mobile drawer, each modal/menu
  open, a stacked chain) are committed to `.local-dev/` as the baseline.
  After each phase, re-shoot and diff. Refactor commits must be
  pixel-identical; only the six paper-cut commits may change pixels, each
  showing its own before/after.
- **Characterization tests before behavior moves:** where Board() logic moves
  into hooks (`useOptimisticLifecycle`, the handler factory), tests are
  written against the current behavior first (TDD flow).
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
   `refactor/client-modules`); baseline screenshot capture set.
3. tsconfig split + `@types/react` + DOM-cast cleanups (legalized by the
   split). Exit gate: `tsc --noEmit` clean under both configs; bundle serves.
4. Mechanical move into the `src/client/` tree — imports fixed, no logic
   changes. Exit gate: pixel-identical.
5. Dedup refactors (characterization tests first). Exit gate: pixel-identical.
6. Paper cuts 1–6, one commit each with before/after shots.
7. Live walkthrough, then merge.

## Risks / accepted tradeoffs

- `e.target` → `e.currentTarget` conversions and ref typings are
  behavior-relevant in edge cases (target vs currentTarget differ on
  bubbled events); each conversion site gets eyeballed, and the pixel/manual
  gates back it up.
- Screenshot diffs can't catch non-visual behavior (clipboard writes, POST
  payloads); the characterization tests and per-commit suite carry that.
- Live board data changes between screenshot runs, so captures must be
  deterministic: the server gets a fixture mode (`BOARD_FIXTURE=<path>` env
  var, ~10 lines) that serves a canned `/data.json` snapshot instead of
  hitting GitLab. The snapshot is captured once at baseline time and committed
  alongside the screenshots; every capture run uses it.
