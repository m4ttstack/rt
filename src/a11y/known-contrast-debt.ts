/**
 * Ledger of Button (intent, variant, scheme) rest-state cells that measure
 * below WCAG AA (4.5:1) under the human-approved Tokyo Day/Night look. These
 * are PRE-EXISTING properties of that approved look, not regressions
 * introduced by the contrast-matrix gate; retuning the theme's tones is a
 * design decision reserved for a human (it would also re-baseline most of
 * Button.parity.test.tsx's oracle, which this ledger deliberately leaves
 * untouched pending that direction).
 *
 * RATCHET CONTRACT (enforced by Button.matrix.test.tsx, not here): an
 * entry's `measuredRatio` may only be REMOVED (the cell was fixed and now
 * clears 4.5) or IMPROVED (a smaller regression than recorded) — never
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
}

export const KNOWN_CONTRAST_DEBT: readonly ContrastDebtEntry[] = [
  // Light scheme — 17 of this scheme's 28 cells.
  { variant: "default", intent: "bad", scheme: "light", state: "rest", measuredRatio: 3.416 },
  { variant: "light", intent: "accent", scheme: "light", state: "rest", measuredRatio: 3.728 },
  { variant: "light", intent: "warn", scheme: "light", state: "rest", measuredRatio: 4.499 },
  { variant: "light", intent: "bad", scheme: "light", state: "rest", measuredRatio: 3.607 },
  { variant: "light", intent: "muted", scheme: "light", state: "rest", measuredRatio: 2.906 },
  { variant: "outline", intent: "accent", scheme: "light", state: "rest", measuredRatio: 3.106 },
  { variant: "outline", intent: "ok", scheme: "light", state: "rest", measuredRatio: 4.04 },
  { variant: "outline", intent: "warn", scheme: "light", state: "rest", measuredRatio: 3.749 },
  { variant: "outline", intent: "bad", scheme: "light", state: "rest", measuredRatio: 3.005 },
  { variant: "outline", intent: "cyan", scheme: "light", state: "rest", measuredRatio: 4.262 },
  { variant: "outline", intent: "muted", scheme: "light", state: "rest", measuredRatio: 2.422 },
  { variant: "subtle", intent: "accent", scheme: "light", state: "rest", measuredRatio: 3.106 },
  { variant: "subtle", intent: "ok", scheme: "light", state: "rest", measuredRatio: 4.04 },
  { variant: "subtle", intent: "warn", scheme: "light", state: "rest", measuredRatio: 3.749 },
  { variant: "subtle", intent: "bad", scheme: "light", state: "rest", measuredRatio: 3.005 },
  { variant: "subtle", intent: "cyan", scheme: "light", state: "rest", measuredRatio: 4.262 },
  { variant: "subtle", intent: "muted", scheme: "light", state: "rest", measuredRatio: 2.422 },
  // Dark scheme — 1 of this scheme's 28 cells.
  { variant: "light", intent: "muted", scheme: "dark", state: "rest", measuredRatio: 3.466 },
];

export function contrastDebtKey(
  entry: Pick<ContrastDebtEntry, "variant" | "intent" | "scheme" | "state">,
): string {
  return `${entry.scheme}|${entry.variant}|${entry.intent}|${entry.state}`;
}

export const CONTRAST_DEBT_BY_KEY: ReadonlyMap<string, ContrastDebtEntry> = new Map(
  KNOWN_CONTRAST_DEBT.map((entry) => [contrastDebtKey(entry), entry]),
);
