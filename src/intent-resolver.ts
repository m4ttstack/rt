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
 * tui-kit's intent resolver: maps `intent` to its family's single canonical
 * tone (the TUI palette has one value per hue, no ramp — `muted`'s family
 * carries no `500`, so it resolves to `--color-gray-muted` instead), then
 * delegates every variant's actual colour/border/hover math to
 * `singleShadeVariantColors`. That helper's per-variant formulas (weights,
 * mix spaces, which surface each hover mixes over) are themselves parity
 * with what this file used to hand-roll — see Button.parity.test.tsx, the
 * oracle this migration was required to reproduce exactly.
 */
export const tuiIntentResolver: IntentResolver = ({ intent, variant }) => {
  const family = FAMILY[intent] ?? "blue";
  const tone =
    family === "gray" ? "var(--color-gray-muted)" : `var(--color-${family}-500)`;

  return singleShadeVariantColors(tone, variant) satisfies IntentResolverResult;
};
