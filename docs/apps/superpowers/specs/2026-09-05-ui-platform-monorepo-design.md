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
| Canonical values | mantine-tokyo's existing repair is the model AND the numbers (SORI-36): a fill/text split per intent, with `--tk-muted-text` #565d80 and `--tk-accent-text` #1c5fbf as shipped, plus one new red text token #c8214f. Fills stay untouched. Board's :root overrides are NOT copied (MANKIT-2 forbids it); board deletes them on conformance. |
| Versioning | Lockstep for the four published packages: one platform version per release. |
| Consumers | board, deck, chat, console, boxscore keep consuming from npm unchanged; they pick up the first lockstep release as a normal bump. |

## The tokens package (`packages/tokens`, internal)

One dependency-free workspace package:

- `src/values.ts`: primitives (ramps, type scale, spacing, radii, fonts)
  and the semantic layer, as literal data with day/night per token.
  Seeded from mantine-tokyo's shipped values, which already carry the AA
  repair as a fill/text split (`--tk-muted-text`, `--tk-accent-text`);
  the one addition is a red text token (#c8214f, SORI-36). The semantic
  layer keeps that split: a fill token and a text token per intent,
  never one token darkened for both jobs. tui-kit's raw light text
  tokens conform to these on the first generated release; board's
  :root overrides then delete rather than upstream (MANKIT-2).
- `src/fragments/`: base-rule CSS rendered from the values, each block
  wrapped in `BEGIN`/`END` markers: body ground (background from the
  semantic bg token, font stack from font tokens, the two smoothing
  declarations per SORI-34/MANKIT-2), scheme wiring.
- `assets/jetbrains-mono.woff2`: the source copy of the font both kits
  currently vendor byte-identically. Both published kits still need the
  binary physically inside their shipped files (tokyo is source-shipped
  and its CSS references `./fonts/`; tui-kit ships `assets/`), so each
  kit's build copies it from tokens into its shipped location, and a
  byte-identity gate holds the copies to the source. The hand-synced
  duplication becomes generated duplication with a gate, not a deleted
  file.
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
2. **Consumption check**: every exported token name is consumed
   somewhere in each kit's shipped CSS surfaces (recipe CSS modules and
   canvas.css for tui-kit, not just the generated theme; the full
   stylesheet chain for tokyo) or explicitly waived per kit.
   `--font-sans` was defined in generated CSS and dead because no
   recipe consumed it, so the check must look where consumption
   happens, not where definition does.
3. **Generated-output diff gates** in both kits, as above.

## Alternatives rejected (MAT-413's open questions, closed)

- **Runtime var-layering** (kits emit `var(--tokyo-*)` so palette
  changes skip kit republishes): reintroduces a published fourth
  package into the version graph (the publish cost MAT-413 flagged),
  and breaks the two things that make verification cheap: deck's
  build-time reads of literal `tuiTheme.tokens.colors` and tui-kit's
  literal theme-object assertions. Cost 6 argues for literals; this
  resolves it in the wrong direction.
- **soribashi as the token engine**: tokyo cannot consume soribashi,
  and cost 6 wants one shared shape both kits can read. Tokens stays
  plain literal TS data; soribashi remains tui-kit's projection engine,
  consuming that data.
- **A style-dictionary-class pipeline**: machinery without payoff at
  this scale; the render step is a small TS file.
- **A cross-repo sync-check tool without co-location**: needs both
  working trees and lives cleanly in neither repo's CI; the monorepo
  makes the same checks ordinary tests.

## Migration

1. `git subtree add` tui-kit into `packages/tui-kit` (history
   preserved); wire it into the workspace, CI runs its build, gates and
   tests alongside the existing jobs. Its restricted npm publish
   continues from here.
2. Bring up `packages/tokens`: values seeded from mantine-tokyo (plus
   the red text token), fragments from the rules every consumer copied
   on 2026-09-03, invariant tests.
3. Rewire tui-kit's theme.ts and tokyo's generation onto tokens; add
   the marker-sync, consumption, and font byte-identity gates. tui-kit's
   light text tokens conform to the tokens values in this step, which
   ships in the same release as the smoothing fragments; SORI-36's
   ordering constraint (smoothing before or with any text darkening) is
   satisfied by construction.
4. First lockstep release of the four packages.
5. Consumer cleanup bumps: board deletes its :root override block; the
   four local smoothing copies go (console's index.html inline block
   `ed4b81c`, chat's type-scale.css `7c531fa`, board `273fcaf`, deck
   `e18a4b7`, per MANKIT-2/SORI-34); normal version bumps otherwise.
6. Close out SORI-34, SORI-35, SORI-36, MANKIT-2, MAT-412, MAT-413,
   MANKIT-1 as shipped or superseded by this spec.

## Risks

| Risk | Handling |
|---|---|
| tui-kit's build (tsc + soribashi codegen + workshop workspace) misbehaves inside the workspace | Step 1 lands alone and CI must be green before anything depends on the move. |
| Generated tokyo-theme.css diverges from today's shipped values | Generation is introduced value-identical first (a test asserts the generated file matches the current file), then board's corrections land as an explicit value change. |
| Lockstep bumps consumers did not ask for | Harmless version churn on unchanged packages (`packages/server` in particular will ride releases carrying only token changes); consumers bump one aligned set instead of four numbers. |
| Capture suites cannot verify the smoothing fragment | Headless Chromium already renders greyscale, so board's pixel baselines reported the 09-03 smoothing change as a no-op (MANKIT-2). The fragment's presence is gated byte-for-byte; its visual effect is checked by eye in a real browser once per release. |
| Fragment append breaks a consumer that styled around the old gap | The fragments are exactly the rules every consumer already carries locally; cleanup deletes copies rather than changing behavior. |

## Out of scope (recorded, not designed here)

- Folding chat/console/boxscore into the workspace (possible later
  phase; nothing in this design blocks it).
- Migrating board/deck onto app-kit/Mantine, and any rail or app
  consolidation.
- rt-client/glance bump automation (`>=` floors, an rt estate-bump
  verb): separate follow-up.
