import { Chip, CHIP_PARTS } from "@mattstack/tui-kit";

/**
 * The Chip recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path: the
 * workshop's job is to exercise the surface a consumer actually gets, and a
 * deep import would quietly pass even if the barrel forgot the export.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html> and every intent below follows through the theme, which is exactly
 * the behaviour worth showing for the kit's first colour-bearing recipe.
 */

/** Every intent word tuiTheme declares, in vocabulary order. */
const INTENTS = ["accent", "ok", "warn", "bad", "cyan", "purple", "muted"] as const;

/** Chip's own variant subset — the theme's `default`/`light` are deliberately not one. */
const VARIANTS = ["outline", "subtle"] as const;

const table = {
  display: "grid",
  gridTemplateColumns: "6rem repeat(6, max-content)",
  alignItems: "center",
  gap: "0.5rem 0.7rem",
  marginTop: "1rem",
} as const;

const head = { color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

const rowLabel = { color: "var(--muted)", fontSize: "var(--font-size-sm)" } as const;

const boardRow = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.4rem",
  marginTop: "1rem",
  padding: "0.7rem",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--panel)",
} as const;

export function Chips() {
  return (
    <div>
      <h1>Chip</h1>
      <p>
        The badge/flag primitive — mr-board's <code>.tui-review</code> /{" "}
        <code>.tui-flag</code> families as one recipe. Colour arrives entirely
        through the <code>intent</code> vocabulary: the theme's intent resolver
        turns a word into <code>--chip-color</code> / <code>--chip-border</code>{" "}
        / <code>--chip-hover</code>, and nothing in the stylesheet names a hue.
      </p>

      <h2 style={{ marginTop: "2rem" }}>intent × variant × modifier</h2>
      <div style={table}>
        <span style={head} />
        <span style={head}>outline</span>
        <span style={head}>subtle</span>
        <span style={head}>pulse</span>
        <span style={head}>dimmed</span>
        <span style={head}>uppercase</span>
        <span style={head}>icon</span>
        {INTENTS.map((intent) => (
          <ChipRow key={intent} intent={intent} />
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>as="button" (the clickable badge)</h2>
      <p>
        <code>.tui-review-open</code> — a saved review, an unposted respond
        draft, a held outbound note. The recipe uses the builder's own{" "}
        <code>as</code> polymorphism rather than a bespoke boolean, and keys its
        interactive styling on <code>:is(button, a)</code> so the element and
        the styling can never disagree. Hover and focus one.
      </p>
      <div style={boardRow}>
        {INTENTS.map((intent) => (
          <Chip key={intent} intent={intent} as="button">
            {intent} ↗
          </Chip>
        ))}
        {VARIANTS.map((variant) => (
          <Chip key={variant} intent="accent" variant={variant} as="a" href="#chip">
            as="a" {variant}
          </Chip>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>a real board row</h2>
      <p>
        The nine mr-board badge components this recipe absorbs, as they appear
        together on one MR row.
      </p>
      <div style={boardRow}>
        <Chip intent="muted" variant="subtle" dimmed>
          queued
        </Chip>
        <Chip intent="warn" pulse>
          reviewing
        </Chip>
        <Chip intent="ok">approved</Chip>
        <Chip intent="purple" pulse>
          drafting
        </Chip>
        <Chip intent="cyan" pulse>
          fixing
        </Chip>
        <Chip intent="accent" icon={<span>⇄</span>}>
          alice: approved
        </Chip>
        <Chip intent="accent" fw={600} icon={<span>⇄</span>}>
          nudged by bob · 2d
        </Chip>
        <Chip intent="warn" as="button" icon={<span>✉</span>}>
          held: note
        </Chip>
        <Chip intent="bad">conflicts</Chip>
        <Chip intent="muted" variant="subtle" uppercase>
          draft
        </Chip>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every chip above carries <code>data-part="{CHIP_PARTS.root}"</code>, and
        its glyph wrapper <code>data-part="{CHIP_PARTS.icon}"</code>. Those are
        the tui-kit convention that replaces the hashed CSS-module class name as
        mr-board's cross-boundary selector hook: <code>.tui-review</code>{" "}
        becomes <code>[data-part="chip"]</code>, and{" "}
        <code>.tui-badge-emoji</code> becomes{" "}
        <code>[data-part="chip-icon"]</code>.
      </p>
    </div>
  );
}

function ChipRow({ intent }: { intent: (typeof INTENTS)[number] }) {
  return (
    <>
      <span style={rowLabel}>{intent}</span>
      <Chip intent={intent}>outline</Chip>
      <Chip intent={intent} variant="subtle">
        subtle
      </Chip>
      <Chip intent={intent} pulse>
        pulse
      </Chip>
      <Chip intent={intent} dimmed>
        dimmed
      </Chip>
      <Chip intent={intent} uppercase>
        caps
      </Chip>
      <Chip intent={intent} icon={<span>⇄</span>}>
        icon
      </Chip>
    </>
  );
}
