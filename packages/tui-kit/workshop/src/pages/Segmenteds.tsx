import { LabeledSeg, SEGMENTED_PARTS, Segmented } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The Segmented (+ LabeledSeg) recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`), never a deep
 * `../../src/recipes/…` path — see Chips.tsx's identical comment.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, and the panel background / accent fill both follow through the
 * theme.
 */

type Tab = "rows" | "grid" | "light" | "dark" | "settings";
const TAB_OPTIONS: readonly Tab[] = ["rows", "grid", "light", "dark", "settings"];
const TAB_LABELS: Record<Tab, string> = {
  rows: "Rows",
  grid: "Grid",
  light: "Light",
  dark: "Dark",
  settings: "Settings",
};

const row = { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" } as const;

export function Segmenteds() {
  // Live state, so clicking an option in the workshop actually moves the
  // active fill — the interactive proof the four-file test suite already
  // covers statically.
  const [tab, setTab] = useState<Tab>("rows");
  const [labeledTab, setLabeledTab] = useState<Tab>("grid");

  return (
    <div>
      <h1>Segmented (+ LabeledSeg)</h1>
      <p>
        mr-board's icon and text segmented controls — <code>.tui-seg</code> /{" "}
        <code>.tui-seg-text</code> — as one recipe, two generic components.
        Both are typed over the caller's own option union: <code>onChange</code>{" "}
        receives the literal key, not a widened <code>string</code>.
      </p>

      <h2 style={{ marginTop: "2rem" }}>Segmented (icon glyphs)</h2>
      <p>The board's view-switch header control. Click an option.</p>
      <div style={row}>
        <Segmented options={TAB_OPTIONS} value={tab} onChange={setTab} label="board view" />
        <code style={{ color: "var(--muted)" }}>active: {tab}</code>
      </div>

      <h2 style={{ marginTop: "2rem" }}>LabeledSeg (text labels)</h2>
      <p>The board's drawer control — same shape, smaller relative text.</p>
      <div style={row}>
        <LabeledSeg
          legend="view mode"
          options={TAB_OPTIONS.slice(0, 3)}
          labels={TAB_LABELS}
          value={labeledTab}
          onChange={setLabeledTab}
        />
        <code style={{ color: "var(--muted)" }}>active: {labeledTab}</code>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every control above carries{" "}
        <code>data-part="{SEGMENTED_PARTS.root}"</code> on its group, and each
        button carries <code>data-part="{SEGMENTED_PARTS.option}"</code>. Those
        replace the hashed CSS-module class names as mr-board's cross-boundary
        selector hook: <code>.tui-seg</code> becomes{" "}
        <code>[data-part="segmented"]</code>.
      </p>
    </div>
  );
}
