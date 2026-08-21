import { LISTGROUP_PARTS, ListGroup } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The ListGroup recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule Switches.tsx/Fields.tsx follow.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what the panel/divider tokens follow through the theme.
 */

const column = { display: "flex", flexDirection: "column", gap: "1.2rem", marginTop: "1rem", maxWidth: "26rem" } as const;

export function ListGroups() {
  const [darkMode, setDarkMode] = useState(true);
  const [notifications, setNotifications] = useState(false);
  const [slug, setSlug] = useState("mr-board");
  const [restarting, setRestarting] = useState(false);

  return (
    <div>
      <h1>ListGroup</h1>
      <p>
        Grouped settings rows — Nav, Toggle, Action, Fact, Input and Danger —
        in a bordered panel, the deck drawer's row surface. Colour comes from
        the same <code>--panel</code>/<code>--border</code>/
        <code>--border-soft</code> family Table/Modal use, never a
        white-card-on-grey iOS treatment.
      </p>

      <h2 style={{ marginTop: "2rem" }}>every row variant, with a footer</h2>
      <div style={column}>
        <ListGroup footer="Changes apply immediately.">
          <ListGroup.Nav label="Region" value="us-east-1" onClick={() => {}} />
          <ListGroup.Nav label="Billing" onClick={() => {}} disabled />
          <ListGroup.Toggle label="Dark mode" checked={darkMode} onChange={() => setDarkMode((v) => !v)} />
          <ListGroup.Toggle
            label="Notifications"
            checked={notifications}
            onChange={() => setNotifications((v) => !v)}
          />
          <ListGroup.Fact label="Plan" value="Pro" />
          <ListGroup.Input label="Slug" value={slug} onChange={(ev) => setSlug(ev.target.value)} />
          <ListGroup.Input label="Slug (locked)" value="mr-board" onChange={() => {}} disabled />
        </ListGroup>
      </div>

      <h2 style={{ marginTop: "2rem" }}>Action / Danger</h2>
      <p>
        <code>intent</code> is <code>"accent"</code> or <code>"bad"</code> —
        a recipe-local tone map, not the shared Button resolver.{" "}
        <code>Danger</code> is sugar for <code>Action</code> with intent
        locked to <code>"bad"</code> and rendered centered.
      </p>
      <div style={column}>
        <ListGroup>
          <ListGroup.Action label="Manage subscription" onClick={() => {}} intent="accent" />
          <ListGroup.Action
            label={restarting ? "Restarting…" : "Restart service"}
            onClick={() => setRestarting(true)}
            busy={restarting}
          />
          <ListGroup.Action label="Disabled action" onClick={() => {}} disabled />
          <ListGroup.Danger label="Delete workspace" onClick={() => {}} />
        </ListGroup>
      </div>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        The panel root carries <code>data-part="{LISTGROUP_PARTS.root}"</code>,
        the row list <code>data-part="{LISTGROUP_PARTS.list}"</code>, and a
        footer sentence <code>data-part="{LISTGROUP_PARTS.footer}"</code> —
        each row carries its own part
        (<code>{LISTGROUP_PARTS.nav}</code>, <code>{LISTGROUP_PARTS.toggle}</code>,{" "}
        <code>{LISTGROUP_PARTS.action}</code>, <code>{LISTGROUP_PARTS.fact}</code>,{" "}
        <code>{LISTGROUP_PARTS.input}</code>) — the tui-kit convention that
        replaces the hashed CSS-module class name as the kit's cross-boundary
        selector hook.
      </p>
    </div>
  );
}
