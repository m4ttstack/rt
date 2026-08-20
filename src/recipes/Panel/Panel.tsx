import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { defineComponent } from "../../builders.ts";
import classes from "./Panel.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 1 = pure styled primitive (§ 2.1) with internal lifecycle (the collapsed/
 * expanded toggle + its localStorage persistence are state the recipe owns
 * end to end, the same "internal, not caller-controlled" shape CopyButton's
 * copied-flash timer has). `defineComponent`, not `definePolymorphicComponent`:
 * mr-board's Panel is always a `<section>` wrapping a `<button>` title — there
 * is no other element this would ever render as, the same criterion Icon's
 * svg root and StatusDot's span wrap both cite.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 1 as const;

/**
 * The recipe's style slots, matching mr-board's `.tui-panel*` family
 * one-for-one: `root` (`.tui-panel`), `title` (`.tui-panel-title`, the
 * clickable border label), `caret` (`.tui-panel-caret`, the ▾/▸ glyph),
 * `count` (`.tui-panel-count`), `body` (the unclassed content wrapper —
 * mr-board's version renders a bare `<div>` there, but the recipe styles it
 * as its own slot so a consumer can target it without an ancestor selector).
 */
const PANEL_SELECTORS = ["root", "title", "caret", "count", "body"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief: the brief names only `title`; the full self-identifying set
 * below is what actually ships). Self-identifying per §5's naming rule, so
 * each value works standing alone from mr-board's residual `style.css`
 * without needing an ancestor to disambiguate which recipe it is:
 *
 *   root slot  -> "panel"        (the drop-in replacement for `.tui-panel`)
 *   title slot -> "panel-title"  (`.tui-panel-title`)
 *   caret slot -> "panel-caret"  (`.tui-panel-caret`)
 *   count slot -> "panel-count"  (`.tui-panel-count`)
 *   body slot  -> "panel-body"   (mr-board's unclassed content `<div>`)
 *
 * Exported (not module-private, unlike Icon's single value): five slots means
 * the adoption pass needs the full selector list, the same reason
 * STATUSDOT_PARTS/SEGMENTED_PARTS are exported rather than module-private.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` is stamped in
 * the NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Chip.tsx's identical comment for the failure mode this closes.
 * Pinned by Panel.test.tsx's "a consumer-supplied data-part does not win".
 */
export const PANEL_PARTS = {
  root: "panel",
  title: "panel-title",
  caret: "panel-caret",
  count: "panel-count",
  body: "panel-body",
} as const;

/**
 * The kit's OWN default storage key, distinct from mr-board's legacy one.
 * mr-board's `src/client/ui/Panel.tsx` hardcodes `PANEL_STATE_KEY =
 * "mrs-panel-collapsed"`; the recipe does not inherit that string as its
 * default (a fresh consumer with no board history should not carry the
 * board's own namespace prefix). mr-board's OWN call site is the one that
 * passes `storageKey="mrs-panel-collapsed"` at adoption, so its users' already
 * -persisted collapsed state keeps reading and writing under the same key
 * it always has — see Panel.test.tsx's "honours a caller-supplied
 * storageKey" for the round-trip proof.
 */
const PANEL_DEFAULT_STORAGE_KEY = "tui-panel-collapsed";

/**
 * STORAGE FORMAT, preserved byte-for-byte from mr-board's
 * `readCollapsed`/`writeCollapsed`: a JSON array of collapsed panel TITLES
 * under one storage key, keyed on title alone (mr-board's own comment: "group
 * labels are unique within a grouping and it's fine if switching groupings
 * orphans keys" — carried forward unchanged, not revisited here). Changing
 * the shape (e.g. to an object, or per-panel keys) would silently orphan
 * every mr-board user's existing `mrs-panel-collapsed` value the moment they
 * pass it as `storageKey`, so this is a hard compatibility constraint, not a
 * style choice.
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
    // storage full or blocked; the panel just won't remember its state —
    // verbatim from mr-board's own writeCollapsed.
  }
}

/**
 * The title slot's three em-based literals, routed through a recipe scalar
 * per the § 6 dimension-record pattern's sibling rule for em values
 * (src/theme.ts: "em-based spacing stays inline in recipe CSS on purpose...
 * deliberately relative to the element's own font size and cannot be a
 * global rung"). None of the three is a raw-literal gate exemption either
 * (`test/no-hardcoded-values.test.ts`'s `LENGTH_LITERAL` has no `em`
 * exemption the way it does for `0`/`1px`/`2px`/`100%`), so each needs an
 * outlet — the same "recipe scalar via vars" pattern StatusDot's
 * `--sd-tooltip-offset` and Chip's `CHIP_SCALARS` use for their own em
 * values:
 *
 *   -0.72em -> `.tui-panel-title`'s `top` (the border-label vertical hang)
 *   0.04em  -> `.tui-panel-title`'s `letter-spacing`
 *   0.35em  -> `.tui-panel-title`'s `gap` (caret-to-label spacing)
 *
 * Unconditional (not keyed by props), so always present the same way
 * StatusDot's `STATUSDOT_SCALARS` are.
 */
const PANEL_TITLE_SCALARS: Record<string, string> = {
  "--panel-title-offset": "-0.72em",
  "--panel-title-tracking": "0.04em",
  "--panel-title-gap": "0.35em",
};

/**
 * The recipe's OWN props. The full public surface is `PanelProps` below:
 * this, plus every section attribute, plus the Styles API and the universal
 * style props the builder adds for free.
 */
export interface PanelOwnProps {
  /**
   * The panel's label AND the persistence key mr-board's own version keys
   * collapsed state on (see `readCollapsed`'s doc comment) — a straight port
   * of that constraint, not a new one this recipe introduces.
   */
  title: string;
  /** The count badge rendered beside the title. */
  count: number;
  /**
   * The localStorage key the collapsed-titles set is persisted under.
   * Defaults to the kit's OWN `"tui-panel-collapsed"` — see
   * `PANEL_DEFAULT_STORAGE_KEY`'s comment for why that is not mr-board's
   * legacy string, and how a consumer opts into the legacy one instead.
   */
  storageKey?: string;
  children?: ReactNode;
}

type PanelProps_ = PanelOwnProps & Omit<HTMLAttributes<HTMLElement>, "ref" | "children">;

export const Panel = defineComponent<PanelProps_, typeof PANEL_SELECTORS, readonly [], readonly []>({
  name: "Panel",
  selectors: PANEL_SELECTORS,
  classes,
  // A RECIPE-SUPPLIED `vars` RESOLVER REPLACES THE BUILDER'S AUTOMATIC
  // autoVars CALL (skill § 4 + § 10) — but Panel declares no `variants`, so
  // there is no auto-derived output to preserve/merge here (task-8-report.md
  // § 4's second corollary): this `vars` key is only the title slot's three
  // em scalars, nothing to merge in.
  vars: () => ({
    title: { ...PANEL_TITLE_SCALARS },
  }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same
    // way every prior recipe strips them. No vocabulary-axis destructure is
    // needed: Panel opts into no axes.
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

    // useState/useEffect-free-of-caveats local state: `render` runs inside
    // the builder's own forwardRef function-component body on every render
    // (see define-component.tsx and CopyButton.tsx's identical comment), so
    // hooks called here obey the rules of hooks exactly as if written
    // directly in a function component.
    //
    // The read-once-on-mount-via-effect shape is a STRAIGHT PORT of
    // mr-board's own Panel: initial render assumes expanded (`false`), then
    // an effect corrects it from storage. Verbatim, not a new choice —
    // preserving it means a server-rendered or first-paint frame matches
    // mr-board's own behaviour rather than "improving" it into a
    // synchronous initializer that this recipe's board caller never had.
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
        // `<section>` IS an HTMLElement in React's own JSX.IntrinsicElements
        // typing (unlike Icon's svg/StatusDot's span/CopyButton's button,
        // which map to a narrower subclass), so no SORI-14 ref cast is
        // needed here — `Ref<HTMLElement>` already matches exactly.
        ref={ref}
        // Band 2: everything the consumer passed. No band-1 presentation
        // defaults: unlike Icon's svg attributes, the section has nothing
        // that reads as a courtesy default — its whole presentation is the
        // stylesheet plus the one data attribute below.
        {...rest}
        // Band 3, the non-overridable tail — nothing below may be replaced
        // from a call site. `data-collapsed` lives here (not band 1) because
        // it is DERIVED state, not a raw pass-through value — the same
        // reasoning StatusDot's `data-tip` and CopyButton's `data-copied`
        // give for their own derived attributes.
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

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const panelTheme = Panel.extend({});
