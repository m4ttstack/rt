import { useState } from "react";
import { Button, BUTTON_PARTS, ICONS } from "@mattstack/tui-kit";

/**
 * The Button recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Chips.tsx follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html> and every intent below follows through the theme.
 */

const VARIANTS = ["outline", "subtle", "ghost"] as const;
const INTENTS = ["accent", "bad"] as const;
const SIZES = ["md", "sm"] as const;

const table = {
  display: "grid",
  gridTemplateColumns: "4rem repeat(6, max-content)",
  alignItems: "center",
  gap: "0.5rem 0.7rem",
  marginTop: "1rem",
} as const;

const head = { color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

const rowLabel = { color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", marginTop: "1rem" } as const;

export function Buttons() {
  const [clicks, setClicks] = useState(0);

  return (
    <div>
      <h1>Button</h1>
      <p>
        The kit's workhorse control — always a real <code>&lt;button&gt;</code>{" "}
        (no polymorphism). Colour arrives through the <code>intent</code>{" "}
        vocabulary, same as Chip; geometry through the <code>size</code>{" "}
        vocabulary axis, stamped as <code>data-size</code>.
      </p>

      <h2 style={{ marginTop: "2rem" }}>variant × intent, both sizes</h2>
      <div style={table}>
        <span style={head} />
        {INTENTS.flatMap((intent) =>
          VARIANTS.map((variant) => (
            <span key={`${intent}-${variant}-h`} style={head}>
              {intent} {variant}
            </span>
          )),
        )}
        {SIZES.map((size) => (
          <ButtonRow key={size} size={size} />
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>click counter (proves interactivity)</h2>
      <div style={row}>
        <Button intent="accent" onClick={() => setClicks((n) => n + 1)}>
          click me
        </Button>
        <span style={rowLabel}>clicked {clicks} time{clicks === 1 ? "" : "s"}</span>
      </div>

      <h2 style={{ marginTop: "2rem" }}>busy / iconOnly / disabled</h2>
      <div style={row}>
        <Button busy>restarting…</Button>
        <Button iconOnly aria-label="Refresh">
          {ICONS["refresh-cw"]}
        </Button>
        <Button disabled>unavailable</Button>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every button carries <code>data-part="{BUTTON_PARTS.root}"</code> —
        the tui-kit convention that replaces the hashed CSS-module class name
        as the kit's cross-boundary selector hook.
      </p>
    </div>
  );
}

function ButtonRow({ size }: { size: (typeof SIZES)[number] }) {
  return (
    <>
      <span style={rowLabel}>{size}</span>
      {INTENTS.flatMap((intent) =>
        VARIANTS.map((variant) => (
          <Button key={`${intent}-${variant}`} size={size} intent={intent} variant={variant}>
            {intent} {variant}
          </Button>
        )),
      )}
    </>
  );
}
