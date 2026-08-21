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

// Emptied by the contrast-retune ruling: every cell that was here now clears
// the plain 4.5 floor via intent-resolver.ts's per-intent `color` retune (see
// its header comment) — see contrast-retune-report.md for the before/after
// ratios. Left as an empty array, not deleted, so the ratchet contract above
// still has somewhere to record future debt.
export const KNOWN_CONTRAST_DEBT: readonly ContrastDebtEntry[] = [];

export function contrastDebtKey(
  entry: Pick<ContrastDebtEntry, "variant" | "intent" | "scheme" | "state">,
): string {
  return `${entry.scheme}|${entry.variant}|${entry.intent}|${entry.state}`;
}

export const CONTRAST_DEBT_BY_KEY: ReadonlyMap<string, ContrastDebtEntry> = new Map(
  KNOWN_CONTRAST_DEBT.map((entry) => [contrastDebtKey(entry), entry]),
);
