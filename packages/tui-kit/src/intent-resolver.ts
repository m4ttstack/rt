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
 * Text tones. Fills are Radix step 9 or 10 and read under AA as text on the
 * kit's surfaces, so every text-bearing variant reads the hue's text token
 * instead; the tinted `light` variant lifts its ground above the page and
 * takes the small token for headroom. Both tokens are solved in
 * packages/tokens, one value per scheme, so nothing here mixes toward --fg.
 */
const TEXT_TONE: Record<string, string> = {
  accent: "var(--text-accent)",
  ok: "var(--text-ok)",
  warn: "var(--text-warn)",
  bad: "var(--text-bad)",
  cyan: "var(--text-cyan)",
  purple: "var(--text-purple)",
  muted: "var(--text-2)",
};

const TINT_TEXT_TONE: Record<string, string> = {
  accent: "var(--text-accent-small)",
  ok: "var(--text-ok-small)",
  warn: "var(--text-warn-small)",
  bad: "var(--text-bad-small)",
  cyan: "var(--text-cyan-small)",
  purple: "var(--text-purple-small)",
  muted: "var(--text-4)",
};

export function retunedTextColor(tone: string, variant: string, intent: string): string {
  if (variant === "light") return TINT_TEXT_TONE[intent] ?? tone;
  if (variant === "outline" || variant === "subtle") return TEXT_TONE[intent] ?? tone;
  return tone;
}

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

  if (variant === "filled") {
    const neutral = family === "gray";
    result = {
      ...result,
      // The neutral fill is the one case with no hue token: slate 9 carries a
      // white label at 3.3 in light and 5.1 in dark, so it flips per scheme.
      color: neutral ? "light-dark(var(--text-1), #ffffff)" : `var(--color-${family}-onFill)`,
      hover: neutral ? `color-mix(in srgb, ${tone} 88%, var(--fg))` : `var(--color-${family}-hover)`,
      border: "transparent",
    };
  }

  const color = retunedTextColor(tone, variant, intent);
  return color === tone ? result : { ...result, color };
};
