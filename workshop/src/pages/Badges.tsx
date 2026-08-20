import { Badge, BADGE_PARTS, ICONS, Spinner } from "@mattstack/tui-kit";

/**
 * The Badge recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule StatusDots.tsx/Spinners.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the four intent tones hold up in both
 * schemes.
 */

const INTENTS = ["ok", "warn", "bad", "muted"] as const;

const row = { display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "1rem" } as const;

export function Badges() {
  return (
    <div>
      <h1>Badge</h1>
      <p>
        A filled status pill — the loud sibling of Chip. <code>intent</code>{" "}
        maps DIRECTLY to the same <code>--green</code>/<code>--amber</code>/
        <code>--red</code>/<code>--muted</code> family tokens Chip's{" "}
        <code>intent</code> vocabulary reaches for, but bypasses the theme's
        intent resolver so the pill's own tint/border contrast budget stays
        independent of Chip's.
      </p>

      <h2 style={{ marginTop: "2rem" }}>the four intents</h2>
      <div style={row}>
        {INTENTS.map((intent) => (
          <Badge key={intent} intent={intent}>
            {intent}
          </Badge>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>deck health shapes</h2>
      <p>The three states a deck health row actually renders.</p>
      <div style={row}>
        <Badge intent="ok" title="HTTP 200">
          200 34ms
        </Badge>
        <Badge intent="bad">unreachable</Badge>
        <Badge intent="warn">
          <Spinner size="xs" /> restarting…
        </Badge>
      </div>

      <h2 style={{ marginTop: "2rem" }}>with an icon glyph</h2>
      <div style={row}>
        <Badge intent="bad">{ICONS["triangle-alert"]} unreachable</Badge>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every pill carries <code>data-part="{BADGE_PARTS.root}"</code> — the
        tui-kit convention that replaces the hashed CSS-module class name as
        the kit's cross-boundary selector hook.
      </p>
    </div>
  );
}
