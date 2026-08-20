import { SWITCH_PARTS, Switch } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The Switch recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule SelectBoxes.tsx/Badges.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what the accent/muted track washes follow through the
 * theme.
 */

const row = { display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" } as const;
const column = { display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "1rem" } as const;

interface DeckRow {
  id: string;
  name: string;
  published: boolean;
}

export function Switches() {
  // Live state, so clicking actually slides the thumb — the interactive
  // proof the four-file test suite already covers statically.
  const [decks, setDecks] = useState<DeckRow[]>([
    { id: "a", name: "mr-board", published: true },
    { id: "b", name: "mattari", published: false },
  ]);
  const [passwordProtected, setPasswordProtected] = useState(false);

  return (
    <div>
      <h1>Switch</h1>
      <p>
        A controlled <code>role="switch"</code> toggle. The input's{" "}
        <code>checked</code> always reflects the <code>checked</code> prop —
        a click that flips the DOM natively is snapped back the moment
        React's own controlled-input contract runs, so a caller whose action
        fails and never calls its own setter gets the correction for free.
        That replaces the old board's manual <code>ev.target.checked</code>{" "}
        snap-back hack.
      </p>

      <h2 style={{ marginTop: "2rem" }}>a deck publish column</h2>
      <p>Each row's switch is labelled only for assistive tech, via <code>aria-label</code>.</p>
      <div style={column}>
        {decks.map((deck) => (
          <div key={deck.id} style={row}>
            <Switch
              checked={deck.published}
              onChange={(ev) =>
                setDecks((rows) =>
                  rows.map((r) => (r.id === deck.id ? { ...r, published: ev.target.checked } : r)),
                )
              }
              aria-label={`toggle ${deck.name} published`}
              title={deck.published ? "published" : "unpublished"}
            />
            <span>{deck.name}</span>
            <code style={{ color: "var(--muted)" }}>
              {deck.published ? "published" : "unpublished"}
            </code>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: "2rem" }}>a visible label</h2>
      <div style={row}>
        <Switch
          checked={passwordProtected}
          onChange={(ev) => setPasswordProtected(ev.target.checked)}
          label="Password protected"
        />
      </div>

      <h2 style={{ marginTop: "2rem" }}>disabled</h2>
      <div style={row}>
        <Switch checked={false} onChange={() => {}} aria-label="disabled off" disabled />
        <Switch checked={true} onChange={() => {}} aria-label="disabled on" disabled />
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        The label root carries <code>data-part="{SWITCH_PARTS.root}"</code>,
        the input <code>data-part="{SWITCH_PARTS.control}"</code>, and its
        visible label text <code>data-part="{SWITCH_PARTS.label}"</code> —
        the tui-kit convention that replaces the hashed CSS-module class name
        as the kit's cross-boundary selector hook.
      </p>
    </div>
  );
}
