# UI platform monorepo: kits + a shared tokens package

Date: 2026-09-05. Status: approved direction, spec under review.
Supersedes the exploration in MAT-413 (and its duplicates MAT-412,
MANKIT-1); absorbs SORI-34, SORI-36, MANKIT-2.

## Problem

The mattstack brand lives in three hand-synced places: `mantine-tokyo`
(ramps.ts + tokyo-theme.css), `tui-kit/src/theme.ts` (soribashi codegen),
and board's `:root` overrides carrying AA-corrected values the kit never
shipped. The 2026-09-03 theme pass required five commits across four
repos for one design change, and MAT-413 documents six distinct costs of
the manual sync, including silent value drift and a defined-but-unconsumed
`--font-sans`.

Separately, base rules like font smoothing (SORI-34 / MANKIT-2) had no
shared home, so every consumer hand-copied them.

## Decision summary

| Question | Decision |
|---|---|
| Repo shape | One monorepo: the existing `m4ttstack/app-kit` workspace absorbs tui-kit and gains a tokens package. |
| Members | `packages/ui` (app-kit), `packages/server`, `packages/tokyo` (mantine-tokyo), `packages/tui-kit`, `packages/tokens` (new). |
| What stays out | rt-client and settings-kit (atomic with the rt daemon), glance (own domain), all five apps (chat, console, boxscore, board, deck). Nothing is rewritten. |
| Tokens model | Literal TS data: primitives AND the semantic layer (bg/panel/card/chrome, text, accent, status), day and night. |
| Base rules | The tokens package also renders CSS fragments (body ground, font smoothing, scheme wiring) that both kits compose into their shipped stylesheets. |
| Tokens publishing | Workspace-internal, never published. Kits bake values and fragments at build; consumers only ever see the kits. |
| Canonical values | Board's AA-corrected overrides (style.css :root block, status-dot trio) are upstreamed as the source values (SORI-36). |
| Versioning | Lockstep for the four published packages: one platform version per release. |
| Consumers | board, deck, chat, console, boxscore keep consuming from npm unchanged; they pick up the first lockstep release as a normal bump. |

## The tokens package (`packages/tokens`, internal)

One dependency-free workspace package:

- `src/values.ts`: primitives (ramps, type scale, spacing, radii, fonts)
  and the semantic layer, as literal data with day/night per token.
  Seeded from board's current values, since those are the AA-corrected
  truth (SORI-36's tables).
- `src/fragments/`: base-rule CSS rendered from the values, each block
  wrapped in `BEGIN`/`END` markers: body ground (background from the
  semantic bg token, font stack from font tokens, the two smoothing
  declarations per SORI-34/MANKIT-2), scheme wiring.
- `assets/jetbrains-mono.woff2`: the single copy of the font both kits
  currently vendor byte-identically.
- Tests (the invariants MAT-413 asked for):
  - Surface ladder: luminance strictly ordered per scheme
    (chrome/bg/panel/card in their intended order).
  - AA floors: every text token clears its contrast bar against the four
    surfaces consumers actually paint.
  - Fragment rendering is deterministic.

## How each kit derives from it

- **tui-kit**: `src/theme.ts` imports values from `@mattstack/tokens`
  instead of holding hexes. The codegen post-step (the existing
  `append-font-faces.ts` slot) appends the rendered fragments into the
  generated `theme.css`. Fragments go in `theme.css`, not `canvas.css`,
  because theme.css is the export every consumer loads (SORI-35's
  finding). The existing `gates` script (codegen + `git diff
  --exit-code src/generated/theme.css`) already fails CI on a stale
  regeneration.
- **mantine-tokyo**: `ramps.ts` values and `tokyo-theme.css` become
  generated from the tokens data, with the same diff-gate pattern.
  `styles.css` in app-kit already pulls tokyo-theme.css, so every
  Mantine app inherits the fragments with no consumer change.
- Both kits keep their own idioms and surfaces. Consumer opt-outs
  (deck's mono columns, board's deliberate mono pins) are untouched:
  the kits project tokens, apps still choose where to apply them.

## Cross-kit gates (the drift detectors)

All run in the one CI, which is what the monorepo buys:

1. **Marker-sync**: each kit's shipped stylesheet contains the tokens
   package's current fragment blocks byte-for-byte, asserted with the
   `expectLoadingBarInSync` extraction pattern already in app-kit's
   test-utils (extract between markers from the source at test time; no
   constant to drift).
2. **Consumption check**: every exported token name is consumed in each
   kit's generated CSS or explicitly waived per kit, so a
   defined-but-dead token (the `--font-sans` failure class) is a red
   build.
3. **Generated-output diff gates** in both kits, as above.

## Migration

1. `git subtree add` tui-kit into `packages/tui-kit` (history
   preserved); wire it into the workspace, CI runs its build, gates and
   tests alongside the existing jobs. Its restricted npm publish
   continues from here.
2. Bring up `packages/tokens`: values seeded from board's overrides,
   fragments from the rules every consumer copied on 2026-09-03,
   invariant tests.
3. Rewire tui-kit's theme.ts and tokyo's generation onto tokens; add
   the marker-sync and consumption gates; delete the duplicate woff2.
4. First lockstep release of the four packages.
5. Consumer cleanup bumps: board deletes its :root overrides and local
   smoothing rules; deck and the Mantine apps delete their local
   smoothing copies; normal version bumps otherwise.
6. Close out SORI-34, SORI-35, SORI-36, MANKIT-2, MAT-412, MAT-413,
   MANKIT-1 as shipped or superseded by this spec.

## Risks

| Risk | Handling |
|---|---|
| tui-kit's build (tsc + soribashi codegen + workshop workspace) misbehaves inside the workspace | Step 1 lands alone and CI must be green before anything depends on the move. |
| Generated tokyo-theme.css diverges from today's shipped values | Generation is introduced value-identical first (a test asserts the generated file matches the current file), then board's corrections land as an explicit value change. |
| Lockstep bumps consumers did not ask for | Harmless version churn on unchanged packages; consumers bump one aligned set instead of four numbers. |
| Fragment append breaks a consumer that styled around the old gap | The fragments are exactly the rules every consumer already carries locally; cleanup deletes copies rather than changing behavior. |

## Out of scope (recorded, not designed here)

- Folding chat/console/boxscore into the workspace (possible later
  phase; nothing in this design blocks it).
- Migrating board/deck onto app-kit/Mantine, and any rail or app
  consolidation.
- rt-client/glance bump automation (`>=` floors, an rt estate-bump
  verb): separate follow-up.
