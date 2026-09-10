import { singleShadeVariantColors } from "@soribashi/core";
import type { IntentResolver, IntentResolverResult } from "@soribashi/core";

/**
 * The join between the theme's hue-named colour families and the role-named
 * `intent` vocabulary a component prop takes. The only place the mapping lives.
 */
const FAMILY: Record<string, string> = {
  accent: "blue",
  ok: "green",
  warn: "amber",
  bad: "red",
  cyan: "cyan",
  purple: "purple",
  muted: "gray",
};

/**
 * Text-tone retune: Tokyo has one shade per hue, so `singleShadeVariantColors`
 * has no darker/lighter ramp step to reach for the way a multi-shade resolver
 * would — its `light`/`outline`/`subtle` branches all paint `color: tone`
 * verbatim, and several tones read below WCAG AA against those variants'
 * actual backgrounds. Mirrors Mantine's tinted-context text (its light-variant
 * text sits a shade darker than the tint itself): `color` is patched to
 * `color-mix(in srgb, tone N%, var(--fg))` for the intents that need it.
 * Leaning toward `--fg` corrects both schemes with one N — `--fg` itself flips
 * near-black/near-white per scheme (src/generated/theme.css), so the same mix
 * darkens in light mode and lightens in dark mode. `border`/`background` stay
 * untouched: neither is the failing axis (WCAG text contrast only grades
 * `color` against `background`), and `filled`'s foreground already clears the
 * floor.
 *
 * N per intent was chosen by measurement against this exact palette (each
 * variant's real background), not by eye. An intent absent from a table clears
 * the floor at the raw tone already and is left unpatched, to stay as close to
 * the original hue as the floor allows.
 */
const LIGHT_VARIANT_TONE_WEIGHT: Partial<Record<string, number>> = {
  accent: 80,
  warn: 95,
  bad: 80,
  muted: 70,
};

const OUTLINE_SUBTLE_TONE_WEIGHT: Partial<Record<string, number>> = {
  accent: 70,
  ok: 85,
  warn: 80,
  bad: 70,
  cyan: 90,
  muted: 60,
};

/**
 * Exported so a test can ask "does this (variant, intent) get retuned" without
 * hand-rolling a second copy of the weight tables above — see
 * Chip.test.tsx's census, which paints its expected-colour probe with this
 * same function's output rather than the raw alias.
 */
export function toneWeightFor(variant: string, intent: string): number | undefined {
  if (variant === "light") return LIGHT_VARIANT_TONE_WEIGHT[intent];
  if (variant === "outline" || variant === "subtle") return OUTLINE_SUBTLE_TONE_WEIGHT[intent];
  return undefined;
}

/**
 * Applies the retune above to a resolved `color` value. Exported alongside
 * `toneWeightFor` for the same reason: a test that wants "the colour this
 * (variant, intent) actually paints" builds it from this function and a raw
 * tone reference, instead of restating the `color-mix` shape.
 */
export function retunedTextColor(tone: string, variant: string, intent: string): string {
  const weight = toneWeightFor(variant, intent);
  return weight === undefined ? tone : `color-mix(in srgb, ${tone} ${weight}%, var(--fg))`;
}

/**
 * The gate surfaces' ratified cells, pinned verbatim (spec:
 * docs/superpowers/specs/2026-09-10-polish-port-design.md). Pins take
 * precedence over the tone-weight retune: these cells' whole quartet is
 * design-fixed, not a derived value with a corrected text tone.
 */
const PINNED_CELLS: Record<string, Partial<IntentResolverResult>> = {
  "light|muted": {
    background: "color-mix(in srgb, var(--fg) 8%, transparent)",
    color: "var(--fg)",
    hover: "color-mix(in srgb, var(--fg) 13%, transparent)",
    border: "transparent",
  },
  "light|accent": {
    background: "color-mix(in srgb, var(--accent) 14%, transparent)",
    color: "var(--accent-text)",
    hover: "color-mix(in srgb, var(--accent) 22%, transparent)",
    border: "transparent",
  },
  "subtle|muted": {
    color: "var(--fg)",
    hover: "color-mix(in srgb, var(--fg) 6%, transparent)",
    border: "transparent",
  },
};

/**
 * tui-kit's intent resolver: maps `intent` to its family's single canonical
 * tone (the TUI palette has one value per hue, no ramp — `muted`'s family
 * carries no `500`, so it resolves to `--color-gray-muted` instead), then
 * delegates every variant's actual colour/border/hover math to
 * `singleShadeVariantColors`. That helper's per-variant formulas (weights,
 * mix spaces, which surface each hover mixes over) are themselves parity
 * with what this file used to hand-roll — see Button.parity.test.tsx, the
 * oracle this migration was required to reproduce exactly (except where the
 * contrast retune above deliberately departs from it).
 */
export const tuiIntentResolver: IntentResolver = ({ intent, variant }) => {
  const family = FAMILY[intent] ?? "blue";
  const tone =
    family === "gray" ? "var(--color-gray-muted)" : `var(--color-${family}-500)`;

  let result = singleShadeVariantColors(tone, variant) satisfies IntentResolverResult;

  // filled paints scheme-inverting text: --bg flips near-white/near-black
  // per scheme, so one rule clears both grounds where a literal white
  // could not. Hover mixes the tone toward --fg (88%), the shipped value.
  if (variant === "filled") {
    result = {
      ...result,
      color: "var(--bg)",
      hover: `color-mix(in srgb, ${tone} 88%, var(--fg))`,
      border: "transparent",
    };
  }

  const pinned = PINNED_CELLS[`${variant}|${intent}`];
  if (pinned) return { ...result, ...pinned };

  const weight = toneWeightFor(variant, intent);
  if (weight === undefined) return result;

  return { ...result, color: retunedTextColor(tone, variant, intent) };
};
