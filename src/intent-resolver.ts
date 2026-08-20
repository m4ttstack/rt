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

/** Hover wash weight, in percent. Not a guess: the exact weight mr-board uses
    for its one accent-tinted hover surface. */
const HOVER_WASH = 14;

/**
 * tui-kit's intent resolver. Hand-written because the default one hardcodes
 * ramp-shade lookups the TUI palette does not have — see docs/decisions.md.
 *
 * `muted` is the one intent whose family has no `500`: the gray family carries
 * `fg` and `muted` slots, so it resolves to `--color-gray-muted`.
 */
export const tuiIntentResolver: IntentResolver = ({ intent, variant }) => {
  const family = FAMILY[intent] ?? "blue";
  const base =
    family === "gray" ? "var(--color-gray-muted)" : `var(--color-${family}-500)`;

  // Variants differ only in border and wash treatment, which lives in recipe
  // CSS where it can be expressed per part; they share one colouring model.
  void variant;

  return {
    background: "transparent",
    color: base,
    border: base,
    hover: `color-mix(in srgb, ${base} ${HOVER_WASH}%, transparent)`,
    hoverColor: base,
  } satisfies IntentResolverResult;
};
