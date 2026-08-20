import type { IntentResolver, IntentResolverResult } from "@soribashi/core";

/**
 * Family per intent word.
 *
 * The theme's colour families are hue-named (`blue`, `green`, `amber`, ...)
 * because that is what mr-board's palette actually is: one canonical value per
 * hue, lifted verbatim from Tokyo Day/Night. The vocabulary, in contrast, is
 * role-named (`accent`, `ok`, `warn`, ...) because that is what a component
 * prop should say. This table is the join between the two, and it is the only
 * place the mapping lives.
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
 * Weight of the hover wash, in percent. 14% is not a guess: it is the exact
 * weight mr-board already uses for its one accent-tinted hover surface
 * (`color-mix(in srgb, var(--accent) 14%, transparent)`, see
 * docs/token-census.md section (c)), so a component that hovers through this
 * resolver lands on the value the board's hand-written CSS already produces.
 */
const HOVER_WASH = 14;

/**
 * tui-kit's intent resolver.
 *
 * The DEFAULT soribashi resolver cannot be used here: it hardcodes lookups of
 * shades `500`/`600`/`700`/`800`/`foreground` on every family named by the
 * intent vocabulary (see default-intent-resolver.ts's scale contract), and the
 * TUI palette is deliberately one canonical value per hue with no ramp. Rather
 * than invent ramp shades — which would be nine tenths of a new palette, and
 * would not be mr-board's colours any more — the derivation happens in CSS:
 * the base colour is the family's single `500`, and hover is a `color-mix`
 * wash of it.
 *
 * `background: "transparent"` for every intent/variant on purpose. The TUI look
 * colours by border and text on an unfilled surface; nothing in mr-board paints
 * a filled intent-coloured button. Variants (`outline`/`subtle`/`ghost`) differ
 * only in border and wash treatment, which lives in the recipe CSS where it can
 * be expressed per part; they share one colouring model, so `variant` does not
 * change what this function returns.
 *
 * `muted` is the one intent whose family has no `500`: the gray family carries
 * `fg` and `muted` slots (mr-board has no gray ramp either), so it resolves to
 * `--color-gray-muted`.
 */
export const tuiIntentResolver: IntentResolver = ({ intent, variant }) => {
  const family = FAMILY[intent] ?? "blue";
  const base =
    family === "gray" ? "var(--color-gray-muted)" : `var(--color-${family}-500)`;

  void variant;

  return {
    background: "transparent",
    color: base,
    border: base,
    hover: `color-mix(in srgb, ${base} ${HOVER_WASH}%, transparent)`,
    hoverColor: base,
  } satisfies IntentResolverResult;
};
