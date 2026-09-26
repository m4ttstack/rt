import { ALERT_PARTS, Alert } from "@mattstack/tui-kit";

/**
 * The Alert recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Badges.tsx/StatusDots.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the two intent tones hold up in both schemes.
 */

const stack = { display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "1rem" } as const;

export function Alerts() {
  return (
    <div>
      <h1>Alert</h1>
      <p>
        A <code>role="alert"</code> callout. Unlike Badge's optional
        four-value <code>intent</code>, Alert's <code>intent</code> is{" "}
        <strong>required</strong> — both deck call sites (a proxy notice, a
        modal form error) always know their intent, so there is no sane
        default to fall back to.
      </p>

      <h2 style={{ marginTop: "2rem" }}>the two intents</h2>
      <div style={stack}>
        <Alert intent="ok">connected to mattstack</Alert>
        <Alert intent="bad">form could not be saved</Alert>
      </div>

      <h2 style={{ marginTop: "2rem" }}>with a command block</h2>
      <p>
        The <code>command</code> prop renders a{" "}
        <code>{`<pre data-part="${ALERT_PARTS.command}">`}</code> below the
        children — omitted entirely when not given. The deck proxy notice
        uses this shape.
      </p>
      <div style={stack}>
        <Alert intent="bad" command="npm install -g mattstack">
          your CLI is out of date — update with:
        </Alert>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every alert carries <code>data-part="{ALERT_PARTS.root}"</code> — the
        tui-kit convention that replaces the hashed CSS-module class name as
        the kit's cross-boundary selector hook.
      </p>
    </div>
  );
}
