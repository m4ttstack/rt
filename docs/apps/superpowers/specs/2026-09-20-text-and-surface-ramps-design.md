# Text and surface ramps

**Goal:** one surface ramp, one text ramp, one type ramp and one palette that
a reader (human or model) can pick from without judgment, where the wrong
pick is either impossible or loud.

**Status:** design, approved. Values settled in `~/Documents/mattstack
colors.pen`. Implementation sequenced in §9.

**Supersedes:** the first draft of this file, which carried two claims the
math later disproved. Both are corrected here and called out in §10.

## 1. What went wrong, with evidence

The review sheet shipped with `var(--muted)` as the text colour on eleven
rules. `--muted` (`#8990b3`) is a fill token measuring 2.85:1 against the
worst light surface; it fails AA for body text. `--muted-text` (`#565d80`)
is the token that belongs there.

Nothing failed. The rule existed only as prose in a test comment:

> only the explicit `--muted-text` alias carries the AA-compliant value, for
> text-role `color:` declarations

A comment cannot fail a build, and the token a writer reaches for first is
the wrong one.

A measured audit of the rendered sheet then found three more below their bar
(`mr-open` 3.03, `all · none` 3.13, the Important tier pill 4.01) and zero in
dark. The measurement took one pass. The judgment pass had already run twice
and was confident both times.

### 1.1 The size trap

Chat looked bad while passing. Its dim text measures 4.95:1, above the 4.5
bar. The board's root is 17px (`html { font-size: 17px }` in its
`style.css`; tui-kit's canvas and tokyo's body are 13.5px literals with no
root override), body renders at 14.45px there, and chat's secondary text
lands at 10.5-12px.

WCAG 1.4.3 has no small-text provision: 4.5:1 is its bar at every size below
"large" (about 24px, or 18.7px bold). The 5.5 and 7.0 bars in §6 are this
platform's own requirement, chosen because 4.5 measured as illegible at
10.5-12px on these fonts.

**A ramp certified only against AA reproduces chat.** Contrast has to be
coupled to size, not just to surface.

## 2. What already exists

Do not reinvent these.

| Layer | Has | Quality |
| --- | --- | --- |
| `packages/tokyo` | ten-shade Mantine tuples per hue (`ramps.ts`) | hand-generated; the re-anchoring procedure is documented in its header comment and is what MAT-421 automates |
| `packages/ui` (app-kit) | `--ui-bg-1..4`, a `--ui-base-*` / `--ui-*` two-layer remap, `.ui-base-surfaces` restore, `mountMattstackApp` | the right model |
| `packages/tui-kit` | `--type-display/title/body/meta/small/micro` | ordered type scale worth keeping |
| `packages/tokens` | `invariants.test.ts` luminance ordering | the right kind of test, wrong coverage |
| `packages/tui-kit` | `Button.matrix.test.tsx` + `known-contrast-debt.ts` | a working contrast gate with a ratchet |
| `@soribashi/core/testing` | `parseColor`, `relativeLuminance`, `contrastRatio`, `compositeOver`, `resolveCanvasColor` | the measurement helpers every gate and story here should import rather than rewrite; they already handle §9.1 |

`packages/tokyo/src/tokyo-theme.css` remaps app-kit's live slots onto
tui-kit's tokens (`--ui-bg-1: var(--tk-bg)`), which is why every app
ultimately reads from `packages/tokens`. Tokyo is the single bridge, so one
ramp change propagates everywhere.

That remap is also why `--ui-text-muted` and `--ui-text-dimmed` are the same
colour: both point at `--tk-muted-text`. Two names, one value.

Soribashi's codegen already emits three tiers: raw `--color-<group>-<key>`
and semantic `--surface-<role>` / `--text-<role>` / `--border-<role>` from
`values.ts`, plus the short aliases (`--card`, `--fg`, `--border`) that
components write, authored in `packages/tui-kit/soribashi.config.ts`. The
new ramps slot into that emission; they do not add a fourth tier.

## 3. Surfaces

**The rule: `surface-1` is the background with the highest contrast against
the default text, and each step after it has less.**

Scheme-independent and checkable by sorting. The number tells you your
headroom: `surface-1` is always the safest ground for text, `surface-4`
always the tightest. The columns mirror because the rule is about contrast,
not lightness.

| | light | vs text | dark | vs text | role |
| --- | --- | --- | --- | --- | --- |
| `surface-1` | `#ffffff` | 15.91 | `#101016` | 15.37 | light: sheets, cards. dark: insets |
| `surface-2` | `#fbfbfc` | 15.38 | `#16161e` | 14.58 | light: panels, overlays. dark: the page, overlays |
| `surface-3` | `#f7f8fa` | 14.97 | `#1a1c28` | 13.72 | light: the page, insets. dark: panels, chrome |
| `surface-4` | `#f3f4f7` | 14.47 | `#1e2030` | 13.05 | light: rows, chrome. dark: sheets, cards |

Roles land on different numbers per scheme by design. Components never name
a number; see §4.

Seven of the eight values ship today; dark `surface-1` is new. Two dark
values that ship today are off the ramp and snap onto it: `inset` and
`overlay` are both `#181a24` now, between `surface-2` and `surface-3`.
`inset` moves to `surface-1` (`#101016`) and `overlay` to `surface-2`
(`#16161e`). Both moves keep `invariants.test.ts` true (inset darker than
card, overlay no lighter than panel) and both are darker than today, which
is the direction every dark retune in this program has taken. The visible
change is two elements on the board: the gate key background
(`--gate-key-bg`) and the review modal ground (`--gate-modal-ground`).
Nothing else repaints.

## 4. Two layers

The ramp is declared once per scheme and **never referenced by a
component**. A semantic layer sits on top, pointing at ramp steps, and its
mapping is free to differ per scheme.

```css
/* illustrative; see the emission note below */
:root {
  --surface-1: #ffffff;  --surface-2: #fbfbfc;
  --surface-3: #f7f8fa;  --surface-4: #f3f4f7;

  --card: var(--surface-1);     --panel:   var(--surface-2);
  --page: var(--surface-3);     --chrome:  var(--surface-4);
  --inset: var(--surface-3);    --overlay: var(--surface-2);
}
:root.dark {
  --surface-1: #101016;  --surface-2: #16161e;
  --surface-3: #1a1c28;  --surface-4: #1e2030;

  --card: var(--surface-4);     --panel:   var(--surface-3);
  --page: var(--surface-2);     --chrome:  var(--surface-3);
  --inset: var(--surface-1);    --overlay: var(--surface-2);
}
```

Six semantic surfaces, declared in both schemes: `card`, `panel`, `page`,
`chrome`, `inset`, `overlay`. `page` is the emitted name for today's `bg`.
`chrome` and `panel` share `surface-3` in dark and differ in light; they stay
two tokens because they are two roles (a sidebar band is not a panel) that
happen to coincide in one scheme. No `well` token: `inset` is that role.

Components write `--card`. Only the tokens file writes `--surface-N`. This
is what lets the ramp be ordered by contrast while `--card` still means one
thing everywhere, and it deletes `mutedOnCard`, `edgeOnCard`,
`controlEdgeOnCard`, `softOnCard` and the whole `--gate-*` re-alias block as
concepts (§7.2 says what replaces the line variants).

**Emission.** The `:root.dark` block above is how to read the mapping, not
how it ships. tui-kit's `theme.css` emits one declaration per token with
`light-dark(light, dark)` and flips on `.dark { color-scheme: dark }`;
tokyo's `tokyo-theme.css` emits two blocks keyed on
`[data-mantine-color-scheme]`. Both come from the same `values.ts` entries,
so the ramp is written once and emitted twice.

## 5. Text

Four values. `text-1` is primary and safe at every size. The rest are one
secondary role resolved against the size band it serves: the quietest value
that still clears that band's bar.

| | light | worst | dark | worst | bar | serves |
| --- | --- | --- | --- | --- | --- | --- |
| `text-1` | `#222222` | 14.47 | `#e3e7f6` | 13.05 | none | every size |
| `text-2` | `#666e97` | 4.50 | `#7c86b3` | 4.54 | 4.5 | display, title, body |
| `text-3` | `#596084` | 5.57 | `#8d96bd` | 5.54 | 5.5 | meta |
| `text-4` | `#4b5170` | 7.05 | `#a3aac9` | 7.01 | 7.0 | small, micro |

Every value is solved against all four surfaces and carries its worst case,
so it is safe on any of them.

**Margins are near zero by design.** The solver returns the first hex that
clears the bar, so a value like `text-2` light sits at 4.5010. The two
decimals in these tables are display rounding; the gate in §9 asserts
`ratio >= bar` at full float precision using `contrastRatio` from
`@soribashi/core/testing`, and any re-solve must use the same function so
the two never disagree at the third decimal.

## 6. Type

Six steps named by role. Sizes are measured live on the board at its 17px
root; weight and line-height are targets, since `--type-*` carries size
only and the board uses `micro` at both 500 and 600 today. The bars are
conservative for any smaller root. Each step names the contrast bar any
secondary text must clear at that size. **This column is
the link the old system lacked:** nothing stopped a colour tuned for body
copy being used on 10.54px text.

| step | px | weight | line | bar |
| --- | --- | --- | --- | --- |
| `display` | 17 | 700 | 1.25 | 4.5 |
| `title` | 15.3 | 600 | 1.3 | 4.5 |
| `body` | 14.45 | 400 | 1.5 | 4.5 |
| `meta` | 13.26 | 400 | 1.45 | 5.5 |
| `small` | 11.9 | 400 | 1.4 | 7.0 |
| `micro` | 10.54 | 500 | 1.35 | 7.0 |

The 4.5 rows are WCAG AA. The 5.5 and 7.0 rows are this platform's bars
(§1.1), not a standard's.

The six semantic steps sit on 22 ad-hoc primitives (`sm/md/lg/xl`,
`px9..px13`, `rem60..rem105`, some differing by half a pixel). Collapsing
those is out of scope here but worth a follow-up.

## 7. Palette

Three values per hue. The **fill** is the hue's identity: in light it is
the locked arcade hex, unchanged from today; in dark it is solved (§7.1).
The two **text** values are solved from the fill's hue angle at the body
bar (4.5) and the small bar (7.0), against all four surfaces of their
scheme. When the fill already clears 4.5, the body value *is* the fill.

| hue | light fill (measured) / body / small | dark fill (3.0) / body / small |
| --- | --- | --- |
| accent | `#4658ff` (4.66) `#4658ff` `#0e25ff` | `#4758f4` `#6e7cf7` `#9ca5f9` |
| ok | `#00c287` (2.11) `#008059` `#005e42` | `#277860` `#319879` `#3ec098` |
| bad | `#ff3d81` (3.06) `#de004e` `#a7003b` | `#d30c52` `#f4417f` `#f888af` |
| warn | `#ff8a00` (2.15) `#aa5c00` `#7e4400` | `#955f1f` `#bd7827` `#dc9f56` |
| purple | `#9b45ff` (4.07) `#9337ff` `#6900e3` | `#8c38ef` `#a867f3` `#c498f7` |
| cyan | `#00b8d9` (2.16) `#007b91` `#005b6b` | `#00768b` `#0095b0` `#00bbdd` |

Because text always needs more contrast than a shape, the three progress in
one direction in both schemes: light gets darker, dark gets lighter.

**Tokens.** `--fill-<hue>` (the fill), `--text-<hue>` (body value, allowed
at `display`, `title`, `body`), `--text-<hue>-small` (small value, allowed
at `meta`, `small`, `micro`; 7.0 clears meta's 5.5 bar with room, so meta
does not get a third value). A fill is never a text colour, and the names
retire the `accent` versus `accentText` guesswork. In `values.ts` these are
`hue.<h>`, `hueText.<h>` and `hueTextSmall.<h>` per scheme.

**One fill, everywhere.** The fill is also the seed MAT-421 generates each
Mantine ramp from and re-anchors on the primary shade (6 in light, 4 in
dark), so a Mantine `filled` button and a tui-kit `--fill-<hue>` shape are
the same hex. `ramp-anchors.test.ts` already pins this relation
(`ramps[day][6] === TOKENS.light.hue[hue]`).

**Decision, default taken:** three light fills (`ok` 2.11, `warn` 2.15,
`cyan` 2.16) sit under the 3:1 non-text bar because their hex is locked.
Default: keep the hex, list the three in `known-contrast-debt.ts`, and
require a second cue (outline, glyph or label) wherever a light fill alone
carries meaning. The alternative is darkening those three seeds to their
3:1 solutions (`#00a170`, `#d67400`, `#009bb6`), which changes every
`ok`/`warn`/`cyan` button and badge in light across all five apps. That is
Matt's call, not the implementer's; the default holds until he makes it.

The status `dot` block in `values.ts` (`dot.ok/warn/bad`, a separate green,
amber and red already darkened past 3:1 for 6px dots) is out of scope: it
is a status palette, not the hue palette, and keeps its tokens.

### 7.1 Dark hue correction

Light was relocked to the arcade palette; dark still carries the original
Tokyo Night editor colours, so the schemes disagree on what each hue **is**.
Measured hue deltas: ok 73°, accent 13°, cyan 13°, bad 10°, purple 7°,
warn 4°. ok is teal-green by day and yellow-green by night, a different
colour, not a lightness variant.

The dark fills in §7 hold the light hue angle and are the darkest value
clearing 3:1 against all four dark surfaces, so fill, body and small
progress upward. They replace `TOKENS.dark.hue.*` (today `#7aa2f7`,
`#9ece6a`, `#f7768e`, `#e0af68`, `#bb9af7`, `#7dcfff`) and become the
Night ramp seeds. That is why MAT-421 (§9 step 1) lands before this change
(§9 step 2): changing the dark seeds by hand invalidates every hand-written
Night tuple, and the tui-kit button resolver is tuned against the old ones.

Every dark fill carries a white label at 5.3:1 and `text-1` at 4.3:1;
filled buttons in dark use a white label (§9 step 2 makes that change).

**Open, default taken:** `fill-ok` in dark (`#277860`) is deep, because 3:1
is a low bar on a near-black page. Default is to ship 3:1. If dark fills
read muted in the storybook specimen wall, raise the dark fill bar to 4:1
for all six hues and re-solve; do not hand-pick one.

### 7.2 Lines

Three steps, ordered like surfaces: `line-1` is the strongest against the
surface it sits on. Every value is one that ships today, so the mapping
below repaints nothing in light and moves two dark dividers by one step.
Light needs only two steps; its `line-3` slot is reserved rather than
invented, and is emitted carrying `line-2`'s value because a `light-dark()`
declaration needs a colour on both sides. The table grid hairline (`line.grid`,
`rgba(52,59,88,.05)` light, `rgba(122,162,247,.06)` dark) is not a border
value and keeps its own token in both schemes.

| | light | vs `#ffffff` | dark | vs card `#1e2030` | vs page `#16161e` |
| --- | --- | --- | --- | --- | --- |
| `line-1` | `#c8cad6` | 1.63 | `#6b7499` | 3.51 | 3.93 |
| `line-2` | `#d5d7e2` | 1.43 | `#505879` | 2.31 | 2.58 |
| `line-3` | unassigned | | `#3b4261` | 1.64 | 1.83 |

The semantic mapping differs per scheme, which §4 permits:

| role | light | dark, base | dark, card scope |
| --- | --- | --- | --- |
| `--border-control` | `line-1` | `line-1` | `line-1` |
| `--border` | `line-1` | `line-3` | `line-2` |
| `--border-soft` | `line-2` | `line-3` | `line-3` |

Light: `--border` and `--border-control` share `line-1` because they share
`#c8cad6` today; `--border-soft` is today's `#d5d7e2`. Dark base:
`--border` is today's `#3b4261`; `--border-soft` moves from `#313853` to
`line-3` (`#3b4261`, one step more visible). Dark card scope is where the
`edgeOnCard`, `controlEdgeOnCard` and `softOnCard` tokens live today,
because a card in dark is lighter than the page and a page-tuned line
vanishes on it. The replacement is a scope rule, not more tokens: a card
ground re-points `--border` in its own scope through the emitted
`--border-on-card` alias, which carries this table's per-scheme mapping
(`light-dark(var(--line-1), var(--line-2))`), so the rule
`.card { --border: var(--border-on-card) }` is a no-op in light and lands
today's `edgeOnCard` `#505879` exactly in dark. That is what the board's
`--gate-*` block does by hand. A literal `.card { --border: var(--line-2) }`
would also fire in light and soften light card edges; do not write it.
`controlEdgeOnCard` `#6b7499` is `line-1` exactly. `softOnCard` moves from
`#404866` to `line-3` (`#3b4261`, 1.79 to 1.64 against the card, slightly
quieter). Those two moves are the whole visible change.

Lines have no text bar. WCAG 1.4.11's 3:1 applies to a control's boundary
only when the border is the sole boundary cue; every light line here is
under it, as they are today. That is a ledgered debt for the gate, not a
change this spec makes, because a 3:1 grey on white is `#949494` and would
repaint every card edge.

## 8. Namespaces and providers

### 8.1 Namespaces

- `--text-*` ... `color:` only
- `--surface-*` ... `background*` and `fill` only; `--surface-[1-4]` only
  in the tokens file
- `--border-*` and `--line-[1-3]` ... border and outline properties only;
  `--line-[1-3]` only in the tokens file
- `--fill-*` ... dots, washes, chips, shapes; never `color:`

These are soribashi's existing emitted prefixes. `--surface-*` already
covers the semantic roles (`--surface-card`) and the washes
(`--surface-wash-*`), all of which are backgrounds, so the property rule
holds across the prefix and only the numeric ramp steps get the
tokens-file-only rule. `--line-*` is new and follows `--surface-N`.

`color: var(--fill-warn)` then reads as wrong on sight, and the lint in §9
makes it fail.

### 8.2 Providers

`mountMattstackApp` already binds the Tokyo theme into `MantineProvider`, so
Mantine apps get their tokens pre-bound. tui-kit does not: it exports
`SoribashiProvider` and `tuiTheme` separately, and every consumer must do a
two-step dance in two different scopes:

```ts
registerTheme(tuiTheme);              // module scope, for style-prop resolvers
<SoribashiProvider theme={tuiTheme}>  // context, for useTheme()
```

Getting one of the two right fails in a way that is hard to spot. tui-kit
gains a bound provider mirroring `mountMattstackApp`, doing both in one.

`packages/tokens` stays pure values plus codegen and takes no React,
Mantine or soribashi runtime dependency. It generates *into* the kits;
inverting that so the lowest package depends on the kits above it is not
worth one import site. `@mantine/colors-generator` is a devDependency of
its codegen only (§9 step 1).

## 9. Verification and sequencing

Seven steps, in the order they must land. Each lands green on its own.
The dark seed change is deliberately its own step because it is the one
that cannot be split any further.

0. **Tokens, scheme-safe part.** `values.ts` gains, per scheme:
   `surface1..4` (§3), the six semantic surface roles pointing at steps
   (§4), `text1..4` (§5), `hueText` and `hueTextSmall` (§7, dark values
   solved at the corrected hue angle even though the dark fill has not
   moved yet; their first consumer is step 2), and `line1..3` plus
   the three border roles with the per-scheme mapping (§7.2). `TOKENS.dark.hue.*` is NOT touched here. `scripts/generate.ts`
   emits the numeric ramps and the new semantic names into tui-kit's
   `tokens.ts` and tokyo's `tokyo-theme.css`. Old names are emitted as
   aliases for one release: `--fg` → `text-1`; `--muted-text` → a different step per scheme:
   `text-3` in light, the nearest (today's `#565d80` measures 5.83,
   `text-3` 5.57), and `text-4` in dark by direction rather than distance
   (today's `#969ec2` measures 6.11; `text-3` at 5.54 is the nearer step
   but dims every muted string, `text-4` at 7.01 brightens them, which is
   what every dark complaint in §1 asked for). Migration then moves light
   small and micro sites to `text-4`; `--bg` →
   `--page`; the three `*OnCard` line names → the §7.2 card-scope values
   (`--border-on-card` is `light-dark(var(--line-1), var(--line-2))`);
   `--text-muted-on-card` (`mutedOnCard`, two live board consumers) →
   `text-3` in light and `text-4` in dark by the same nearest-value
   reasoning (dark today is `#aab3d8` at 7.78; `text-4` is 7.01); `--muted` keeps its name
   and value until the step-6 audit. The card-scope rule itself is CSS,
   applied at migration in the board and in any recipe that grounds on a
   card; step 0 only ships the aliases it consumes. The
   short-alias tier is authored in `packages/tui-kit/soribashi.config.ts`
   (a `CssVariablesResolver`), not derived from `values.ts`, and soribashi
   has no `line` semantic group today, so `--line-[1-3]` and
   `--border-control` need entries there. `invariants.test.ts` gains the
   sort checks (surfaces by contrast against `text-1`, text by bar, lines
   by contrast) and one assertion per §5 text value, per §7 hue text value
   and per §7 dark fill that it clears its bar; light fills are asserted
   to equal the locked hex, not to clear a bar, because §7 keeps three of
   them under it. `packages/tokens/src/color-math.ts` uses the 0.04045 sRGB
   threshold and soribashi's `contrastRatio` uses 0.03928; they agree for
   every 8-bit channel, so the invariants keep `color-math.ts` and nobody
   "fixes" one to match the other. The tui-kit census (`test/theme.test.ts`)
   gets one ruling set for the moves this step makes. Then
   `bun run tokens:codegen`, tui-kit codegen, and
   `cd apps/deck && bun run build:board` for the vendored copies.
1. **Generated ramps (MAT-421).** Seed is `TOKENS.<scheme>.hue.<h>`, still
   today's values, so `ramp-anchors.test.ts` keeps passing and the
   generator is proven by reproducing the hand-written ramps' anchors
   before it is trusted with new seeds. Raw `@mantine/colors-generator`
   output is unusable: of the 8 seeds measured (six light hues plus two
   dark `ok` candidates), only 2 landed on the index Mantine reads as
   primary, so `filled`/`outline`/`text` would render colours nobody chose
   (`#29feb6` in place of `#00c287`). The generator lives in
   `packages/tokens/scripts` beside `generate.ts`, runs the OKLab
   re-anchoring already described in `ramps.ts`'s header, writes
   `packages/tokyo/src/ramps.ts` as a generated file (the freshness gate
   already diffs `packages/tokyo/src`), and asserts per ramp before
   writing: exact seed at the primary index, strictly monotonic luminance,
   ten entries. A failing assertion fails the build rather than emitting.
2. **Dark seeds (§7.1), one change.** `TOKENS.dark.hue.*` becomes the §7
   dark fills; the step-1 generator rewrites the Night ramps in the same
   commit, so the anchors test never sees a mismatch. The same change
   retunes tui-kit's `intent-resolver.ts`, which derives every Button
   variant from `--color-<family>-500` (the seed) with mix weights tuned
   against the old palette: in dark, `filled` paints its label `#ffffff`
   instead of `var(--bg)` (5.3:1 on every new fill, §7.1), and
   `outline`/`subtle`/`light` take their tone from `--text-<hue>` rather
   than mixing the seed toward `--fg`. Both retunes are dark-only in this
   step. Doing the same in light would clear roughly twelve
   `known-contrast-debt.ts` entries (the ratchet then forces their
   removal) but visibly changes every light outline and subtle hue button,
   so it is migration work, not part of the seed change. `Button.matrix.test.tsx` runs the
   dark grid in CI and `known-contrast-debt.ts` has no dark entries; this
   step must leave it that way. Any dark cell that still measures under
   the floor after the retune is a bug in this step, not a new ledger
   entry. Deck regen follows, as in step 0.
3. **Bound provider (§8.2).** Then the storybook can be built on the real
   providers rather than a hand-wired approximation.
4. **Storybook (MAT-419).** Two clearly separated halves: a reference
   catalogue rendering the ramps from the imported tokens with contrast
   computed at render time (via `@soribashi/core/testing`), and a specimen
   wall covering both kits, using the bound providers, with
   `parameters.a11y.test = 'error'` per story. Needs one glob added to
   `.storybook/main.ts`, tui-kit's `theme.css` imported in `preview.tsx`,
   and the existing `scheme` toolbar decorator extended to also toggle
   `.dark` on the root (Mantine reads `forceColorScheme`; tui-kit reads
   `color-scheme`). `bun run tui-kit:build` must precede the storybook
   build, as it does every board and deck gate.
5. **Contrast gate.** Extends the existing `Button.matrix.test.tsx`
   browser-vitest pattern and its `known-contrast-debt.ts` ratchet to cover
   every text step against every surface in both schemes, every hue text
   value likewise, and the §7 light-fill debt entries. The ledger's entry
   type is a Button cell today (`variant`, `intent`, `scheme`, `state`);
   this step widens it with a second entry shape for a raw
   fill-against-surface pair. Not a Storybook test-runner: there is none
   installed, and the vitest browser project is already in CI.
6. **Lint (MAT-420).** The four §8.1 rules as one ESLint rule over CSS-in-
   TS and `.css` sources, shared by app-kit and tui-kit consumers. Lands
   BEFORE the apps-wide migration. Roughly 154 `--muted` uses must be
   classified as text or fill by hand, and that is the same judgment that
   failed the first time.

Migration then proceeds per package, cheapest first, on the step-0
aliases. `--muted-text` (765 uses) and `--fg` (348) map one-to-one; the
hand-audited work is the 154 `--muted` uses.

### 9.1 A measurement bug to avoid

Chrome serves both `rgb()` (0-255) and `color(srgb r g b)` (0-1). Reading
the latter as 0-255 reports dark text on light backgrounds as failing. That
bug produced false findings twice while this was being investigated. Any
contrast tool here must normalise by syntax, not by guessing at magnitude,
and must composite translucent layers to find the real painted background.
`parseColor` and `compositeOver` in `@soribashi/core/testing` do both; use
them.

## 10. Corrections to the first draft

- **`text-3` was specified as both quieter and higher-contrast.** Those
  contradict: quieter means less contrast, smaller type needs more. The
  solver returned a value darker than `text-2`, exposing it. Resolved in §5
  by making the ramp size-banded rather than a loudness ladder.
- **The platform base was given as 13.5px.** The `--font-size-base` token
  does say `13.5px`, but the live root is 17px and body renders at 14.45px.
  §6 uses measured values.
- **Light fills were solved rather than locked.** The second draft solved
  every fill at 3:1, which made the light accent fill `#7380ff`, a paler
  blue than the `#4658ff` primary button just shipped, and gave Mantine and
  tui-kit two different greens. §7 now fixes the light fill as the locked
  hex and solves only the text values.
