# UI authoring: colour and type

How to write UI code in this repo without improvising. Every colour and
type decision below is already made; new UI picks tokens by ROLE and
inherits the system. If a situation genuinely is not covered here, the
authority of record is radix-ui/themes (how Radix's own components use
these same scales), then a human decision -- never a guessed hex.

Single source: `packages/tokens/src/values.ts` builds every value from
Radix Colors 12-step scales and emits them through
`packages/tokyo/src/tokyo-theme.css` as `--tk-*` custom properties and
Mantine theme colours. Apps consume tokens only; `local/token-namespaces`
(eslint) fails anything else, and the tui-kit ramps matrix test enforces
the contrast bars below on every emitted pair.

## The step model (Radix)

Each scale has 12 steps per scheme. What each step is FOR:

| steps | job |
|---|---|
| 1-2 | app backgrounds |
| 3-5 | component backgrounds (rest, hover, active) |
| 6-8 | borders and separators |
| 9 | solid fill (the one step that is the same hex in light and dark) |
| 10 | solid fill, hover |
| 11 | text on tinted or app backgrounds (the DEFAULT text step) |
| 12 | high-contrast text |

You will rarely touch steps directly; the role tokens below already
picked them. The table exists so a token's choice reads as a decision,
not a mystery.

## Role tokens: pick by job

| job | token | notes |
|---|---|---|
| surface behind everything | `--tk-bg` | page ground |
| card / panel / chrome / inset / overlay / raised | `--tk-card`, `--tk-panel`, `--tk-chrome`, `--tk-inset`, `--tk-overlay`, `--tk-raised` | roles map to different surface steps per scheme (dark inverts card and page); never assume a role's step |
| raw surface ramp | `--tk-surface-1..4` | prefer the role tokens above |
| body text | `--tk-text-1..4` | 1 is high-contrast (slate 12), 2-4 are slate 11 in muted shades; bars: 7.0 / 4.5 / 4.8 / 4.8 |
| status/hue text at body size | `--tk-text-<hue>` | step 11; bars: 4.5 as text, 3.0 floor as a glyph |
| status/hue text at small size | `--tk-text-<hue>-small` | step 12; bar 7.0; use at roughly 12px and under |
| status glyphs and emphasis | `--tk-text-<hue>-vivid` | today an alias of `--tk-text-<hue>`; use the vivid name for glyphs so intent survives future re-tuning |
| solid fills (buttons, badges, dots) | `--tk-fill-<hue>` / `--tk-fill-<hue>-hover` | the solid steps, picked per scheme in values.ts |
| label ON a fill | `--tk-on-fill-<hue>` | white for every hue except gold (a pale scale), which takes a dark neutral; NEVER pair a text token with a fill |
| separators | `--tk-line-1..3` | line-1 clears the 3.0 non-text bar |
| borders | `--tk-border`, `--tk-border-soft`, `--tk-border-on-card` | |
| status dots | `--tk-dot-ok/warn/bad` | |

Hues: accent, ok, bad, warn, gold, purple, cyan (Mantine names:
accent/ok/bad/warn/gold/purple/cyan; virtual aliases blue/green/red/
yellow/violet map onto them).

The four rules that prevent 90% of improvisation:

1. Text on a tint or surface: `--tk-text-*` by size band, never a fill
   token, never a step you picked yourself.
2. Anything on a fill: `--tk-on-fill-<hue>`, even when a darker label
   "looks fine".
3. A glyph that carries status: `-vivid`, judged at the 3.0 glyph bar.
4. No raw colour values in app code, ever. The lint gate agrees.

## The contrast gates

`packages/tui-kit/test/ramps.matrix.test.tsx` measures every emitted
pair against: text-1 7.0, text-2 4.5, text-3/4 4.8, hue text 4.5 (3.0 as
a glyph), hue-small 7.0, line-1 3.0. Button cells run in
`Button.matrix.test.tsx` against 4.5.

When a NEW pair legitimately fails a bar, the answer is a ledger entry in
`packages/tui-kit/src/a11y/known-contrast-debt.ts` with a reason and
human sign-off -- read that file's header first; its ratchet contract is
the rule (entries may be removed or improved, never silently worsened,
and never used to admit a new below-floor cell). Do not weaken a bar, do
not "fix" a failure by picking a darker one-off colour.

## Type

- Font weights follow radix-ui/themes: 400 regular, 500 medium, 700
  bold. There is no 600. Headings are 700, control labels 500.
- chat has its own four-step ladder (xs 12 / sm 13 / md 14 / lg 16 /
  xl 20, mounted at the root provider so portals agree) -- inside chat,
  never size text with a raw px or an off-ladder token; see
  `apps/chat/src/app/chat-font-theme.ts`.
- In every app: a sizeless Mantine `Text` resolves to `md`, it does NOT
  inherit. State a size.

## Dark mode

Comes free when you use role tokens; both schemes are generated from the
same specs. Never branch on scheme in app code to pick a colour --
if a pair only works in one scheme, that is a values.ts/ledger question,
not an app-level override.

## Background

- Spec: `docs/superpowers/specs/2026-09-20-text-and-surface-ramps-design.md`
  (why the ramps are what they are).
- `AGENTS.md` (repo root): the import walls and theme extension points
  for `packages/ui` -- the component-level contract this guide's colour
  rules sit inside.
