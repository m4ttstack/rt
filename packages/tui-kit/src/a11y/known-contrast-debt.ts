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
    intent: "bad",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.169,
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
  {
    variant: "filled",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.18,
    reason:
      "arcade-refresh palette (human-approved): vivid green fill too bright for var(--bg) text at rest",
  },
  {
    variant: "filled",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.224,
    reason:
      "arcade-refresh palette (human-approved): vivid amber fill too bright for var(--bg) text at rest",
  },
  {
    variant: "filled",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.231,
    reason:
      "arcade-refresh palette (human-approved): vivid cyan fill too bright for var(--bg) text at rest",
  },
  {
    variant: "filled",
    intent: "purple",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.215,
    reason:
      "arcade-refresh palette (human-approved): purple fill just under AA for var(--bg) text at rest",
  },
  {
    variant: "default",
    intent: "bad",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.453,
    reason:
      "arcade-refresh palette (human-approved): red text on the default wash lands a hair under AA",
  },
  {
    variant: "light",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.316,
    reason:
      "arcade-refresh palette (human-approved): vivid green text on white light-variant fill under AA",
  },
  {
    variant: "light",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.56,
    reason:
      "arcade-refresh palette (human-approved): vivid amber text on white light-variant fill under AA",
  },
  {
    variant: "light",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.371,
    reason:
      "arcade-refresh palette (human-approved): vivid cyan text on white light-variant fill under AA",
  },
  {
    variant: "light",
    intent: "purple",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.479,
    reason:
      "arcade-refresh palette (human-approved): purple text on white light-variant fill a hair under AA",
  },
  {
    variant: "outline",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.812,
    reason:
      "arcade-refresh palette (human-approved): vivid green outline text under AA on the canvas",
  },
  {
    variant: "outline",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.128,
    reason:
      "arcade-refresh palette (human-approved): vivid amber outline text under AA on the canvas",
  },
  {
    variant: "outline",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.634,
    reason:
      "arcade-refresh palette (human-approved): vivid cyan outline text under AA on the canvas",
  },
  {
    variant: "outline",
    intent: "purple",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.215,
    reason:
      "arcade-refresh palette (human-approved): purple outline text a hair under AA on the canvas",
  },
  {
    variant: "subtle",
    intent: "ok",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.812,
    reason:
      "arcade-refresh palette (human-approved): vivid green subtle-variant text under AA on the canvas",
  },
  {
    variant: "subtle",
    intent: "warn",
    scheme: "light",
    state: "rest",
    measuredRatio: 3.128,
    reason:
      "arcade-refresh palette (human-approved): vivid amber subtle-variant text under AA on the canvas",
  },
  {
    variant: "subtle",
    intent: "cyan",
    scheme: "light",
    state: "rest",
    measuredRatio: 2.634,
    reason:
      "arcade-refresh palette (human-approved): vivid cyan subtle-variant text under AA on the canvas",
  },
  {
    variant: "subtle",
    intent: "purple",
    scheme: "light",
    state: "rest",
    measuredRatio: 4.215,
    reason:
      "arcade-refresh palette (human-approved): purple subtle-variant text a hair under AA on the canvas",
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
