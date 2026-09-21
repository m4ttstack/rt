# Text and surface ramps

**Goal:** one surface ramp, one text ramp, one type ramp and one palette that
a reader (human or model) can pick from without judgment, where the wrong
pick is either impossible or loud.

**Status:** design, approved; revised to take every colour from Radix Colors
3.0.0 (`@radix-ui/colors`) after the earlier solved palette changed the feel
of the scheme. Values and the Mantine mapping settled in `~/Documents/mattstack
colors.pen` (frames D3 and E). Implementation sequenced in §9.

**Supersedes:** the first draft (two claims the math disproved, §10) and the
second (a solved palette, §10).

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
"large" (about 24px, or 18.7px bold). The 4.8 and 7.0 bars in §6 are this
platform's own requirement, chosen because 4.5 measured as illegible at
10.5-12px on these fonts.

**A ramp certified only against AA reproduces chat.** Contrast has to be
coupled to size, not just to surface.

## 2. What already exists, and the one thing we take from outside

Do not reinvent these.

| Layer | Has | Quality |
| --- | --- | --- |
| `@radix-ui/colors` 3.0.0 | twelve-step light and dark scales per hue with a published contract (1-2 app backgrounds, 3-5 component backgrounds, 6-8 borders, 9 solid, 10 solid hover, 11 text, 12 high-contrast text), same hex for step 9 in both schemes | the source of every colour value below; data only, MIT |
| `packages/tokyo` | ten-shade Mantine tuples per hue (`ramps.ts`) | hand-generated; §7.3 replaces them with a fixed pick from the Radix steps |
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

**Radix stays a build-time input.** `packages/tokens` vendors the seven
scales it uses (`slate`, `indigo`, `teal`, `crimson`, `orange`, `purple`,
`cyan`) into a generated `src/radix.ts` from the `@radix-ui/colors`
devDependency, with a test that the vendored hex equals the installed
package's. Consumers never import Radix; a Radix upgrade is a regenerate
and a diff, never a silent change.

## 3. Surfaces

**The rule: `surface-1` is the background with the highest contrast against
the default text, and each step after it has less.**

Scheme-independent and checkable by sorting. The number tells you your
headroom: `surface-1` is always the safest ground for text, `surface-4`
always the tightest. The columns mirror because the rule is about contrast,
not lightness.

| | light | Radix | vs text | dark | Radix | vs text | role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `surface-1` | `#ffffff` | white | 16.39 | `#111113` | slate 1 | 16.25 | light: sheets, cards. dark: the page and insets |
| `surface-2` | `#f9f9fb` | slate 2 | 15.58 | `#18191b` | slate 2 | 15.15 | light: panels, overlays. dark: panels, chrome |
| `surface-3` | `#f0f0f3` | slate 3 | 14.41 | `#212225` | slate 3 | 13.70 | light: the page, insets. dark: sheets, cards, overlays |
| `surface-4` | `#e8e8ec` | slate 4 | 13.41 | `#272a2d` | slate 4 | 12.43 | light: rows, chrome. dark: raised (hover, active) |

Light keeps pure white as `surface-1` because cards are white today and
Radix's own guidance allows white as the app background. The three steps
under it are slate 2, 3 and 4 rather than 1, 2 and 3: on 1 to 3 the four
light surfaces spanned 16.39 to 14.41 against `text-1`, which renders as
four indistinguishable whites (§10). On 2 to 4 the span is 16.39 to 13.41,
close to dark's 16.25 to 12.43, and the steps are visible. Dark follows
Radix's ladder exactly: page on step 1, panels on 2, cards on 3, and step 4
reserved for hovered or active component grounds, which is the one dark
surface no role names at rest.

What repaints: every light surface under white moves down a step and a
little darker than the old scheme (panel `#fbfbfc` to `#f9f9fb`, the page
`#f7f8fa` to `#f0f0f3`, chrome `#f3f4f7` to `#e8e8ec`); dark loses its blue
tint (slate is a cool gray, our old ramp was a blue
gray), the page darkens from `#16161e` to `#111113`, and cards move from
`#1e2030` to `#212225`. `inset` in dark lands on `surface-1`. `overlay` does not: dark's page
IS `surface-1`, so a modal ground there is the page's own hex and the
dialog has no edge against what it covers. It sits on `surface-3`, level
with the card, which is where Material puts a modal's resting elevation.
The invariant is that `overlay` differs from the page, which light
satisfies too; the earlier rule capped `overlay` at the panel and is what
produced the collision.

## 4. Two layers

The ramp is declared once per scheme and **never referenced by a
component**. A semantic layer sits on top, pointing at ramp steps, and its
mapping is free to differ per scheme.

```css
/* illustrative; see the emission note below */
:root {
  --surface-1: #ffffff;  --surface-2: #f9f9fb;
  --surface-3: #f0f0f3;  --surface-4: #e8e8ec;

  --card: var(--surface-1);     --panel:   var(--surface-2);
  --page: var(--surface-3);     --chrome:  var(--surface-4);
  --inset: var(--surface-3);    --overlay: var(--surface-2);
  --raised: var(--surface-4);
}
:root.dark {
  --surface-1: #111113;  --surface-2: #18191b;
  --surface-3: #212225;  --surface-4: #272a2d;

  --card: var(--surface-3);     --panel:   var(--surface-2);
  --page: var(--surface-1);     --chrome:  var(--surface-2);
  --inset: var(--surface-1);    --overlay: var(--surface-3);
  --raised: var(--surface-4);
}
```

Seven semantic surfaces, declared in both schemes: `card`, `panel`, `page`,
`chrome`, `inset`, `overlay`, `raised`. `page` is the emitted name for
today's `bg`; `raised` is new (a hovered row or an active control's
ground) and is the only role on `surface-4` in dark. `chrome` and `panel`
share a step in dark and differ in light; they stay two tokens because
they are two roles. No `well` token: `inset` is that role.

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

Four roles, two values. Radix's neutral scale has exactly two text steps,
11 (text) and 12 (high-contrast text), so the size-banded roles below map
onto those two rather than onto four solved values. The roles stay four
because the lint and the type table speak in roles.

| | light | Radix | worst | dark | Radix | worst | bar | serves |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `text-1` | `#1c2024` | slate 12 | 13.41 | `#edeef0` | slate 12 | 12.43 | none | every size |
| `text-2` | `#60646c` | slate 11 | 4.86 | `#b0b4ba` | slate 11 | 6.93 | 4.5 | display, title, body |
| `text-3` | `#60646c` | slate 11 | 4.86 | `#b0b4ba` | slate 11 | 6.93 | 4.8 | meta |
| `text-4` | `#1c2024` | slate 12 | 13.41 | `#edeef0` | slate 12 | 12.43 | 7.0 | small, micro |

Every value is measured against all four surfaces and carries its worst
case, so it is safe on any of them. `text-2` and `text-3` share a value by
design: slate 11's worst case is 4.86 on the light row surface, so the meta
bar is set there (§6). `text-4` is the same hex as `text-1`: small and micro
text takes the high-contrast step, which is what Radix means by 12, and
there is no quieter small-text value to look for.

**Margins.** With published values rather than solved ones the margins are
whatever Radix gives; the gate in §9 asserts `ratio >= bar` at full float
precision using `contrastRatio` from `@soribashi/core/testing`, and the
tokens package's `color-math.ts` agrees with it for every 8-bit channel.

## 6. Type

Six steps named by role. Sizes are measured live on the board at its 17px
root; weight and line-height are targets, since `--type-*` carries size
only and the board uses `micro` at both 500 and 600 today. The bars are
conservative for any smaller root. Each step names the contrast bar any
secondary text must clear at that size. **This column is the link the old
system lacked:** nothing stopped a colour tuned for body copy being used on
10.54px text.

| step | px | weight | line | bar | text role |
| --- | --- | --- | --- | --- | --- |
| `display` | 17 | 700 | 1.25 | 4.5 | `text-2` |
| `title` | 15.3 | 600 | 1.3 | 4.5 | `text-2` |
| `body` | 14.45 | 400 | 1.5 | 4.5 | `text-2` |
| `meta` | 13.26 | 400 | 1.45 | 4.8 | `text-3` |
| `small` | 11.9 | 400 | 1.4 | 7.0 | `text-4` |
| `micro` | 10.54 | 500 | 1.35 | 7.0 | `text-4` |

The 4.5 rows are WCAG AA. The 4.8 and 7.0 rows are this platform's bars
(§1.1), not a standard's. The meta bar is always slate 11's measured floor
on the light row surface, so it tracks that surface: 5.5 in the previous
draft, 5.2 while light sat on slate 1 to 3, and 4.8 now that `surface-4` is
slate 4 and slate 11 measures 4.86 there. Still above AA, and holding a
higher number would push all meta text onto the high-contrast step.

The size bands (which text role a type step may carry) are enforced by
review and by the storybook specimens, not by the lint or the gate: the
lint is property-based and the gate measures tokens against surfaces, so
`--text-2` on `micro` is neither impossible nor loud yet. A pairing check
(`--type-*` against the `--text-*` in the same rule) is the natural next
lint and is out of scope here.

The six semantic steps sit on 22 ad-hoc primitives (`sm/md/lg/xl`,
`px9..px13`, `rem60..rem105`, some differing by half a pixel). Collapsing
those is out of scope here but worth a follow-up.

## 7. Palette

Seven hues. Six are Radix scales chosen for the nearest hue to the arcade
palette (crimson is 3 degrees from our red, cyan 2, purple 4, orange is the
pick that stayed orange rather than going brown, teal was picked by eye
over jade, indigo was picked by eye over iris, violet and blue). The
seventh, gold, has no arcade predecessor: it is Radix amber, added as a
status-text hue distinct from warn/orange (see the fill-limitation note
below the steps table):

| role | Radix scale | old light hex, for the migration |
| --- | --- | --- |
| accent | indigo | `#4658ff` |
| ok | teal | `#00c287` |
| bad | crimson | `#ff3d81` |
| warn | orange | `#ff8a00` |
| purple | purple | `#9b45ff` |
| cyan | cyan | `#00b8d9` |
| gold | amber | n/a (new hue, no arcade predecessor) |

Three values per hue per scheme, each a **step number** chosen by rule from
that scale, never a solved hex:

- **fill:** the first step from 9 upward, capped at 10, that clears 3.0
  against every surface of the scheme. Steps 11 and 12 are text steps in
  Radix's contract and are never fills. A fill still under 3.0 at step 10
  is listed in the fill ledger. In dark, 9 wins over 10 whenever 10 would
  drop the white label under 4.5 (indigo, purple); that exception is
  written into the rule, not hand-picked per hue.
- **fill hover:** step 10 when the fill is 9 (Radix's own hover, darker in
  light and lighter in dark). A fill already on 10 has no non-text step
  left, so it hovers as `color-mix(in srgb, <fill> 88%, <text-1>)`, the
  mix tui-kit ships for filled hover today; step 11 is never a fill or a
  hover.
- **text (body):** the first step from 11 upward that clears 4.5 against
  every surface; that is 11 or 12.
- **text (small):** step 12.

| hue | light fill | worst | light body | light small | dark fill | worst | dark body | dark small |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| accent | 9 `#3e63dd` | 4.26 | 11 `#3a5bc7` | 12 `#1f2d5c` | 9 `#3e63dd` | 2.77 (ledger) | 11 `#9eb1ff` | 12 `#d6e1ff` |
| ok | 10 `#0d9b8a` | 2.83 (ledger) | 12 `#0d3d38` | 12 `#0d3d38` | 9 `#12a594` | 4.70 | 11 `#0bd8b6` | 12 `#adf0dd` |
| bad | 9 `#e93d82` | 3.15 | 12 `#621639` | 12 `#621639` | 9 `#e93d82` | 3.75 | 11 `#ff92ad` | 12 `#fdd3e8` |
| warn | 10 `#ef5f00` | 2.72 (ledger) | 12 `#582d1d` | 12 `#582d1d` | 9 `#f76b15` | 4.86 | 11 `#ffa057` | 12 `#ffe0c2` |
| purple | 9 `#8e4ec6` | 4.24 | 11 `#8145b5` | 12 `#402060` | 9 `#8e4ec6` | 2.79 (ledger) | 11 `#d19dff` | 12 `#ecd9fa` |
| cyan | 10 `#0797b9` | 2.80 (ledger) | 12 `#0d3c48` | 12 `#0d3c48` | 9 `#00a2c7` | 4.80 | 11 `#4ccce6` | 12 `#b6ecf7` |
| gold | 9 `#ffc53d` | 1.29 (ledger) | 12 `#4f3422` | 12 `#4f3422` | 9 `#ffc53d` | 9.14 | 11 `#ffca16` | 12 `#ffe7b3` |

Five fills sit under 3.0 by a small margin and are ledgered rather than
pushed onto a text step: in light, teal-10, orange-10 and cyan-10 at 2.83,
2.72 and 2.80 on the row surface (orange's 10 was chosen by eye over the
11, which reads brown); in dark, indigo-9 and purple-9 at 2.77 and 2.79
against `surface-4`, the raised ground. Four of the five clear 3.0 on every
other surface of their scheme; light orange is the one that also misses on
the page, at 2.93.

Light gold is a sixth, larger miss: Radix amber clears 3.0 at neither step
9 nor step 10 (1.58 against the page, 1.29 against the worst surface), so
the rule that picks between them on contrast grounds has no winner. Gold
stays at fill 9 by decision, matching every hue that is not pushed to 10
by a real win, and the shortfall is ledgered rather than hidden by a step
the rule did not actually choose. Amber is a bright-accent scale, not a
lightness ramp; its dark scheme clears 3.0 easily, at 9.14.

**Tokens.** `--fill-<hue>`, `--fill-<hue>-hover`, `--text-<hue>` (body
value, allowed at `display`, `title`, `body`), `--text-<hue>-small` (allowed
at `meta`, `small`, `micro`; light crimson 11 measures 4.41 on the row
surface, under the 4.5 body bar, so light `bad` takes step 12 at body as
well and its two text tokens carry the same hex, as ok, warn and cyan
already do), `--text-<hue>-vivid` (step 11 unconditionally; `--text-<hue>`
promotes to 12 in light for five of the seven hues, so no other token names
the un-promoted step). A fill is never a text colour, and the names
retire the `accent` versus `accentText` guesswork. In `values.ts` these are
step numbers (`hueStep.<h>.fill`, `.text`) resolved against the vendored
scale, so the invariants can assert the rule itself, not just the result.

**Labels on fills.** Radix puts white text on step 9 for every saturated
scale, but a white label only clears 4.5 on two of the seven fills.
`--on-fill-<hue>` measures both candidates, white and slate 12 light
(`#1c2024`, already `text-1` in the light scheme), and picks whichever wins:

| hue | light fill | white | dark label | dark fill | white | dark label | pick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| accent | `#3e63dd` | 5.21 | 3.15 | `#3e63dd` | 5.21 | 3.15 | white |
| purple | `#8e4ec6` | 5.18 | 3.16 | `#8e4ec6` | 5.18 | 3.16 | white |
| ok | `#0d9b8a` | 3.46 | 4.74 | `#12a594` | 3.07 | 5.33 | dark |
| warn | `#ef5f00` | 3.33 | 4.92 | `#f76b15` | 2.97 | 5.52 | dark |
| cyan | `#0797b9` | 3.42 | 4.79 | `#00a2c7` | 3.00 | 5.46 | dark |
| bad | `#e93d82` | 3.85 | 4.26 | `#e93d82` | 3.85 | 4.26 | dark |
| gold | `#ffc53d` | 1.58 | 10.38 | `#ffc53d` | 1.58 | 10.38 | dark |

Gold carries the widest on-fill margin of any hue: its fill is bright
enough that white text fails outright (1.58), and the dark label wins by
a wide berth. Consistent with the rest of the table, the pick is the same
hue property in both schemes because the fill hex itself does not change.

The pick is a property of the hue, not the scheme: it is the same in light
and dark for every hue. Only `bad` stays under 4.5 even with its better
pick, at 4.26, so the Button ledger drops from eight entries to one hue,
carried as two rows because the ledger is keyed per scheme. The
neutral fill (`--muted`, slate 9) carries no hue and keeps its own label,
`light-dark(<text-1>, #ffffff)` (4.96 in light, 5.13 in dark), unrelated
to `--on-fill-<hue>`.

The status `dot` block in `values.ts` (`dot.ok/warn/bad`) retires: a dot is
a fill. `--fill-ok` at 4.70 in dark clears the bar a 6px dot needs; in
light it is the ledgered 2.83 on the row surface (3.04 on the page), and
`--fill-warn` the ledgered 2.72, so those dots carry the same debt their
fills do.

### 7.1 Dark hue correction

Solved by construction: each hue's dark scale is the same Radix hue as its
light scale (step 9 is the same hex in both), so the schemes agree on what
each hue **is**. `invariants.test.ts` pins `light[9] === dark[9]` per hue
as the guard that nobody swaps one scale's dark half for another's.

### 7.2 Lines

Three steps per scheme from slate, ordered like surfaces: `line-1` is the
strongest against the surface it sits on. Light takes the border band (8,
7, 6). Dark takes 9, 7, 6: slate 8 measures 2.54 on the dark card, and the
control edge is the one line that has to hold WCAG 1.4.11's 3:1 (it does
today at 3.51), so `line-1` steps up to slate 9 at 3.10.

| | light | Radix | vs `#ffffff` | dark | Radix | vs card `#212225` | vs page `#111113` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `line-1` | `#b9bbc6` | slate 8 | 1.91 | `#696e77` | slate 9 | 3.10 | 3.68 |
| `line-2` | `#cdced6` | slate 7 | 1.57 | `#43484e` | slate 7 | 1.72 | 2.04 |
| `line-3` | `#d9d9e0` | slate 6 | 1.40 | `#363a3f` | slate 6 | 1.39 | 1.65 |

The semantic mapping differs per scheme, which §4 permits:

| role | light | dark, base | dark, card scope |
| --- | --- | --- | --- |
| `--border-control` | `line-1` | `line-1` | `line-1` |
| `--border` | `line-2` | `line-2` | `line-1` |
| `--border-soft` | `line-3` | `line-3` | `line-2` |

Today's values sit close to these (light border `#c8cad6` is between
slate 7 and 8; dark border `#3b4261` measures 1.64 on the old card where
slate 7 measures 1.72 on the new one; dark soft `#313853` 1.40 where slate
6 is 1.39). The one weight change is the dark card edge: `#505879` measures
2.31 on the old card, slate 9 measures 3.10 on the new one, so card
borders in dark get crisper. Dark card
scope is where the `edgeOnCard`, `controlEdgeOnCard` and `softOnCard`
tokens live today, because a card in dark is lighter than the page and a
page-tuned line vanishes on it. The replacement is a scope rule, not more
tokens: a card ground re-points its borders in its own scope through the
emitted `--border-on-card` and `--border-soft-on-card` aliases, which carry
this table's per-scheme mapping (`light-dark(var(--line-2), var(--line-1))`
and `light-dark(var(--line-3), var(--line-2))`), so
`.card { --border: var(--border-on-card); --border-soft: var(--border-soft-on-card) }`
is a no-op in light and steps up in dark. That is what the board's
`--gate-*` block does by hand. A literal `.card { --border: var(--line-1) }`
would also fire in light and darken light card edges; do not write it.
`line.grid` (the table hairline) keeps its own token in both schemes.

Lines have no text bar. WCAG 1.4.11's 3:1 applies to a control's boundary
only when the border is the sole boundary cue; every light line here is
under it, as they are today, and dark `line-1` clears it on the page,
panels and cards (3.68, 3.43, 3.10) but not on `raised` (2.82), the
active-control ground. The light control edge and dark `line-1` on
`raised` are ledgered debts for the gate, not changes this spec makes.

### 7.3 Mantine

Mantine reads fixed tuple indices for fixed jobs (`get-css-color-variables`
in `@mantine/core` 9.5): in light, `filled`/`outline`/`text`/anchor at
`primaryShade.light`, `filled-hover` one above it, the `light` tint at 1
and its hover at 2, `light-color` at 9; in dark, `filled` at
`primaryShade.dark`, hover one above, `text` and anchor at 4, `outline` and
`light-color` at 0, and the `light` tint as `darken(9, 50%)`. Twelve Radix
steps become ten by a fixed pick, one per scheme:

- **Day tuple** (index ← Radix step): `0←1, 1←3, 2←4, 3←5, 4←6, 5←7, 6←9,
  7←10, 8←11, 9←12`. `primaryShade.light` stays 6. Steps 2 and 8 have no
  Mantine job.
- **Night tuple**: Radix's dark scales run darkest to lightest, Mantine's
  tuples lightest to darkest, so the pick is reversed: `0←12, 1←11, 2←10,
  3←9, 4←8, 5←7, 6←6, 7←5, 8←4, 9←3`. `primaryShade.dark` becomes 3.

The pick lands `filled` (9), `filled-hover` (10), the light tint (3, hover
4) and `light-color` (12) on the right Radix steps in light with no help.
Six of Mantine's derivations disagree with either Radix's contract or the
§7 rule, and they are pinned per colour to the exact values `values.ts`
chose. `cssVariablesResolver` is a `MantineProvider` prop, not a theme
field, so the pins do not travel with the theme; they ship instead as a
generated block in `tokyo-theme.css` under
`:root:root[data-mantine-color-scheme='<scheme>']`, the doubled-`:root`
pattern that file already uses to beat Mantine's runtime style tag for
`anchor`. Every provider site gets them for free.

| Mantine variable | scheme | Mantine derives | pinned to |
| --- | --- | --- | --- |
| `--mantine-color-<c>-filled`, `-filled-hover` | light, ok/warn/cyan only | step 9, 10 | step 10 and the §7 hover mix |
| `--mantine-color-<c>-text`, `-outline` | light | step 9 | the §7 body text step (11 or 12) |
| `--mantine-color-<c>-filled-hover` | dark | index 4 = step 8 | step 10 |
| `--mantine-color-<c>-text` | dark | index 4 = step 8 | step 11 |
| `--mantine-color-<c>-outline` | dark | index 0 = step 12 | step 11, so Mantine and tui-kit outline text agree |
| `--mantine-color-<c>-light`, `-light-hover` | dark | `darken(step 3, 50%)` | steps 3, 4 |

`--mantine-color-anchor` is already pinned in both schemes by the existing
`:root:root` block to `--tk-accent-text`, which becomes indigo 11; that
block stays and covers the dark anchor (Mantine would read index 4).

`gray` (light) and `dark` (dark) tuples come from slate by their own picks,
chosen so Mantine's neutral reads land on the ramp:

- **gray** (index ← slate step): `[2, 3, 4, 6, 7, 8, 11, 11, 12, 12]`, so
  `gray-4` (default border) is slate 7 and `gray-6` (dimmed) is slate 11.
- **dark** (index ← slate step): `[12, 11, 11, 9, 8, 4, 3, 2, 1, 1]`, so
  `dark-0` (text) is slate 12, `dark-2` (dimmed) slate 11, `dark-4`
  (border, and Menu item hover, which Mantine overloads onto the same
  slot) slate 8, `dark-5` (filled input background, default hover) slate 4,
  `dark-6` (default component background: default Buttons, inputs, Kbd,
  Code, Table, Notification) slate 3, the card, and `dark-7` (body) slate
  2. Indices 5 and 6 sit on surface steps, not border steps, because
  Mantine paints component grounds from them.

Two slots in each carry a duplicate step because twelve steps do not divide
into ten jobs; that is harmless. The hand-written
`--mantine-color-dark-0..9` remap block in `tokyo-theme.css` retires with
this change, as does any bare-`:root` `--mantine-color-gray-*` override
there: both tuples now land in-palette on their own, and the dark block
would otherwise re-point `dark-7` at the page.

Two more slots Mantine reads from the neutral tuples get a sentence so
nobody reads them as bugs. `dark-3` (placeholder and disabled text) is
slate 9, a fill step, which as text measures 3.10 on the input ground; the
existing bare-`:root` `--mantine-color-placeholder` override loses to
Mantine's scheme block today, so step 1 scheme-scopes it to
`--tk-muted-text` (slate 11, 7.64 on the input ground) the way `dimmed`
already is. Mantine's dark `body` is `dark-7`, the panel, so a Modal's
content ground in dark is the panel, not `--overlay`; that is accepted, and
Popover and Paper land on the card through `dark-6` as intended.

`autoContrast` stays off: labels are white per Radix's contract and the
ledger, not per-cell luminance flips.

## 8. Namespaces and providers

### 8.1 Namespaces

- `--text-*` ... `color:` only
- `--surface-*` ... `background*` and `fill` only; `--surface-[1-4]` only
  in the tokens file
- `--border-*` and `--line-[1-3]` ... border, outline and `scrollbar-color`
  properties only; `--line-[1-3]` only in the tokens file
- `--fill-*` ... dots, washes, chips, shapes; never `color:`

These are soribashi's existing emitted prefixes. `--surface-*` already
covers the semantic roles (`--surface-card`) and the washes
(`--surface-wash-*`), all of which are backgrounds, so the property rule
holds across the prefix and only the numeric ramp steps get the
tokens-file-only rule. `--line-*` is new and follows `--surface-N`;
`--line-height-*` is soribashi's type scale and is not a line token.

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
worth one import site. `@radix-ui/colors` is a devDependency of its codegen
only (§9 step 0).

## 9. Verification and sequencing

Six steps, in the order they must land. Each lands green on its own; step
0 carries the tui-kit button retune and the ledger rewrite because the
button matrix runs in CI against every hue, and moving the fills without
moving the labels and the ledger cannot be green.

0. **Tokens.** `packages/tokens` gains `scripts/generate-radix.ts`, which
   reads the seven scales from the installed `@radix-ui/colors` and writes
   `src/radix.ts` (twelve hex per scale per scheme, plus the package
   version), and `test/radix-fresh.test.ts`, which fails if the vendored
   file and the installed package disagree. `values.ts` then declares, per
   scheme: `surfaceRamp` (§3, by step), the seven semantic surface roles
   (§4), `textRamp` (§5, by step), `lineRamp` and the three border roles
   with the per-scheme mapping (§7.2), and `hueStep.<h> = { fill, text }`
   (§7, step numbers) resolved against `radix.ts`; the `dot` block retires
   into the fills. `scripts/generate.ts` emits the numeric ramps and the
   new semantic names into tui-kit's `tokens.ts` and tokyo's
   `tokyo-theme.css`. Old names are emitted as aliases for one release:
   `--fg` → `text-1`; `--muted-text` and `--text-muted-on-card` → `text-3`;
   `--bg` → `--page`; the three `*OnCard` line names → the §7.2 card-scope
   values; `--accent-text`/`--red-text`/`okText`/`warnText` → the hue body
   text; `--dot-*` → `--fill-*`; `--muted` keeps its name and moves to
   slate 9, Radix's solid neutral, so the fill gray sits on the same scale
   as everything else (its 154 uses are still the step-5 audit). In
   `tokyo-theme.css`, `--ui-bg-4` becomes `var(--tk-raised)` instead of a
   mix over the card. `@radix-ui/colors` enters through the root
   `workspaces.catalog` like every shared version. The short-alias tier is authored in
   `packages/tui-kit/soribashi.config.ts`, and soribashi has no `line`
   semantic group today, so `--line-[1-3]` and `--border-control` need
   entries there. `invariants.test.ts` asserts the rules: surfaces sorted
   by contrast against `text-1`; every role a ramp step; `text-2/3/4`
   clearing 4.5/4.8/7.0 on every surface; every hue's fill step being the
   first from 9 that clears 3.0 (or the documented exception), every body
   text step the first from 11 that clears 4.5, and `light[9] === dark[9]`;
   line ramps non-increasing. The tui-kit census (`test/theme.test.ts`)
   gets one ruling set for the palette change, since every colour moves.
   In the same change, tui-kit's `intent-resolver.ts`, which derives every
   Button variant from `--color-<family>-500` (the fill) with mix weights
   tuned against the old palette, reads the hue text tokens in both
   schemes: `outline`/`subtle` text from `--text-<hue>`, the tinted `light`
   variant's text from `--text-<hue>-small`, `filled` labels from
   `--on-fill-<hue>` (white for accent and purple, the dark neutral for the
   rest; the neutral fill keeps `light-dark(<text-1>, #ffffff)`), `filled` hover
   from `--fill-<hue>-hover` so tui-kit and Mantine hover to the same
   colour. The `muted` intent is not a hue: its `outline`/`subtle` text is
   `--text-2` and its `light` text `--text-4` (slate 11 and 12). `Button.tsx`'s
   pinned `default|bad` colour reads `--text-bad`. `known-contrast-debt.ts`
   carries four families (fill, on-fill, vivid text, line), each keyed
   finely enough that no scheme or surface can fall through a branch, and the
   ratchet holds from there. Then `bun run tokens:codegen`, tui-kit
   codegen, and `cd apps/deck && bun run build:board` for the vendored
   copies.
1. **Mantine tuples and pins (MAT-421, reframed).** No generator, no
   colour math: `scripts/generate-ramps.ts` writes `packages/tokyo/src/ramps.ts`
   from `radix.ts` by the §7.3 picks (six hue pairs plus `grayDay` and
   `darkNight`), and `scripts/generate.ts` splices the §7.3 pins into
   `tokyo-theme.css` as a generated `:root:root[data-mantine-color-scheme]`
   block per scheme. `theme.ts` sets `primaryShade: { light: 6, dark: 3 }`
   and registers `gray` and `dark`; the hand-written `--mantine-color-dark-*`
   block retires. `ramp-anchors.test.ts` pins `Day[6]` and `Night[3]` to
   the hue's step 9, and pins every entry the generator's `mantinePins()`
   returns both to the token it mirrors and to a line inside the generated
   CSS block, which it parses back out of `tokyo-theme.css` by marker.
   `@mantine/colors-generator` is not installed and stays that way.
2. **Bound provider (§8.2).** Then the storybook can be built on the real
   providers rather than a hand-wired approximation.
3. **Storybook (MAT-419).** Two clearly separated halves: a reference
   catalogue rendering the ramps from the imported tokens with contrast
   computed at render time, and a specimen wall covering both kits, using
   the bound providers, with `parameters.a11y.test = 'error'` per story.
   Needs one glob added to `.storybook/main.ts`, tui-kit's `theme.css`
   imported in `preview.tsx`, and the existing `scheme` toolbar decorator
   extended to also toggle `.dark` on the root (Mantine reads
   `forceColorScheme`; tui-kit reads `color-scheme`). `bun run
   tui-kit:build` must precede the storybook build, as it does every board
   and deck gate.
4. **Contrast gate.** Extends the existing `Button.matrix.test.tsx`
   browser-vitest pattern and its `known-contrast-debt.ts` ratchet to cover
   every text step against every surface in both schemes, every hue text
   value likewise, the six hue fills against every surface with the five
   §7 fill entries, and dark `line-1` against `raised` as a sixth. `--muted`
   (slate 9, 2.70 light and 2.82 dark against its worst surface) stays out
   of the gate until the step-5 audit decides which of its 154 uses are
   fills. The ledger's entry type is a Button cell today
   (`variant`, `intent`, `scheme`, `state`); this step widens it with a
   second entry shape for a raw fill-against-surface pair. Not a Storybook
   test-runner: there is none installed, and the vitest browser project is
   already in CI.
5. **Lint (MAT-420).** The four §8.1 rules as ESLint rules over style
   objects (TS/TSX) and stylesheets (`@eslint/css`), shared by app-kit and
   tui-kit consumers. Lands BEFORE the apps-wide migration. Roughly 154
   `--muted` uses must be classified as text or fill by hand, and that is
   the same judgment that failed the first time.

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

## 10. Corrections to earlier drafts

- **`text-3` was specified as both quieter and higher-contrast.** Those
  contradict: quieter means less contrast, smaller type needs more. The
  solver returned a value darker than `text-2`, exposing it. Resolved in §5
  by making the ramp size-banded rather than a loudness ladder.
- **The platform base was given as 13.5px.** The `--font-size-base` token
  does say `13.5px`, but the live root is 17px and body renders at 14.45px.
  §6 uses measured values.
- **Light fills were solved rather than locked.** The second draft solved
  every fill at 3:1, which made the light accent fill `#7380ff`, a paler
  blue than the primary button, and gave Mantine and tui-kit two different
  greens.
- **The solved palette changed the feel of the scheme.** Holding a hue and
  pulling lightness down turns orange brown and every hue duller, and a
  hand-tuned Mantine ramp generator sat on top of it. This draft takes
  every colour from Radix Colors, whose scales keep hue by design and
  come with both schemes and a twelve-step contract, and replaces the
  solver, the dark hue correction and the OKLab generator with step
  numbers chosen by rule. The cost is stated in §7 and carried in the
  ledger: six hue fills under the 3.0 bar, one filled-button label under
  4.5, twelve vivid-text cells under 4.5 in light, and five control edges
  under 3.0.
- **The first Radix draft put light's surfaces on slate 1 to 3.** That
  spans 16.39 to 14.41 against `text-1`, and rendered as four
  near-identical whites while dark's four steps were plainly distinct. The
  storybook's Surfaces story is what caught it: the numbers had been
  reviewed twice and read as a fine ramp on paper. §3 now puts light on
  slate 2 to 4 (16.39 to 13.41). The floor moving to `#e8e8ec` moved four
  more things: the §6 meta bar from 5.2 to 4.8 (slate 11 measures 4.86
  there), light teal-10 and cyan-10 into the §7 fill ledger beside
  orange-10, and light `bad` body text from crimson 11 to 12 (11 measures
  4.41, under AA).
