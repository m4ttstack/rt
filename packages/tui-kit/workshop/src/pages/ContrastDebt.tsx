import { Button, type ButtonProps } from "@mattstack/tui-kit";
import { KNOWN_CONTRAST_DEBT, type ContrastDebtEntry } from "@mattstack/tui-kit/a11y/known-contrast-debt";

/**
 * Decision sheet for src/a11y/known-contrast-debt.ts's ratchet ledger:
 * renders every recorded WCAG-AA-failing Button cell against the REAL
 * Tokyo theme so a human can eyeball whether to retune the theme's tones
 * or accept the debt. Not a showcase page — no interactivity beyond that.
 *
 * The dark section is scoped with its own `.dark`-classed wrapper (the
 * mechanism Button.visual.test.tsx uses to mount a fixture under dark
 * without flipping the whole document), independent of the sidebar's
 * global dark toggle, so light and dark ledger rows are visible side by
 * side in one screenful.
 */

const AT_RISK_LABEL = "at-risk demo";

const wrapper = { marginTop: "1rem" } as const;

const darkSurface = {
  background: "var(--bg)",
  color: "var(--fg)",
  padding: "1rem",
  borderRadius: "var(--radius-md)",
} as const;

const table = {
  display: "grid",
  gridTemplateColumns: "10rem max-content max-content max-content",
  alignItems: "center",
  gap: "0.6rem 1.2rem",
  marginTop: "0.75rem",
} as const;

const head = { color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

const cellLabel = { fontSize: "var(--font-size-sm)" } as const;

const stateNote = { color: "var(--muted)", fontSize: "var(--font-size-xs)" } as const;

const ratio = { color: "var(--red)", fontWeight: 600 } as const;

const failingOutline = { outline: "2px solid var(--red)", outlineOffset: "2px" } as const;

function entryKey(entry: ContrastDebtEntry): string {
  return `${entry.scheme}|${entry.variant}|${entry.intent}|${entry.state}`;
}

function DebtRow({ entry }: { entry: ContrastDebtEntry }) {
  // The ledger's `variant`/`intent` are plain `string` (decoupled from the
  // theme so the ledger file doesn't import it) — narrow to Button's own
  // vocabulary literals here, at the one call site that needs it.
  const variant = entry.variant as ButtonProps["variant"];
  const intent = entry.intent as ButtonProps["intent"];
  // ButtonInteractionState is a `"rest"`-only union today (every recorded
  // cell fails at rest) — comparing against the string form keeps this
  // emphasis logic correct if a future hover-only entry widens that union,
  // instead of silently doing nothing for it.
  const state: string = entry.state;
  const restFails = state === "rest";
  const hoverFails = state === "hover";

  return (
    <>
      <span style={cellLabel}>
        {entry.variant} / {entry.intent}
        <br />
        <span style={stateNote}>fails at {entry.state}</span>
      </span>
      <Button variant={variant} intent={intent} style={restFails ? failingOutline : undefined}>
        {AT_RISK_LABEL}
      </Button>
      <Button
        variant={variant}
        intent={intent}
        style={{
          background: "var(--button-hover)",
          ...(hoverFails ? failingOutline : undefined),
        }}
      >
        {AT_RISK_LABEL} (hover)
      </Button>
      <span style={ratio}>{entry.measuredRatio.toFixed(3)} : 1 — needs 4.5</span>
    </>
  );
}

function DebtTable({ entries }: { entries: readonly ContrastDebtEntry[] }) {
  return (
    <div style={table}>
      <span style={head}>cell</span>
      <span style={head}>rest</span>
      <span style={head}>hover</span>
      <span style={head}>measured ratio</span>
      {entries.map((entry) => (
        <DebtRow key={entryKey(entry)} entry={entry} />
      ))}
    </div>
  );
}

export function ContrastDebt() {
  const light = KNOWN_CONTRAST_DEBT.filter((entry) => entry.scheme === "light");
  const dark = KNOWN_CONTRAST_DEBT.filter((entry) => entry.scheme === "dark");

  return (
    <div>
      <h1>Contrast debt</h1>
      <p>
        Every cell in <code>src/a11y/known-contrast-debt.ts</code>'s ratchet
        ledger, rendered live against the real Tokyo theme, so the failure
        can be judged by eye rather than by number alone. The ledger records
        (variant, intent, scheme) combinations that measure below WCAG AA's
        4.5:1 under the human-approved Tokyo Day/Night look — pre-existing
        properties of that approved look, not regressions. Retuning the
        theme's tones to clear these versus accepting the debt is a pending
        design decision reserved for a human; this page exists to inform
        that call, not to make it.
      </p>
      <p>
        Each ledger entry carries a <code>state</code> field: <code>rest</code>{" "}
        or <code>hover</code>, naming which interaction state the recorded
        ratio was measured at. The row label below each cell repeats that
        state so it's clear which of the two renditions — rest or hover — is
        the one actually failing.
      </p>

      <h2 style={wrapper}>Light scheme ({light.length} cells)</h2>
      <DebtTable entries={light} />

      <h2 style={wrapper}>Dark scheme ({dark.length} cells)</h2>
      <div style={darkSurface} className="dark">
        <DebtTable entries={dark} />
      </div>
    </div>
  );
}
