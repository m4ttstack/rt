/**
 * Ledger of Button (intent, variant, scheme) rest-state cells that measure
 * below WCAG AA (4.5:1). The filled label reads `--on-fill-<hue>`, which is
 * white for every hue but gold (packages/tokens/src/values.ts).
 *
 * That pick follows radix-ui/themes, the authority on record for these
 * scales: its `--<scale>-contrast` is white for indigo, teal, crimson,
 * orange, purple and cyan, and dark only for the pale scales (amber,
 * yellow, sky, mint, lime). Step 9 is designed to carry white. Choosing the
 * higher-contrast label per hue instead clears more cells but gives a button
 * row two label colours, which their components never have.
 *
 * SIGNED OFF, and one entry WORSENS rather than improves: filled/bad moves
 * from 4.26 with the dark neutral to 3.85 with white, and filled/warn in
 * dark sits at 2.97, under even the 3.0 non-text bar and the lowest cell
 * this system carries. Both are the values radix-ui/themes itself ships.
 * Recorded here because the ratchet below otherwise forbids a worsening,
 * and a rule bent without a record is a rule that stops meaning anything.
 *
 * RATCHET CONTRACT (enforced by Button.matrix.test.tsx, not here): an
 * entry's `measuredRatio` may only be REMOVED (the cell was fixed and now
 * clears 4.5) or IMPROVED (a smaller regression than recorded), never
 * silently worsened, and never used to admit a NEW below-floor cell. Adding
 * a new entry to widen coverage requires the same human sign-off as fixing
 * one; this file is a record of known debt, not an allowlist mechanism.
 */

export type ContrastScheme = "light" | "dark";
export type ButtonInteractionState = "rest";

export interface ContrastDebtEntry {
  variant: string;
  intent: string;
  scheme: ContrastScheme;
  state: ButtonInteractionState;
  measuredRatio: number;
  reason: string;
}

export const KNOWN_CONTRAST_DEBT: readonly ContrastDebtEntry[] = [
  {
    variant: "filled",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.46,
    reason:
      "White on teal 10; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "filled",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.33,
    reason:
      "White on orange 10; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "filled",
    intent: "bad",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.85,
    reason:
      "White on crimson 9; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "filled",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.42,
    reason:
      "White on cyan 10; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "filled",
    intent: "ok",
    scheme: "dark",
    state: "rest",
    measuredRatio: 3.07,
    reason:
      "White on teal 9; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "filled",
    intent: "warn",
    scheme: "dark",
    state: "rest",
    measuredRatio: 2.97,
    reason:
      "White on orange 9; the lowest cell in the system, under the 3.0 non-text bar too.",
  },
  {
    variant: "filled",
    intent: "bad",
    scheme: "dark",
    state: "rest",
    measuredRatio: 3.85,
    reason:
      "White on crimson 9; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "filled",
    intent: "cyan",
    scheme: "dark",
    state: "rest",
    measuredRatio: 3.0,
    reason:
      "White on cyan 9; white is what radix-ui/themes ships on this scale.",
  },
  {
    variant: "outline",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.01,
    reason:
      "teal 11 on the page ground. Step 11 is the default hue text and " +
      "radix-ui/themes designs it against its own grounds, steps 1 to 2 " +
      "on a near-white page; ours is slate 3, which costs the text bar. " +
      "Step 12 clears it and stops reading as the hue, which is the " +
      "trade this palette declines to make.",
  },
  {
    variant: "outline",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.96,
    reason:
      "orange 11 on the page ground. Step 11 is the default hue text and " +
      "radix-ui/themes designs it against its own grounds, steps 1 to 2 " +
      "on a near-white page; ours is slate 3, which costs the text bar. " +
      "Step 12 clears it and stops reading as the hue, which is the " +
      "trade this palette declines to make.",
  },
  {
    variant: "outline",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.19,
    reason:
      "cyan 11 on the page ground. Step 11 is the default hue text and " +
      "radix-ui/themes designs it against its own grounds, steps 1 to 2 " +
      "on a near-white page; ours is slate 3, which costs the text bar. " +
      "Step 12 clears it and stops reading as the hue, which is the " +
      "trade this palette declines to make.",
  },
  {
    variant: "subtle",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.01,
    reason:
      "teal 11 on the page ground, the same token and ground as the outline " +
      "variant above; subtle differs only in having no border.",
  },
  {
    variant: "subtle",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.96,
    reason:
      "orange 11 on the page ground, the same token and ground as the outline " +
      "variant above; subtle differs only in having no border.",
  },
  {
    variant: "subtle",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.19,
    reason:
      "cyan 11 on the page ground, the same token and ground as the outline " +
      "variant above; subtle differs only in having no border.",
  },
];

export function contrastDebtKey(
  entry: Pick<ContrastDebtEntry, "variant" | "intent" | "scheme" | "state">,
): string {
  return `${entry.scheme}|${entry.variant}|${entry.intent}|${entry.state}`;
}

export const CONTRAST_DEBT_BY_KEY: ReadonlyMap<string, ContrastDebtEntry> = new Map(
  KNOWN_CONTRAST_DEBT.map((entry) => [contrastDebtKey(entry), entry]),
);

/**
 * Fill-against-surface cells under the 3:1 non-text bar (WCAG 1.4.11). Same
 * ratchet as the Button ledger above: an entry may be removed or improved,
 * never worsened, and never added to admit a new below-floor fill. Every
 * `measuredRatio` here is the worst of the four surfaces (`surface-4` in
 * both schemes, confirmed strictly descending by the ramp itself), so the
 * removal check in the matrix test only needs to run there.
 */
export interface FillContrastDebtEntry {
  hue: string;
  scheme: ContrastScheme;
  measuredRatio: number;
  reason: string;
}

export const KNOWN_FILL_DEBT: readonly FillContrastDebtEntry[] = [
  {
    hue: "ok",
    scheme: "light",
    measuredRatio: 2.83,
    reason: "teal 10 on surface-4; the row surfaces closer to white still clear 3.0",
  },
  {
    hue: "warn",
    scheme: "light",
    measuredRatio: 2.72,
    reason: "orange 10, worst on surface-4 at 2.72 and also under on surface-3 at 2.93; 11 reads brown, so the fill stays at 10 and a warn fill alone must not carry meaning on either row",
  },
  {
    hue: "cyan",
    scheme: "light",
    measuredRatio: 2.80,
    reason: "cyan 10 on surface-4; the row surfaces closer to white still clear 3.0",
  },
  {
    hue: "gold",
    scheme: "light",
    measuredRatio: 1.29,
    reason: "amber 9 against every light surface; amber has no step from 9 to 10 that clears 3.0 in light, already the ruleFill exception in packages/tokens/test/invariants.test.ts. Gold's real use is text, not fill.",
  },
  {
    hue: "accent",
    scheme: "dark",
    measuredRatio: 2.77,
    reason: "indigo 9 against the dark raised ground; 10 would drop the white label under 4.5, so Radix's step 9 wins",
  },
  {
    hue: "purple",
    scheme: "dark",
    measuredRatio: 2.79,
    reason: "purple 9 against the dark raised ground; 10 would drop the white label under 4.5, so Radix's step 9 wins",
  },
];

export function fillDebtKey(entry: Pick<FillContrastDebtEntry, "hue" | "scheme">): string {
  return `${entry.scheme}|${entry.hue}`;
}

export const FILL_DEBT_BY_KEY: ReadonlyMap<string, FillContrastDebtEntry> = new Map(
  KNOWN_FILL_DEBT.map((entry) => [fillDebtKey(entry), entry]),
);

/**
 * `--line-1` under the 3.0:1 non-text bar (WCAG 1.4.11). It carries the
 * `control` role, so it bounds a UI component and is held to that bar rather
 * than to a text bar.
 *
 * Keyed per surface, not per scheme: a control edge sits on whichever ground
 * its control sits on, and an entry for one surface must not excuse another.
 */
export interface LineContrastDebtEntry {
  scheme: "light" | "dark";
  surface: 1 | 2 | 3 | 4;
  measuredRatio: number;
  reason: string;
}

export const KNOWN_LINE_DEBT: readonly LineContrastDebtEntry[] = [
  {
    scheme: "light",
    surface: 1,
    measuredRatio: 1.91,
    reason:
      "slate 8 is Radix's border step, tuned to read as a rule rather than to bound a control against white; a light control edge that clears 3.0 would be darker than any border in the scheme",
  },
  {
    scheme: "light",
    surface: 2,
    measuredRatio: 1.82,
    reason: "slate 8 on the panel ground; same border step, one rung less headroom",
  },
  {
    scheme: "light",
    surface: 3,
    measuredRatio: 1.68,
    reason: "slate 8 on the page ground; same border step, two rungs less headroom",
  },
  {
    scheme: "light",
    surface: 4,
    measuredRatio: 1.56,
    reason: "slate 8 on the chrome ground, the tightest light surface a control sits on",
  },
  {
    scheme: "dark",
    surface: 4,
    measuredRatio: 2.82,
    reason: "slate 9 control edge against the dark raised ground; clears 3.0 on page, panels and cards",
  },
];

export function lineDebtKey(
  entry: Pick<LineContrastDebtEntry, "scheme" | "surface">,
): string {
  return `${entry.scheme}|line-1|${entry.surface}`;
}

export const LINE_DEBT_BY_KEY: ReadonlyMap<string, LineContrastDebtEntry> =
  new Map(KNOWN_LINE_DEBT.map((entry) => [lineDebtKey(entry), entry]));

/**
 * `--on-fill-<hue>` labels under the 4.5:1 text bar (WCAG 1.4.3). Unlike the
 * fill ledger above, this cell has no surface: the label sits directly on
 * the fill, so one ratio per hue/scheme is the whole cell. Same ratchet
 * contract.
 */
export interface OnFillContrastDebtEntry {
  hue: string;
  scheme: ContrastScheme;
  measuredRatio: number;
  reason: string;
}

export const KNOWN_ON_FILL_DEBT: readonly OnFillContrastDebtEntry[] = [
  {
    hue: "ok",
    scheme: "light",
    measuredRatio: 3.46,
    reason:
      "white on teal 10. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "bad",
    scheme: "light",
    measuredRatio: 3.85,
    reason:
      "white on crimson 9. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "warn",
    scheme: "light",
    measuredRatio: 3.33,
    reason:
      "white on orange 10. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "cyan",
    scheme: "light",
    measuredRatio: 3.42,
    reason:
      "white on cyan 10. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "ok",
    scheme: "dark",
    measuredRatio: 3.07,
    reason:
      "white on teal 9. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "bad",
    scheme: "dark",
    measuredRatio: 3.85,
    reason:
      "white on crimson 9. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "warn",
    scheme: "dark",
    measuredRatio: 2.97,
    reason:
      "white on orange 9. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
  {
    hue: "cyan",
    scheme: "dark",
    measuredRatio: 3.0,
    reason:
      "white on cyan 9. Radix Themes sets --<scale>-contrast to white for every scale here except amber, so a solid fill carries a white label whatever it measures; a row with two label colours is the cost they decline to pay and we follow them",
  },
];

export function onFillDebtKey(entry: Pick<OnFillContrastDebtEntry, "hue" | "scheme">): string {
  return `${entry.scheme}|${entry.hue}`;
}

export const ON_FILL_DEBT_BY_KEY: ReadonlyMap<string, OnFillContrastDebtEntry> = new Map(
  KNOWN_ON_FILL_DEBT.map((entry) => [onFillDebtKey(entry), entry]),
);

/**
 * `--text-<hue>-vivid` (Radix step 11, unconditional) carries two different
 * bars depending on how it is used: a status GLYPH reads it against 3.0
 * (WCAG 1.4.11) and always clears that everywhere, so the matrix asserts
 * 3.0 unconditionally with no ledger. Running status TEXT reads it against
 * 4.5 (WCAG 1.4.3), which step 11 only reliably clears on `surface-1`; on
 * darker surfaces it is ledgered per (hue, scheme, surface) rather than per
 * hue, because the same hue clears 4.5 on one surface and misses it on the
 * next. `accent` and `purple` clear 4.5 on every surface and have no entry.
 */
export interface VividTextContrastDebtEntry {
  hue: string;
  scheme: ContrastScheme;
  surface: 1 | 2 | 3 | 4;
  measuredRatio: number;
  reason: string;
}

export const KNOWN_VIVID_TEXT_DEBT: readonly VividTextContrastDebtEntry[] = [
  { hue: "ok", scheme: "light", surface: 2, measuredRatio: 4.33, reason: "teal 11 as text on surface-2. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as ok. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "ok", scheme: "light", surface: 3, measuredRatio: 4.01, reason: "teal 11 as text on surface-3. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as ok. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "ok", scheme: "light", surface: 4, measuredRatio: 3.73, reason: "teal 11 as text on surface-4. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as ok. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "warn", scheme: "light", surface: 2, measuredRatio: 4.28, reason: "orange 11 as text on surface-2. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as warn. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "warn", scheme: "light", surface: 3, measuredRatio: 3.96, reason: "orange 11 as text on surface-3. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as warn. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "warn", scheme: "light", surface: 4, measuredRatio: 3.69, reason: "orange 11 as text on surface-4. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as warn. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "gold", scheme: "light", surface: 2, measuredRatio: 4.38, reason: "amber 11 as text on surface-2. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as gold. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "gold", scheme: "light", surface: 3, measuredRatio: 4.05, reason: "amber 11 as text on surface-3. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as gold. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "gold", scheme: "light", surface: 4, measuredRatio: 3.77, reason: "amber 11 as text on surface-4. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as gold. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "cyan", scheme: "light", surface: 3, measuredRatio: 4.18, reason: "cyan 11 as text on surface-3. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as cyan. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "cyan", scheme: "light", surface: 4, measuredRatio: 3.89, reason: "cyan 11 as text on surface-4. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as cyan. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
  { hue: "bad", scheme: "light", surface: 4, measuredRatio: 4.41, reason: "crimson 11 as text on surface-4. Light has no middle text step for this hue: step 11 misses 4.5 on the darker surfaces and step 12 is a near-black tint that stops reading as bad. Status keeps its hue at this cost; the same value as a glyph clears its own 3.0 bar" },
];

export function vividTextDebtKey(
  entry: Pick<VividTextContrastDebtEntry, "hue" | "scheme" | "surface">,
): string {
  return `${entry.scheme}|${entry.hue}|${entry.surface}`;
}

export const VIVID_TEXT_DEBT_BY_KEY: ReadonlyMap<string, VividTextContrastDebtEntry> = new Map(
  KNOWN_VIVID_TEXT_DEBT.map((entry) => [vividTextDebtKey(entry), entry]),
);
