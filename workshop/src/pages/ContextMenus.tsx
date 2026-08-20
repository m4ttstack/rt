import { CONTEXTMENU_PARTS, ContextMenu } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The ContextMenu recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule every other page follows.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, which is what proves the card surface, the two-layer drop shadow and
 * the accent hover wash hold up in both schemes.
 *
 * THE DEMO IS DRIVEN BY A REAL RIGHT-CLICK rather than rendered permanently,
 * for two reasons that are both properties of the recipe: the menu dismisses
 * itself on any outside mousedown (a permanently-mounted one would vanish the
 * moment you touched the page), and its whole job is to clamp a CURSOR point
 * into the viewport — which only means something if the point is a real one.
 * Right-click near the bottom-right corner of the strip to watch the clamp.
 */

interface Point {
  x: number;
  y: number;
}

const strip = {
  display: "grid",
  placeItems: "center",
  height: "220px",
  marginTop: "0.6rem",
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-lg)",
  background: "var(--panel)",
  color: "var(--muted)",
} as const;

export function ContextMenus() {
  const [at, setAt] = useState<Point | null>(null);
  const [log, setLog] = useState<string>("nothing clicked yet");
  const [marked, setMarked] = useState(false);

  return (
    <div>
      <h1>ContextMenu</h1>
      <p>
        mr-board's <code>.tui-menu*</code> row action menu, as the kit's only{" "}
        <code>defineCompound</code> recipe: the consumer imports and orders{" "}
        <code>ContextMenu.Item</code>, <code>ContextMenu.Label</code> and{" "}
        <code>ContextMenu.Separator</code> itself. The recipe owns only the
        shell — the measured clamp into the viewport, and dismissal on Escape,
        outside mousedown, scroll and resize.
      </p>

      <h2 style={{ marginTop: "2rem" }}>a board row menu</h2>
      <p>
        Right-click anywhere in the strip. Try the corners: the menu is anchored
        at the cursor, then measured and clamped so it never leaves the viewport
        by less than 8px on any edge.
      </p>
      <div
        style={strip}
        onContextMenu={(e) => {
          e.preventDefault();
          setAt({ x: e.clientX, y: e.clientY });
        }}
      >
        right-click me
      </div>
      <p style={{ color: "var(--muted)", fontSize: "var(--font-size-md)" }}>
        last action: <code>{log}</code>
      </p>

      {at && (
        <ContextMenu x={at.x} y={at.y} ariaLabel="actions for !4821" onClose={() => setAt(null)}>
          <ContextMenu.Label>!4821</ContextMenu.Label>
          <ContextMenu.Item
            label="review"
            hint="herdr"
            onClick={() => {
              setLog("review");
              setAt(null);
            }}
          />
          <ContextMenu.Item
            label="mark as draft"
            hint="gitlab"
            onClick={() => {
              setLog("mark as draft");
              setAt(null);
            }}
          />
          <ContextMenu.Item
            label="open in gitlab"
            onClick={() => {
              setLog("open in gitlab");
              setAt(null);
            }}
          />
          <ContextMenu.Separator />
          {/* The Slack marks are mr-board's one family of items that
              deliberately do NOT close the menu — several marks get set in one
              visit. `trailing` carries the ✓; the recipe never closes itself on
              an item click, so this works with no opt-out. */}
          <ContextMenu.Item
            label={marked ? "unmark ✅ on slack" : "mark ✅ on slack"}
            trailing={
              marked ? <span style={{ color: "var(--dot-ok)" }}>✓</span> : undefined
            }
            onClick={() => {
              setMarked((v) => !v);
              setLog(marked ? "unmarked ✅" : "marked ✅");
            }}
          />
          <ContextMenu.Item label="mark 👀 on slack" disabled onClick={() => setLog("never")} />
        </ContextMenu>
      )}

      <h2 style={{ marginTop: "2rem" }}>what the recipe does NOT do</h2>
      <ul>
        <li>
          It never closes itself when an item is clicked — closing after an
          action is the caller's decision (see the ✅ item above).
        </li>
        <li>
          It has no note mode. mr-board's alt-click launch-note textarea stays
          app-side and renders inside <code>children</code>.
        </li>
        <li>
          It styles no <code>trailing</code> node. The ✓ and the spinner are
          board chrome the caller supplies.
        </li>
      </ul>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        Every slot carries its own <code>data-part</code> — the tui-kit
        convention that replaces the hashed CSS-module class name as mr-board's
        cross-boundary selector hook:
      </p>
      <ul>
        <li>
          <code>.tui-menu</code> becomes <code>[data-part="{CONTEXTMENU_PARTS.root}"]</code>
        </li>
        <li>
          <code>.tui-menu-item</code> becomes{" "}
          <code>[data-part="{CONTEXTMENU_PARTS.item}"]</code>
        </li>
        <li>
          <code>.tui-menu-label</code> becomes{" "}
          <code>[data-part="{CONTEXTMENU_PARTS.label}"]</code>
        </li>
        <li>
          <code>.tui-menu-sep</code> becomes{" "}
          <code>[data-part="{CONTEXTMENU_PARTS.separator}"]</code>
        </li>
        <li>
          <code>.tui-menu-hint</code> becomes{" "}
          <code>[data-part="{CONTEXTMENU_PARTS.hint}"]</code>
        </li>
      </ul>
    </div>
  );
}
