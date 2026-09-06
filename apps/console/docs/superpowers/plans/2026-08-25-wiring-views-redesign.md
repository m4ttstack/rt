# Wiring View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the console `/wiring` view as three top-level tabs (Pipeline / Surface / Health) plus a per-skill detail panel that replaces the five right-hand drawers.

**Architecture:** Pure client-side reorganization — `src/server/skills.ts` and all `useWiring` hooks stay untouched (confirmed: every tab's data is already served). `WiringMap.tsx` gains a tab state and routes existing + new sub-views. The five drawers (`CompileDrawer`, `VersionTimeline`, `InverseIndex`, `Rebind`, `SurfaceRoster`) are refactored: their bodies move into either the detail panel's sub-tabs or the Surface tab; the `Drawer` chrome is dropped.

**Tech Stack:** React + Mantine (`@ui/core` re-exports all of `@mantine/core`), TanStack Query, Hono client, Vitest + jsdom, Storybook.

**Spec:** `docs/design/wiring-views/` — the `.dc.html` artboards are the parity spec (Tokyo-theme literals). `README.md` there carries the literal→token map. Published canvas: https://claude.ai/code/artifact/d753efeb-72fd-48ca-91e9-64798c66be32

## Global Constraints

- **Parity is non-negotiable.** Every color, padding, radius, and font-size must resolve to the artboard's literal value. Do NOT hardcode the `--tk-*` hex in components — use the theme tokens that resolve to them, per the README map:
  - surfaces: `useSchemeColors()` → `bg.level1/2/3/4`; text: `text.gray` (=`#111`) / `text.muted` (=`#8990b3`); borders: `border.default`, or `SOFT_RULE` (=`var(--mantine-color-gray-3)` → `--tk-border-soft`).
  - intent colors: Mantine names `accent`/`ok`/`warn`/`bad`/`purple`/`cyan`. Health dots via `text.highContrast('ok'|'warn'|'bad'|'purple')` (existing pattern).
  - spacing: Mantine `spacing` steps `xs..xxxl` (`xxl`=1.125rem, `xxxl`=1.5rem). radius: `md`(6)/`lg`(8)/`xl`(10). fontFamily: theme default (JetBrains Mono).
- **No new hardcoded hex** anywhere. If a value in an artboard has no token, add a comment naming the artboard source.
- **The graph-paper grid is already global** on `#page-shell-content` (28px). Do not re-add it per component.
- **Font family** comes from the theme; never set `font-family` inline.
- Match the existing file conventions (barrel imports from `@ui/core`, `@ui/hooks`, `@ui/icons`; `Icons.*` for icons).
- Keep `rt`-command data flow unchanged — client reorg only.
- Comment discipline: a comment only for a non-obvious constraint (parity anchor, ordering trap). No narration.

## Verification gate (every task)

A task is DONE only when ALL pass:

1. `bun run typecheck` clean.
2. `bunx vitest run <touched test files>` green (task adds/updates tests).
3. Renders in Fast Browser at `http://localhost:5173/wiring` with no console errors.
4. **Parity diff**: controller extracts the artboard's computed `padding`/`border-radius`/`font-size`/`color`/`gap` for the changed surface and diffs against the live component's `getComputedStyle`. Any mismatch is a task failure.

---

## File Structure

New files:

- `src/app/wiring/WiringTabs.tsx` — the tab definitions + active-tab state wiring (or inline in WiringMap if small).
- `src/app/wiring/SummaryStrip.tsx` — structured fact strip (replaces `SpineSummary` run-on).
- `src/app/wiring/SkillDetailPanel.tsx` — the per-skill detail panel with sub-tabs; hosts `CompiledView`, `VersionTimeline` body, `InverseIndex` body, inline `Rebind`.
- `src/app/wiring/SurfaceTab.tsx` — the promoted roster (2-col grid, filter bar, footer).
- `src/app/wiring/HealthTab.tsx` — grouped check results + stat cards.

Modified:

- `src/app/wiring/WiringMap.tsx` — tab scaffold, detail-panel state, drawer removal.
- `src/app/wiring/SkillRow.tsx` / `SlotRow.tsx` — slim to one-line; slot tables leave the row.
- `src/app/wiring/SurfaceRoster.tsx` — body extracted for `SurfaceTab` (or superseded).

---

### Task 1: Top-level tab scaffold

**Files:**

- Modify: `src/app/wiring/WiringMap.tsx` (WiringMap L718-834; WiringSpineView L363-686)
- Create: `src/app/wiring/HealthTab.tsx` (placeholder for now)
- Test: `src/app/wiring/__tests__/WiringMap.tabs.test.tsx`

**Interfaces:**

- Consumes: `PageShellTab` from `@ui/core` (`{id,label,icon?,active?,onClick?}`); `useSchemeColors()`.
- Produces: an `activeTab` state (`'pipeline'|'surface'|'health'`) in WiringMap; Pipeline tab renders existing `WiringSpineView` unchanged; Surface tab renders existing `SurfaceRoster` body inline (Task 5 refines); Health tab renders `HealthTab` placeholder.

**Steps:**

- [ ] Write failing test: `/wiring` renders a tab bar with tabs "Pipeline", "Surface", "Health"; clicking "Health" hides the spine and shows the Health panel. (Mock `usePacks`/composition/check as the existing tests do.)
- [ ] Run it, confirm it fails.
- [ ] Add `const [activeTab, setActiveTab] = useState<'pipeline'|'surface'|'health'>('pipeline')` to WiringMap. Build `tabs: PageShellTab[]` with `icon` (`Icons.zap`/`Icons.layers`/`Icons.activity` or nearest), `active`, `onClick`. Pass `tabs` to `PageShell`.
- [ ] Render the active panel: pipeline → `<WiringSpineView .../>`; surface → existing `SurfaceRoster` rendered inline (drop the Drawer by passing through its body — minimal: keep SurfaceRoster but Task 5 rewrites); health → `<HealthTab pack={pack}/>` placeholder.
- [ ] Remove the header "Surface" `Button` (L781-791) and `surfaceOpen` state (the drawer at L821-831) — Surface is a tab now.
- [ ] Health count badge: `tabs` Health label shows `useAttentionCount()` when > 0 (warn tint).
- [ ] Run test → pass. Typecheck. Browser-render check. Commit.

### Task 2: Pipeline summary strip + slim rows

**Files:**

- Create: `src/app/wiring/SummaryStrip.tsx`
- Modify: `src/app/wiring/WiringMap.tsx` (replace `SpineSummary` L189-297 usage), `src/app/wiring/SkillRow.tsx`, `src/app/wiring/SlotRow.tsx`
- Test: `src/app/wiring/__tests__/SummaryStrip.test.tsx`, update SkillRow tests

**Parity target:** `Main.dc.html` summary strip + stage rows.

**Interfaces:**

- `SummaryStrip` props: `{ orchestrator: SpineEntry|null; workType: string|null; stageCount: number; health: WiringHealth-ish summary; attentionCount: number }`. Renders the 5 facts (Orchestrator link / Work type / Stages / Pack health / Attention) with `flabel` (10px uppercase `text.muted`) + `fval` (13px), dividers `border-right` `SOFT_RULE`, padding matching `Main.dc.html` (.summary padding 14px 18px; .fact padding 0 18px).
- Slim `SkillRow`: keep name/ref/health/`N slots` count + chevron; REMOVE the inline `SlotTable` from the pipeline-row rendering (slot detail moves to the detail panel in Task 4). Row becomes clickable (whole row → detail open, wired in Task 4 via an `onOpen` prop; add the prop now, no-op until Task 4).

**Steps:**

- [ ] Failing test: SummaryStrip renders the five labelled facts with the given values.
- [ ] Implement SummaryStrip against `Main.dc.html` values (extract exact px/color from the artboard; use tokens).
- [ ] Replace the run-on `SpineSummary` with `<SummaryStrip .../>`.
- [ ] Slim SkillRow: gate the inline `SlotTable` behind a `showSlots` prop defaulting false for pipeline rows; add `onOpen?: () => void` + make the row a clickable surface (`role`/keyboard per existing a11y pattern). Add a `slotCount` display (`N slots` / `no slots`).
- [ ] Update SkillRow tests for the slim layout.
- [ ] Typecheck, vitest, browser render, parity diff (summary strip + a stage row). Commit.

### Task 3: "Not run by this pipeline" — rename + collapse

**Files:**

- Modify: `src/app/wiring/WiringMap.tsx` (`OutsideThePipeline` L133-179, `OrphanFillRow` L81-126)
- Test: update `WiringMap`/outside tests

**Parity target:** `Main.dc.html` off-pipeline collapsed section.

**Steps:**

- [ ] Failing test: the off-pipeline section header reads "Not run by this pipeline", is collapsed by default, shows a count + "N other plugin"/"N unwired" badges, and expands on click.
- [ ] Rename heading + subline ("N skills you invoke directly, plus fills another plugin binds. No run order.").
- [ ] Wrap the outside list in a collapse (Mantine `Collapse` from `@ui/core`), default closed; header row with chevron + counts (derive from `spine.outside` / `spine.orphans`).
- [ ] Typecheck, vitest, browser render, parity diff. Commit.

### Task 4: Skill detail panel (replaces 4 drawers)

**Files:**

- Create: `src/app/wiring/SkillDetailPanel.tsx`
- Modify: `src/app/wiring/WiringMap.tsx` (WiringSpineView: replace the 4 drawers L602-683 with panel state; wire row `onOpen`)
- Test: `src/app/wiring/__tests__/SkillDetailPanel.test.tsx`

**Parity target:** `Detail.dc.html` (split view: list left, panel right; sub-tabs; inline rebind).

**Interfaces:**

- `SkillDetailPanel` props: `{ pack: string; entry: SpineEntry; composition: SkillsComposition; bindingSites: Record<string,BindingSite[]>; onClose: () => void; onSwitchEntry: (e: SpineEntry) => void }`.
- Header: name (16px/700), ref (`text.muted`), kind badge, health chip (`text.highContrast`), public/internal switch, "Open source" (vscode link — reuse RowActions logic), "Preview compile", "Copy agent context".
- Sub-tabs via Mantine `Tabs` from `@ui/core`: **Slots & bindings** (default) / **Compiled** / **History** / **Used by**.
  - Slots & bindings: render `entry.slots` as slot cards (from `SlotRow` styling), each with contract/fill-link/`N sites`; **inline Rebind** — reuse `Rebind.tsx` body (it already derives candidates from `composition`, previews `rt skills bind`, calls `onApply`); mount it inline (not in a Drawer) when a slot's Rebind is clicked. Wire `bind.mutate` via `useSkillsApply`.
  - Compiled: `<CompiledView body={fetchCompilePreview(...)} slots={entry.slots}/>` (use `useCompilePreview(pack, entry.verb)`).
  - History: reuse `VersionTimeline` body (identified by `pack` + `entry.verb`); drop its Drawer wrapper.
  - Used by: reuse `InverseIndex` body (`sites = bindingSites[boundTo]`); drop its Drawer wrapper. Row-level "N sites" opens this tab pre-focused on that fill.
- Layout: split — left column ~400px condensed spine list (reuse slim rows), right column the panel (`flex:1`), per `Detail.dc.html`. On narrow widths the panel can overlay (defer; desktop split is the spec).

**Steps:**

- [ ] Failing test: clicking a spine row opens the panel with the skill name; the panel shows four sub-tabs; the Slots tab lists the slots; clicking Rebind shows the inline editor with the `rt skills bind` preview.
- [ ] Extract the drawer bodies: refactor `CompileDrawer`→ use `CompiledView` directly; lift `VersionTimeline`/`InverseIndex`/`Rebind` bodies so they render without their `Drawer`. Keep their internal logic.
- [ ] Build `SkillDetailPanel` (split layout, header controls, sub-tabs) to `Detail.dc.html` parity.
- [ ] In WiringSpineView: replace the 4 drawer mounts + their state (`preview`/`indexFill`/`historyEntry`/`rebind` L379-382) with a single `selectedEntry` state; wire slim rows' `onOpen`.
- [ ] Wire the whole spine as the left column + panel right when an entry is selected.
- [ ] Typecheck, vitest, browser render, parity diff (header, sub-tabs, slot card, inline rebind editor). Commit.

### Task 5: Surface tab (promote roster)

**Files:**

- Create: `src/app/wiring/SurfaceTab.tsx`
- Modify: `src/app/wiring/WiringMap.tsx` (Surface tab renders `SurfaceTab`), retire `SurfaceRoster` Drawer usage (keep helpers `commandLine`/`effectLine`/`SurfaceDelta`)
- Test: `src/app/wiring/__tests__/SurfaceTab.test.tsx`

**Parity target:** `Surface.dc.html` (2-col grid, filter bar, staged-changes footer).

**Interfaces:**

- `SurfaceTab` props: `{ pack: string }` — fetches `useSurface(pack)` itself and `useSkillsApply(pack).surfaceApply`.
- Reuse the staged-state pattern from `SurfaceRoster` (Map<name,'public'|'internal'>, `delta` memo, toggle vs baseline). Render rows in a 2-col grid (`grid-template-columns: repeat(2, minmax(0,1fr))`), a filter bar (All/Public/Internal/Fill/Compiled chips + text filter), and a footer bar with `commandLine` preview + Discard/Apply.

**Steps:**

- [ ] Failing test: SurfaceTab renders public rows as on, toggling a row stages a change and the footer shows the `rt skills surface set` preview + change count; Discard clears.
- [ ] Implement to `Surface.dc.html` parity (row height, switch size, badge colors `fill`→cyan/`compiled`→purple, footer).
- [ ] Wire Apply → `surfaceApply.mutate(delta)`; disabled while `applying`; show `applyError`.
- [ ] Typecheck, vitest, browser render, parity diff. Commit.

### Task 6: Health tab

**Files:**

- Modify: `src/app/wiring/HealthTab.tsx` (replace Task 1 placeholder)
- Test: `src/app/wiring/__tests__/HealthTab.test.tsx`

**Parity target:** `Health.dc.html` (stat cards + grouped issue lists).

**Interfaces:**

- `HealthTab` props: `{ pack: string; onOpenSkill?: (verb: string) => void }`. Fetches `useSkillsCheck(pack)` + `useCompositionSnapshot(pack)` (for refs/unwired). Derive groups from `SkillsCheck.verbs[].status` (`in-sync`/`stale`/`never-compiled`) + `staleFiles`, and unwired from `buildSpine(...).outside.filter(e => e.unwired)`.
- Four stat cards (In sync / Source newer / Never compiled / Unwired) with counts; then grouped lists (Recompile needed / Never compiled / Unwired), each row → detail (via `onOpenSkill`).

**Steps:**

- [ ] Failing test: HealthTab renders the 4 stat cards with counts and a "Recompile needed" group listing stale verbs.
- [ ] Implement to `Health.dc.html` parity (stat card number sizes, dot colors, group head, row layout).
- [ ] Wire rows to open the detail panel (switch to Pipeline tab + select the entry, or open panel directly).
- [ ] Typecheck, vitest, browser render, parity diff. Commit.

### Task 7: Cleanup + final parity + full browser QA

**Files:**

- Modify: remove now-dead code (`CompileDrawer` wrapper if fully superseded, `SurfaceRoster` Drawer, unused drawer state/imports); `SpineSummary` if replaced.
- Test: full `bunx vitest run` on `src/app/wiring/**`.

**Steps:**

- [ ] Grep for orphaned imports/exports and dead drawer components; remove.
- [ ] Full wiring test suite green.
- [ ] `bun run typecheck` + `bun run lint` clean.
- [ ] Full-page browser QA of all four surfaces; parity diff pass on each against its artboard; no console errors.
- [ ] Add a parity contract test (`src/app/wiring/__tests__/wiring-parity.test.tsx`) asserting the key surfaces use theme tokens (e.g. summary strip padding = spacing token, card radius = `xl`), mirroring `theme-contract.test.ts`.
- [ ] Commit.

## Self-Review

- Spec coverage: Pipeline (T2/T3), Surface (T5), Health (T6), detail panel replacing 5 drawers (T4), tabs (T1), cleanup+parity (T7). All four artboards mapped.
- Type consistency: `SpineEntry`, `SlotOutlineNode`, `BindingSite`, `SkillsComposition`, `SurfaceDelta`, `PageShellTab`, `useSchemeColors` shape — all from the interface reference, used consistently.
- No placeholders: each task has real interfaces + steps + parity target.
