# Deck → tui-kit Migration Design

**Date:** 2026-08-20
**Repos:** `~/Documents/GitHub/local-apps` (deck) and `~/Documents/GitHub/tui-kit` (the kit)
**Status:** approved design, pending plan

## 1. Overview

Rebuild deck's web UI — the board and the gateway interstitial pages — as React
applications on `@mattstack/tui-kit`, making deck the kit's third consumer
(after mr-board; gitq queued). The current board is a single Alpine.js page
styled by vendored Oat CSS; the rewrite replaces its rendering layer wholesale
while leaving the server, the `/api/v1/*` contract, and all edge/registry/service
logic untouched.

This is a **restyle and rebuild, not a pixel-parity migration**: deck's
appearance changes to the Tokyo look. Parity is defined at the behavior layer
(API contract, accessibility semantics, user-visible flows), not the pixel
layer. Fresh visual baselines are taken after the rewrite and become the
going-forward gate.

One spec, one plan, two repos. The plan runs in two acts:

- **Act 1** — grow tui-kit: eight new recipes plus Icon glyph additions,
  each landing with the kit's standard shape (recipe + theme contribution +
  workshop demo + soribashi visual coverage).
- **Act 2** — rebuild deck consuming Act 1: React board client, React-authored
  gateway pages, new test harnesses, vendor deletions.

Kit API problems discovered during Act 2 are fixed as tasks in the same plan —
that feedback loop is why the acts share a plan.

### Goals

- Deck board and gateway pages rendered by React + tui-kit, Tokyo look,
  following the system color scheme (Day light / Night dark).
- Eight new kit recipes proven by a real consumer, available to gitq next.
- Alpine, Oat, and vendored lucide deleted from deck.
- Both deck boot paths preserved unchanged: checkout `bun run src/main.ts serve`
  and the compiled `dist/deck` binary.
- Deck gains a fixture-server mode, Playwright DOM tests, and a pixel-capture
  harness (mr-board's pattern).

### Non-goals

- No server/API changes. `src/api/*`, `src/edge/*`, `src/registry/*`,
  `src/services/*`, `src/cli/*` are out of scope except where they serve UI
  assets.
- No pixel parity with the Oat board. No preservation of Oat markup
  conventions or the string-assertion tests that guard them.
- No new board features. Every current flow is rebuilt 1:1; nothing is added.
- No kit vocabulary extensions. New recipes express themselves in the existing
  `tuiVocabulary` (`size` xs–xl, `intent` accent/ok/warn/bad/cyan/purple/muted,
  `variant` outline/subtle/ghost). A recipe that cannot is a design defect to
  resolve in review, not a license to grow the vocabulary silently.

## 2. Repos, dependency, and constraints

- `local-apps` adds `"@mattstack/tui-kit": "file:../tui-kit"` plus `react` /
  `react-dom` pinned to exact versions and `@types/react` / `@types/react-dom`
  devDeps — the mr-board consumption pattern. `@soribashi/core` is **never** a
  direct dependency of local-apps: `SoribashiProvider` and `registerTheme` come
  from `@mattstack/tui-kit/provider` (see mr-board's `package.json`
  `//soribashi` note for why — a second resolved copy of the factory silently
  breaks theming).
- Every client bundle is built with a **react-singleton `onResolve` plugin**
  (reference: mr-board `src/server.ts`) pinning `react`, `react-dom`, and their
  subpaths to local-apps' copies. The file: kit dependency is realpath'd by
  bundlers; without the plugin the bundle carries two Reacts and two soribashi
  contexts.
- Deck's binary embeds all assets via static imports in `core/board-assets.ts`
  (`with { type: "text" | "file" }`), because `readFileSync(import.meta.dir…)`
  dies under `bun build --compile`. The rewrite keeps this mechanism: built
  client artifacts are **committed to the repo** (the existing pattern —
  `core/vendor/lucide.min.js` is a committed build product of `build:icons`)
  and statically imported.
- Both repos are private; the file: dependency never leaves Matt's machine, and
  the public installer ships the compiled binary with everything embedded.
- The clean-code comments rule (`~/.claude/rules/clean-code-comments.md`) binds
  all generated code in both repos.

## 3. Act 1 — tui-kit expansion

Eight new recipes and one extension, requirements sourced from the deck UI
inventory. Each recipe follows the kit's established conventions (soribashi
authoring skill: builders, `PARTS` export, `<name>Theme` export, alias
contract, workshop demo, vitest-browser visual baselines). APIs below name the
props deck needs; recipes may not grow speculative props beyond them (YAGNI —
gitq's needs are a future cycle's problem).

### 3.1 Button

The workhorse control. Deck usages: text buttons with leading icons
("add app", "reload proxy"), icon-only buttons (restart, edit, remove, revert,
stderr, access), a bare-text port button, danger-toned remove, disabled-while-
busy states, and a busy button with spinner + swapped label ("restarting…").

Props:
- `variant`: `outline` (default) | `subtle` | `ghost` — kit vocabulary.
- `intent`: `accent` (default) | `bad` for destructive (remove).
- `size`: `sm` (deck uses small throughout) | `md` (default; gateway login).
- `busy`: boolean — renders an embedded Spinner, disables the button,
  `aria-busy="true"`.
- `disabled`, `type`, standard button attributes pass through.
- `iconOnly`: boolean — square padding box; **requires** `aria-label`
  (dev-mode warning when missing, same enforcement style as existing recipe
  invariants).
- Children compose icon + text freely (`<Button><Icon name="plus"/> add
  app</Button>`).

### 3.2 Badge

Filled status pill — deliberately louder than Chip, which stays the quiet
micro-label. Deck usages: health status (`200 34ms` success / `unreachable`
danger), `running` / `stopped` / `unmanaged`, preflight results with icon +
message, `restarting…` with embedded spinner, tunnel `up` / `down`.

Props:
- `intent`: `ok` | `warn` | `bad` | `muted` (default `muted`).
- Children compose icon/spinner + text.
- `title` passes through (health badges carry `HTTP <status>` tooltips).

### 3.3 Spinner

Inline busy indicator. Standalone usages: restarting badges. Embedded: Button
`busy`. Props: `size` (`xs` | `sm`, default `sm`). Renders with
`aria-hidden="true"`; the busy *context* (button, badge) owns the accessible
state via `aria-busy`.

### 3.4 Switch

Controlled `role="switch"` toggle. Deck usages: publish per row, "public too"
on override rows, password gate, Google sign-in gate, "I run this myself" in
the add modal. All deck switches are controlled from server-derived state; a
failed action simply re-renders from unchanged state — the controlled model
deletes the Alpine `ev.target.checked` snap-back hack by construction.

Props:
- `checked`, `onChange` (controlled only — no uncontrolled mode).
- `label`: optional visible label rendered in the recipe's label slot;
  `aria-label` pass-through for label-less use.
- `disabled` for busy gating.

### 3.5 Field family

One recipe directory (`Field/`) exporting three components that share
field/label/error styling:

- **TextField** — visible or aria-only label, `type` (`text` | `password`),
  `inputmode`, `pattern`, `placeholder`, `required`, `error` (string | null,
  rendered with `role="alert"`), `value`/`onChange` controlled, ref forwarded
  (autofocus targets).
- **TextArea** — same field chrome; `rows`, vertical-only resize.
- **RadioGroup** — `name`, `options: { value, label }[]`, `value`/`onChange`;
  renders stacked label-per-radio rows, the access modal's layout.

### 3.6 Alert

`role="alert"` callout. Deck usages: the proxy notice banner (ok / error, with
an optional command `<pre>` block), and inline form errors in modals.

Props:
- `intent`: `ok` | `bad`.
- `command`: optional string rendered in a `<pre>` block (the proxy notice's
  one-time-setup install command).
- Children: the message.

### 3.7 Table

Structural data-table recipe: `TABLE_PARTS` for container / table / head /
header-cell / body / row / cell. Tokyo styling: header typography, row
borders, hover wash, cell padding, nowrap default for cells (deck's tables are
fact-dense). Deck-specific behaviors — the hover-revealed port controls,
absolute-positioned `devport-extra`, per-column width quirks — stay
**deck-domain CSS** layered on `[data-part]` selectors, the mr-board scoping
pattern.

Components: `Table`, `Table.Head`, `Table.Row`, `Table.Cell` (or equivalent
hand-rolled compound per the authoring skill's compound-component section).
Props stay structural: `align` (`start` | `end`) on cells; no data-model props
— children render rows.

### 3.8 ConfirmDialog

A small compound over Modal for destructive-action confirmation. Deck usage:
remove app ("Remove <name>? This deletes its service and route."), replacing
the native `confirm()`.

Props:
- `open`, `onConfirm`, `onCancel` (controlled).
- `title`, children (the message body).
- `confirmLabel` (e.g. "Remove"), `cancelLabel` (default "Cancel").
- `intent`: `bad` (default) — the confirm Button's tone.
- Initial focus lands on the cancel Button (destructive default-safe), escape
  and backdrop dismiss as cancel — Modal's existing behavior.

### 3.9 Icon glyph additions

Add deck's lucide glyphs to the kit's `ICONS` registry (verbatim lucide path
data, same mechanism as existing entries): `plus`, `external-link`,
`triangle-alert`, `circle-check`, `file-warning`, `refresh-cw`, `pencil`,
`trash-2`, `lock-keyhole`, `user-round-check`, `rotate-ccw`. Deck then drops
its vendored `lucide.min.js` and the `build:icons` script.

## 4. Act 2 — deck board rebuild

### 4.1 Client structure

New `core/board/` React app (client code lives beside the assets that embed
it):

- `main.tsx` — entry: mounts `<SoribashiProvider theme={tuiTheme}>`, imports
  kit `theme.css` + recipe CSS, installs the scheme watcher (§6).
- `useBoardState.ts` — the ported `board.js` logic, one hook: 5s status
  polling (suspended while a port edit is in flight), `restarting` map with
  the pid-change + timeout reconcile, notice/auto-banner state with
  `proxyHoldUntil`, `waitForProxy`, and every action
  (restart/publish/override/public-follows/password/oauth/add/edit/remove/
  proxy-reload) calling the **unchanged** `/api/v1/*` endpoints. Ported 1:1
  including the deliberate quirks: swallow-and-repoll on self-restart,
  refresh-regardless after public-follows, verbatim API error surfacing.
- `Board.tsx` — page shell: header (title, reload-proxy Button, add-app
  Button), subline, proxy-notice Alert, sections.
- `AppsTable.tsx` + cell components (`SiteCell`, `PortCell`, `HealthCell`,
  `LaunchdCell`, `PublishCell`, `AccessCell`, `ActionsCell`) — the apps and
  strays sections share the row template, as today.
- `TunnelSection.tsx` — the cloudflare tunnel table.
- `AddAppModal.tsx`, `EditAppModal.tsx`, `AccessModal.tsx` — kit Modal +
  Field family + Switch + Button; the stderr viewer is a kit Modal wrapping a
  `<pre>`.
- Remove confirmation uses the kit ConfirmDialog (§3.8) with the current
  message text verbatim; the confirm action fires the same DELETE flow.

Accessibility semantics carry over verbatim: every `aria-label`, `title`,
`role="switch"`, `role="alert"`, and the `accessSummary` sentence survive the
rewrite — they are asserted by the new DOM tests (§7.2).

### 4.2 Build pipeline and serving

- `scripts/build-board.ts` — Bun.build: entry `core/board/main.tsx`, browser
  target, minified, react-singleton plugin, CSS collected. Emits committed
  artifacts `core/generated/board.js` and `core/generated/board.css`.
- `package.json` gains `"build:board": "bun run scripts/build-board.ts"`;
  `build` (the binary compile) depends on nothing new — the committed
  artifacts are already in the tree.
- `core/board-assets.ts` slims to: `board.html` shell (title, css link, root
  div, one script tag), `board.js` + `board.css` from `core/generated/` via
  static imports, and the vendor map **deleted** along with
  `core/vendor/oat.min.css`, `oat.min.js`, `alpine.min.js`, `lucide.min.js`,
  `core/icons.js`, and `build:icons`.
- Server routes: `/board.js` and `/board.css` served from the embedded
  artifacts; `/vendor/*` routes removed.
- The `<noscript>` fallback line stays in the shell.

### 4.3 Staleness gate

A `bun test` case rebuilds the bundle in-memory (same Bun.build config,
byte-equality comparison against `core/generated/`) and
fails when a source edit was not followed by `build:board`. This is the
committed-artifact freshness guard; without it the binary silently ships an
old board.

## 5. Gateway pages

`core/gateway-pages.ts` becomes `core/gateway-pages.tsx`: the card, lock
badge, and login form become React components rendered **per-request** with
`renderToStaticMarkup` (react-dom/server is available in the deck binary).
Zero client JavaScript ships on these pages — they are failure-path surfaces
and must render with nothing else working. The login form stays a plain POST
to `/__auth`.

Styling: a generated Tokyo CSS block inlined into each page's `<head>`. A
small build-time script (part of `build:board` or a sibling) derives the
custom-property set from `tuiTheme` tokens — Day values under `:root`, Night
values under `@media (prefers-color-scheme: dark)` — so the pages follow the
system scheme with **zero JS** and cannot drift from the kit's palette (the
values are read from `tuiTheme`, not hand-copied). The four pages
(`pageNothingHere`, `pageOffline`, `pageRateLimited`, `pageLogin`) keep their
exact signatures and escaping behavior; existing gateway tests keep passing,
updated only where they assert the current bespoke markup or CSS.

## 6. Theming and scheme switching

- The kit emits Tokyo Day tokens at `:root` and Tokyo Night overrides under
  `.dark` (soribashi `darkMode: { selector: ".dark" }`).
- The board follows the system: `main.tsx` installs a
  `matchMedia("(prefers-color-scheme: dark)")` watcher toggling `.dark` on
  `document.documentElement`; the initial state is applied in `main.tsx`
  before the root renders (the root div is empty until then, so no flash of
  wrong scheme).
- Gateway pages switch via the generated `@media` CSS (§5) — no class, no JS.
- No manual theme toggle UI this cycle.

## 7. Testing

### 7.1 Kit (Act 1)

Each new recipe lands with workshop demos and vitest-browser visual baselines
in the kit's existing rig (node + browser tiers, CSS gates). The Linux
baseline discipline from SORI-1/2 applies as it stands on tui-kit main.

### 7.2 Deck (Act 2)

- **Fixture mode**: `DECK_FIXTURE=<path>` starts the server serving a canned
  `/api/v1/status` JSON body (and inert action endpoints returning
  deterministic responses) instead of touching launchd — mr-board's
  `BOARD_FIXTURE` pattern. Fixtures cover: mixed healthy/unhealthy apps, an
  override row, preflight issues, strays, tunnel rows, unmanaged service,
  `canManage` on and off.
- **Playwright DOM tests** replace `board-assets.test.ts`'s Oat/Alpine string
  assertions. The semantic assertions carry over as DOM queries: switch roles
  and their aria-labels, the access summary sentence, alert roles, dialog
  behavior, port-edit keyboard flow (enter submits, escape cancels, blur
  cancels), icon-only buttons all carrying `aria-label`.
- **Capture harness**: Playwright + pixelmatch at threshold 0, fresh
  baselines taken at the end of the rewrite. Day scenarios: default board,
  empty board, override row with hover extras revealed, preflight-issue row,
  strays + tunnel sections, add modal (both switch positions), edit modal,
  access modal (password on, oauth emails mode), stderr modal, proxy notice
  ok and error. Night repeats: default board, access modal, proxy notice
  error. `bun run capture` /
  `capture:compare` scripts, mirroring mr-board.
- **Unchanged**: `test:e2e` (`test/e2e.smoke.test.ts`) is pure API-level and
  must pass without modification — it is the behavior-parity backstop. All
  existing server-side tests (287 passing today) must stay green; only
  `board-assets.test.ts` and gateway-page markup assertions may change, and
  each such change must map to a retired Oat/Alpine-era assertion.
- **Staleness gate** per §4.3.

## 8. Parity contract

Preserved exactly:
- Every `/api/v1/*` request the UI makes: method, path, payload shape, error
  surfacing (API messages shown verbatim).
- Every user flow: add (service/external), edit, remove (with confirmation,
  now a ConfirmDialog — same message, same DELETE on confirm), port
  override lifecycle (edit/revert/public-follows), publish, password gate
  set/change/remove, oauth gate on/off/mode/apply, restart with spinner
  reconcile, proxy reload with wait-and-report, auto-heal banner logic.
- All accessibility semantics named in §4.1.
- The 5s refresh cadence, 30s restart timeout, 45s proxy wait, 2min heal
  window.

Accepted changes (by design):
- Entire visual appearance (Oat → Tokyo).
- DOM structure and class/attribute vocabulary (`[data-part]`-based now).
- `board-assets.test.ts` string assertions retired in favor of §7.2.
- Bundle size: the board page grows by roughly React + kit weight (~150KB
  min+gz); irrelevant for a localhost tool.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Dual React / dual soribashi context via file: kit realpath | Singleton onResolve plugin in `build-board.ts` from day one; bundle-content test asserting one copy of `provider/context` |
| Committed `core/generated/` going stale | §4.3 staleness test in `bun test` |
| Kit APIs missing something deck needs mid-Act-2 | Same-plan fix tasks; the combined plan exists for this |
| Scheme flash on load | `.dark` applied pre-mount; capture harness includes a Night scenario that would catch a wrong-scheme first paint |
| Gateway pages regressing their zero-dependency property | No client JS by construction (`renderToStaticMarkup`); a test asserts the rendered pages contain no `<script>` |
| Comment-density regression (SDD decision-record noise) | clean-code-comments rule passed through every dispatch; reviewers treat violations as findings |
