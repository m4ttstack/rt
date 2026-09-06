import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Panel.module.css";

/** Authoring category (1 = pure styled primitive, with internal lifecycle).
    Read off this module by scripts/derive.ts to build the kit's manifest. */
export const recipeCategory = 1 as const;

/** `body` is the unclassed content wrapper mr-board renders as a bare `<div>`;
    it gets a slot here so a consumer can target it without an ancestor. */
const PANEL_SELECTORS = ["root", "title", "caret", "count", "body"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. */
export const PANEL_PARTS = {
  root: "panel",
  title: "panel-title",
  caret: "panel-caret",
  count: "panel-count",
  body: "panel-body",
} as const;

/** The kit's own default, deliberately NOT mr-board's legacy
    `"mrs-panel-collapsed"`: a fresh consumer should not carry the board's
    namespace. mr-board passes its legacy key explicitly at its call site. */
const PANEL_DEFAULT_STORAGE_KEY = "tui-panel-collapsed";

/**
 * Storage format, preserved byte-for-byte from mr-board: a JSON array of
 * collapsed panel TITLES under one key. Changing the shape would silently
 * orphan every existing `mrs-panel-collapsed` value the moment a consumer
 * passes it as `storageKey`, so this is a hard compatibility constraint.
 */
function readCollapsed(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((s) => typeof s === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(storageKey: string, set: Set<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...set]));
  } catch {
    // Storage full or blocked; the panel just won't remember its state.
  }
}

/** The title slot's em-relative literals, verbatim from mr-board. They cannot
    be theme rungs (an em is relative to the element's own font size) but still
    need a `var()` outlet to pass the CSS gate. */
const PANEL_TITLE_SCALARS: Record<string, string> = {
  "--panel-title-offset": "-0.72em",
  "--panel-title-tracking": "0.04em",
  "--panel-title-gap": "0.35em",
};

/** Panel's own props; `PanelProps` below is the full public surface. */
export interface PanelOwnProps {
  /** The panel's label AND the key its collapsed state is persisted under —
      see `readCollapsed`. A straight port of mr-board's constraint. */
  title: string;
  /** The count badge rendered beside the title. */
  count: number;
  /** The localStorage key the collapsed-titles set is persisted under.
      Defaults to the kit's own key, not mr-board's legacy one. */
  storageKey?: string;
  children?: ReactNode;
}

type PanelProps_ = PanelOwnProps & Omit<HTMLAttributes<HTMLElement>, "ref" | "children">;

export const Panel = defineComponent<PanelProps_, typeof PANEL_SELECTORS, readonly [], readonly []>({
  name: "Panel",
  selectors: PANEL_SELECTORS,
  classes,
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: Panel declares no `variants`.
  vars: () => ({
    title: { ...PANEL_TITLE_SCALARS },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      title,
      count,
      storageKey = PANEL_DEFAULT_STORAGE_KEY,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // Read-once-on-mount-via-effect is a straight port: the first render assumes
    // expanded, then an effect corrects it from storage. Kept verbatim so a
    // first-paint frame matches mr-board rather than being "improved" into a
    // synchronous initializer the board never had.
    const [collapsed, setCollapsed] = useState(false);
    useEffect(() => {
      setCollapsed(readCollapsed(storageKey).has(title));
    }, [title, storageKey]);

    const toggle = () => {
      const next = !collapsed;
      setCollapsed(next);
      const set = readCollapsed(storageKey);
      if (next) set.add(title);
      else set.delete(title);
      writeCollapsed(storageKey, set);
    };

    const bodyId = `panel-body-${title}`;

    return (
      <section
        // No ref cast: `<section>` maps to HTMLElement in React's own JSX
        // typing, which is exactly what the render ctx supplies.
        ref={ref}
        {...rest}
        {...getStyles("root")}
        data-part={PANEL_PARTS.root}
        data-collapsed={collapsed || undefined}
      >
        <button
          type="button"
          {...getStyles("title")}
          data-part={PANEL_PARTS.title}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span {...getStyles("caret")} data-part={PANEL_PARTS.caret} aria-hidden>
            {collapsed ? "▸" : "▾"}
          </span>
          {title} <span {...getStyles("count")} data-part={PANEL_PARTS.count}>{count}</span>
        </button>
        {!collapsed && (
          <div id={bodyId} {...getStyles("body")} data-part={PANEL_PARTS.body}>
            {children}
          </div>
        )}
      </section>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type PanelProps = ComponentProps<typeof Panel>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const panelTheme = Panel.extend({});
