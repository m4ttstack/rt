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
  reason: string;
}

export const KNOWN_CONTRAST_DEBT: readonly ContrastDebtEntry[] = [
  {
    variant: "filled",
    intent: "accent",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.781,
    reason:
      "filled text is var(--bg) by design (gate solid tier); tone too mid-luminance for AA at rest",
  },
  {
    variant: "filled",
    intent: "bad",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.659,
    reason:
      "filled text is var(--bg) by design (gate solid tier); tone too mid-luminance for AA at rest",
  },
  {
    variant: "filled",
    intent: "muted",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.948,
    reason:
      "filled text is var(--bg) by design (gate solid tier); tone too mid-luminance for AA at rest",
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
