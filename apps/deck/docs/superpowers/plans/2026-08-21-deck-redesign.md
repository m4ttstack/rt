# Deck Board Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the deck board as a calm status table plus a settings-style per-row drawer (new tui-kit Drawer + ListGroup recipes), and switch tui-kit's font to Tomorrow kit-wide.

**Architecture:** Three lanes that run in parallel across repos with two sync points. Lane K (tui-kit): font change, then ListGroup and Drawer recipes. Lane M (mr-board): font-ripple re-baseline, unblocked by SP1. Lane D (deck): table restructure immediately (needs nothing new from the kit), then drawer integration after SP2, replacing popover/AccessModal/stderr modal screen-by-screen. Board state management (`useBoardState`) and the server API are untouched.

**Tech Stack:** React + tui-kit recipes (CSS modules, Tokyo tokens), bun build pipeline, Playwright DOM tests + pixel harness with `DECK_FIXTURE` fixture mode.

**Spec:** `docs/superpowers/specs/2026-08-21-deck-redesign-design.md` (local-apps). Parity references (normative for structure/copy/states): `docs/design/deck-redesign/board-composite.html`, `docs/design/deck-redesign/drawer-states-atlas.html`, plus `atlas-render-*.png`.

## Global Constraints

- The drawer must NOT read as an iOS clone: new recipes use tui-kit theme tokens and existing kit controls exclusively; the mocks' white-card-on-grey CSS is a structural reference only.
- Kit font stack becomes exactly `"Tomorrow", "Noto Sans JP", monospace`. Tomorrow woff2 files are vendored into tui-kit; Noto Sans JP is NOT vendored (soft fallback by name only); no runtime Google Fonts requests.
- Aligned numerals (table cells, latency badges, port values) get `font-variant-numeric: tabular-nums`.
- `useBoardState`, `api.ts`, server endpoints, and fixture data shapes are untouched.
- Pixel comparisons stay threshold 0; every regenerated baseline gets eyeballed against the parity references before commit.
- Clean-code comment rules apply (no process citations, no narration); decision records go in task reports, never code.
- Parallel dispatch is allowed ONLY across different repos/worktrees; within one repo, tasks run sequentially in lane order.
- Sync points: **SP1** = Task K1 merged to tui-kit main. **SP2** = Tasks K2+K3 merged to tui-kit main. M1 and D2 require SP1; D3–D8 require SP2.

## Execution topology

```
Lane K (tui-kit):   K1 ──────► K2 ──► K3          (sequential within repo)
Lane M (mr-board):        SP1 ─► M1                (parallel with K2/K3, D*)
Lane D (local-apps): D1 ──► (SP1) D2 ──► (SP2) D3 ──► D4 ──► D5 ──► D6 ──► D7 ──► D8
                     D1 starts immediately, parallel with K1.
```

---

### Task K1: tui-kit — Tomorrow font, vendored

**Files:**
- Create: `tui-kit/assets/fonts/tomorrow-{400,500,600,700}.woff2`
- Modify: `tui-kit/src/theme.ts` (font family + numeric token)
- Modify: kit base/global CSS entry (the file that ships resets/tokens — locate via `grep -rl "font-family" tui-kit/src` at the theme layer) to add `@font-face` rules
- Modify: `tui-kit/src/recipes/Table/*.module.css`, Badge CSS (tabular-nums application)
- Test: existing kit test suites + baseline captures

**Interfaces:**
- Produces: `tuiTheme.font.family === '"Tomorrow", "Noto Sans JP", monospace'`; CSS var `--font-numeric: tabular-nums` (name per kit token conventions) consumed by Table/Badge; `@font-face` for Tomorrow weights 400/500/600/700 with `font-display: swap` and relative asset URLs that survive the consumer build pipeline (verify how the kit's CSS/assets reach deck's build — the bundler must emit the woff2s).

- [ ] **Step 1: Vendor the fonts.** Download Tomorrow woff2 (latin subset, weights 400/500/600/700) from Google Fonts (fetch `https://fonts.googleapis.com/css2?family=Tomorrow:wght@400;500;600;700&display=swap` with a modern browser User-Agent, then fetch each `fonts.gstatic.com` woff2 URL it lists). Commit the four files under `assets/fonts/`.
- [ ] **Step 2: @font-face + theme.** Add the four `@font-face` blocks to the kit's global CSS; change `font.family` in `theme.ts`; add the numeric token; apply `font-variant-numeric: var(--font-numeric)` in Table cell and Badge CSS.
- [ ] **Step 3: Build + gates.** Run the kit's full test suite. The Button parity oracle asserts colors, not fonts — it must stay green untouched. Fix any test that hard-coded the old font stack.
- [ ] **Step 4: Re-capture kit visual baselines.** Regenerate whatever visual captures the kit keeps; eyeball: diffs must be text-rendering only.
- [ ] **Step 5: Workshop smoke.** `bun run dev:workshop`, load Buttons + Table pages, confirm Tomorrow renders (screenshot into the task report).
- [ ] **Step 6: Commit** (`feat: switch kit font to vendored Tomorrow with tabular-nums token`).

### Task K2: tui-kit — ListGroup recipe

**Files:**
- Create: `tui-kit/src/recipes/ListGroup/ListGroup.tsx`, `ListGroup.module.css`, tests, workshop page registration (follow the structure of an existing composite recipe, e.g. Field family)
- Modify: recipe index/exports; a11y matrix classification map (add ListGroup rows)

**Interfaces:**
- Produces (consumed by D3–D7):

```tsx
export function ListGroup(props: { footer?: ReactNode; children: ReactNode; className?: string }): JSX.Element;
// Row subcomponents (all rendered as <li> internally; group is a <ul> in a bordered panel):
ListGroup.Nav:    (p: { label: ReactNode; value?: ReactNode; onClick(): void; disabled?: boolean }) => JSX.Element;   // full-row button, chevron affordance
ListGroup.Toggle: (p: { label: ReactNode; checked: boolean; onChange(): void; "aria-label"?: string }) => JSX.Element; // wraps kit Switch
ListGroup.Action: (p: { label: ReactNode; onClick(): void; busy?: boolean; intent?: "accent" | "bad"; disabled?: boolean }) => JSX.Element; // busy renders Spinner in place of the label glyph, disables the row
ListGroup.Fact:   (p: { label: ReactNode; value: ReactNode }) => JSX.Element;  // inert
ListGroup.Input:  (p: TextFieldProps) => JSX.Element;                          // kit TextField in a row shell
ListGroup.Danger = ListGroup.Action with intent="bad" centered; keep as sugar: (p) => Action
```

- [ ] **Step 1: Failing tests first.** DOM tests: group renders `ul/li`; Nav row is a `button` with accessible name = label, fires onClick, shows value hint; Toggle proxies Switch checked/onChange; Action busy state disables and shows Spinner; Fact rows are not focusable; footer renders once under the group.
- [ ] **Step 2: Implement.** Panel surface from kit surface/border tokens (same family Table/Modal use — NOT white-on-grey iOS styling); rows separated by the kit divider token; value hints in the muted text token; chevron via existing glyph set; focus-visible ring per kit convention; `prefers-reduced-motion` respected for any transitions.
- [ ] **Step 3: Workshop page** showing every row variant + footer in both schemes, including busy and disabled states.
- [ ] **Step 4: Matrix classification.** Add ListGroup to the a11y classification map (rows use existing Button/Switch/TextField coverage where true; new text tones get matrix cells).
- [ ] **Step 5: Gates + commit** (`feat: ListGroup recipe — grouped settings rows`).

### Task K3: tui-kit — Drawer recipe

**Files:**
- Create: `tui-kit/src/recipes/Drawer/Drawer.tsx`, `Drawer.module.css`, tests, workshop page
- Modify: recipe exports; a11y classification

**Interfaces:**
- Produces (consumed by D3):

```tsx
export type DrawerScreen = {
  id: string;
  title: ReactNode;
  navAction?: { label: string; onAction(): void; disabled?: boolean }; // "save" slot in the nav bar
  header?: ReactNode;   // status strip / error banner region under the nav bar
  content: ReactNode;
};
export function Drawer(props: {
  open: boolean;
  stack: DrawerScreen[];        // consumer-owned; top of stack renders
  onBack(): void;               // pop; Drawer never mutates the stack
  onClose(): void;
  ariaLabel: string;
  returnFocusRef?: RefObject<HTMLElement>;  // focus restored here on close
}): JSX.Element;
```

- Behavior contract: renders as a right-edge overlay panel (`role="dialog"`, `aria-modal` false — the board keeps polling/updating behind it, background stays interactive); width `21rem`, full-width under 45rem viewport; back link labeled `‹ {previous screen title}` when stack length > 1; Escape calls `onBack` (or `onClose` at root); ✕ always calls `onClose`; focus moves into the panel on open and to `returnFocusRef` on close; screen changes slide (CSS transform), disabled under `prefers-reduced-motion`.

- [ ] **Step 1: Failing tests.** Open/close render; back label shows previous title; esc pops then closes; ✕ closes from any depth; focus enters on open and restores on close; navAction button renders and fires; full-width class under narrow viewport.
- [ ] **Step 2: Implement** using kit panel/border/shadow tokens; nav bar typography from heading tokens.
- [ ] **Step 3: Workshop page**: three-screen demo stack (reading screen, editing screen with navAction, danger content) in both schemes.
- [ ] **Step 4: Classification + gates + commit** (`feat: Drawer recipe — overlay panel with screen stack`). **SP2 = this merged to kit main.**

### Task M1: mr-board — font ripple re-baseline (requires SP1)

**Files:**
- Modify: `mr-board` lockfile via `bun install` refresh; `test/baselines/*` (20 captures)

- [ ] **Step 1:** Clean-install deps so the file: kit dep picks up K1. Build.
- [ ] **Step 2:** Run mr-board's test suites; fix nothing app-side (spec expects zero code changes — if a test asserts a font, update the assertion; anything more is a stop-and-report).
- [ ] **Step 3:** Regenerate all pixel baselines; diff-mask eyeball: every delta must be glyph rendering only. Screenshot one before/after pair into the task report.
- [ ] **Step 4: Commit** (`chore: re-baseline for kit Tomorrow font`).

### Task D1: deck — table restructure (starts immediately; no new kit APIs)

**Files:**
- Modify: `core/board/AppsTable.tsx` (major), `core/board/TunnelSection.tsx`, `core/board/board.css`, `core/board/Board.tsx` (column headers if defined there)
- Delete usages: `.devport-extra`/popover remnants, hover-reveal CSS, access glyph button
- Test: `test/dom/*.spec.ts` (adjust selectors), `test/capture.ts` scenarios

**Interfaces:**
- Produces: row layout per the composite — columns `site | port | health | service | public | restart | chevron`; a `data-part="row-chevron"` button per row that D3 will wire to the drawer (inert placeholder here: renders, focusable, no-op onClick, `aria-label` \`details for ${row.name}\`).
- Consumes: current `useBoardState` row model unchanged.

- [ ] **Step 1:** Rewrite row cells: leading health dot in the site cell (ok/bad/warn tones from row health/service state); site link + THIS BOARD / MANAGED chips kept; error line (`cloudflare sync failed…`) as second line in `bad` tone. Port cell: number + display-only `dev` chip (delete the popover/`DevPortOverrideChip` and the pencil edit button — port editing returns in D4 via the drawer; interim gap is accepted). Service cell: `pid N` / `exit N`. Public switch unchanged. Restart: always-visible quiet icon button (kept from row actions). Delete edit/trash chiclets and hover-reveal CSS (edit/remove return in D7). Add the inert chevron cell.
- [ ] **Step 2:** Keep AccessModal reachable during the interim: move its trigger to a plain text state in a temporary `access` text inside the site cell? NO — simpler interim: AccessModal stays wired to the existing access column button UNTIL D5; leave the access cell as-is in D1 (glyph button included) and delete it in D5. Only the hover-reveal actions, popover, and pencil die now.
- [ ] **Step 3:** Update DOM tests for removed/changed selectors (port popover specs deleted with the popover; new assertion: dev chip is display-only; restart button visible without hover; chevron present per row).
- [ ] **Step 4:** `bun run build:board`, `bun run test`, `bun run test:dom`; regenerate pixel baselines (structure-change wave, pre-font); eyeball against `board-composite.html` (font will differ until D2).
- [ ] **Step 5: Commit** (`feat: status-first board table — dots, always-visible restart, chevron`).

### Task D2: deck — font sync (requires SP1 + D1)

- [ ] **Step 1:** Clean-install so the kit dep picks up K1. `bun run build:board`.
- [ ] **Step 2:** Suites green; regenerate all baselines (font wave); eyeball = glyph-only diffs vs D1's baselines.
- [ ] **Step 3: Commit** (`chore: re-baseline for kit Tomorrow font`).

### Task D3: deck — Drawer shell + root screens (requires SP2)

**Files:**
- Create: `core/board/drawer/AppDrawer.tsx` (drawer state + screen registry), `core/board/drawer/RootScreen.tsx`
- Modify: `core/board/Board.tsx` (drawer mount, selected-row state), `core/board/AppsTable.tsx` (chevron + row-click wiring, selected highlight), `board.css`
- Test: `test/dom/drawer.spec.ts` (new)

**Interfaces:**
- Consumes: K3 `Drawer`/`DrawerScreen`, K2 `ListGroup.*`.
- Produces (consumed by D4–D7): `AppDrawer` owns `stack: DrawerScreen[]` state and exposes `push(screen)/pop()/close()` to screen components via props; screen builder signature `(row, nav) => DrawerScreen` — D4–D7 add builders for their screens; root nav rows call `nav.push(buildX(row, nav))`.

- [ ] **Step 1: Failing DOM tests.** Row click opens drawer titled by app name; switch/restart/site-link clicks do NOT open it; esc closes at root; ✕ closes; ↑/↓ moves the drawer to adjacent row (root screen, new title); open row carries a selected class; focus returns to the row chevron on close.
- [ ] **Step 2: Root screens** per the atlas: app root (public toggle group + footer sentence; nav group dev port/access/logs with live value hints — override state, access summary, stderr line count; actions group restart [busy state reuses the row's restart mutation] + edit nav; danger group remove). Service-without-route root (logs, restart, "give it a route…" → opens the add-app modal with the name prefilled). Tunnel root (carries fact, logs, restart). Broken-app root: error banner in the screen `header` slot, `bad`-tone logs hint. Nav rows for dev port/access/logs/edit push placeholder screens (title + "coming in this branch" fact row) until D4–D7 replace them — each of D4–D7 swaps its placeholder for the real builder.
- [ ] **Step 3:** Build, suites, new baseline scenarios: `drawer-root`, `drawer-root-broken`, `drawer-root-service`, `drawer-root-tunnel` (fixture mode, day; plus night for `drawer-root`). Eyeball against atlas.
- [ ] **Step 4: Commit** (`feat: per-row drawer with root screens`).

### Task D4: deck — dev port screens

**Files:**
- Create: `core/board/drawer/DevPortScreen.tsx`
- Modify: `AppDrawer.tsx` (swap placeholder), `AppsTable.tsx` (delete any dead port-edit remnants)
- Test: extend `test/dom/drawer.spec.ts`; delete obsolete `test/dom/port.spec.ts` assertions

**Interfaces:** consumes the same port-override mutations the popover used (`startEdit`/`clearPort`/`onPublicFollows` equivalents in `useBoardState` — reuse verbatim).

- [ ] **Step 1: Failing tests:** override-active screen shows assigned + override facts, revert action reverts (fixture mutation observable), `public follows dev` toggle wired; no-override screen shows `set override…` → editing screen with input + nav `save` (saves, pops to view state) + cancel action.
- [ ] **Step 2:** Implement per atlas (footer sentences verbatim from the atlas copy).
- [ ] **Step 3:** Baselines: `drawer-devport`, `drawer-devport-set`. Gates. **Commit** (`feat: dev port drawer screens; popover era ends`).

### Task D5: deck — access screens, AccessModal retired

**Files:**
- Create: `core/board/drawer/AccessScreens.tsx` (root/password/who builders)
- Modify: `AppDrawer.tsx`; `AppsTable.tsx` (delete the access glyph cell — access reaches users via the drawer now); DELETE `core/board/AccessModal.tsx`; `Board.tsx`/`useBoardState` modal-open plumbing pruned (state hooks stay)
- Test: rewrite access DOM specs against drawer flows

**Interfaces:** the apply/error semantics move from AccessModal verbatim: password set/remove mutations; oauth on/off; mode + list applied via the existing apply call on `save`; apply errors render as kit `Alert` inside the `who`/root screen (the oauthError slot behavior preserved: a teardown failure surfaces even after the toggle turns off).

- [ ] **Step 1: Failing tests** for: root hints (`set`/`not set`, sign-in toggle, `who` row hidden until sign-in on); password screen set/change/remove; who screen mode switch, entry add/remove, save applies, apply-error Alert renders.
- [ ] **Step 2:** Implement; delete AccessModal + its trigger cell; prune modal state.
- [ ] **Step 3:** Baselines: `drawer-access`, `drawer-access-who`, `drawer-access-password`; remove `modal-access*` scenarios. Gates. **Commit** (`feat: access drawer screens; AccessModal retired`).

### Task D6: deck — logs screen, stderr modal retired

**Files:**
- Create: `core/board/drawer/LogsScreen.tsx`
- Modify: `AppDrawer.tsx`; `AppsTable.tsx` (delete the stderr file-warning button from the health cell — the drawer's logs hint replaces it); delete the stderr Modal wiring
- Test: logs DOM spec; delete stderr-modal spec

- [ ] **Step 1: Failing tests:** logs screen shows fixture stderr tail newest-last, live-updates on poll, `copy all` writes clipboard (assert via Playwright clipboard API), empty state text for no output.
- [ ] **Step 2:** Implement (log surface uses the kit's code-block/panel token treatment, dark surface per atlas). Baselines: `drawer-logs`; remove `modal-stderr`. Gates. **Commit** (`feat: logs drawer screen; stderr modal retired`).

### Task D7: deck — edit + remove via drawer

**Files:**
- Create: `core/board/drawer/EditScreen.tsx`
- Modify: `AppDrawer.tsx` (edit builder + remove confirm wiring); `modals.tsx` (edit modal deleted; add-app modal stays); ConfirmDialog reused for remove
- Test: edit/remove DOM specs rewritten for drawer

- [ ] **Step 1: Failing tests:** edit screen fields (name/base port always; command/directory only for managed rows), nav `save` persists via the existing edit mutation, validation errors render inline (reuse current field error semantics); remove danger row opens ConfirmDialog with blast-radius copy, confirm removes app and closes drawer.
- [ ] **Step 2:** Implement; delete the edit modal. Baselines: `drawer-edit`, `drawer-remove-confirm`; drop `modal-edit`. Gates. **Commit** (`feat: edit/remove through the drawer`).

### Task D8: deck — final sweep, deploy, branch hygiene

**Files:**
- Modify: `test/capture.ts` (final scenario list), `docs/board-dev-loop.md` (drawer testing notes), baselines
- Branch ops: local-apps `fix-switch-alignment`

- [ ] **Step 1:** Reconcile the pixel scenario list to the final surface set (board default day+night, empty, preflight, sections, notices, add-app modals, all drawer scenarios). Full `capture:baseline` + eyeball every PNG against the parity references; `capture:compare` green at threshold 0.
- [ ] **Step 2:** Full gates: `bun run build:board`, `bun run test`, `bun run test:dom`. Update `docs/board-dev-loop.md` for drawer-era testing.
- [ ] **Step 3:** Deploy: rebuild + kickstart the live deck service per repo docs; verify live board renders the new UI.
- [ ] **Step 4:** Branch hygiene: on `fix-switch-alignment`, discard the uncommitted popover work (`git checkout -- .` after confirming only superseded files are dirty); cherry-pick/merge the still-valid commits (`7115c79` switch centering if the new table still needs it — verify; `c33881e` spec docs) into the redesign branch or main; delete the branch.
- [ ] **Step 5: Commit + merge** per finishing-a-development-branch.

---

## Plan self-review notes

- Spec coverage: §2→K1/M1/D2; §3→D1/D3; §4→D3–D7 (atlas screens 1–10 all assigned); §5→K2/K3 + deletions in D4–D7; §6→tests distributed per task + D8; §7 sequencing = the lane topology; §8 risks carried into task steps (interim access gap avoided by keeping AccessModal until D5; re-baseline waves separated D1/D2).
- Interim states are explicit: after D1 port editing is drawer-less until D4 (accepted gap — dev-port editing is rare and `deck` CLI still exists); AccessModal survives until D5; stderr modal until D6; edit modal until D7.
- Type consistency: `DrawerScreen`/`ListGroup.*` signatures defined once in K2/K3 and consumed by name in D3–D7.
