import type { PartRenderCtx } from "@soribashi/core";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { defineCompound } from "../../builders.ts";
import { useEscapeClose } from "../../hooks/index.ts";
import classes from "./ContextMenu.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 3 = PERSISTENT NAVIGATIONAL COMPOUND (§ 2.3, the Tabs pattern) — once the
 * caller has mounted it, every part stays mounted for the menu's whole life
 * and the parts are ordered by the CONSUMER, not by the recipe.
 *
 * THIS IS THE KIT'S ONLY `defineCompound`, AND IT EARNS IT. Every prior recipe
 * took the sanctioned `defineComponent`-over-`defineCompound` route (Modal.tsx
 * carries the full argument) because nothing imported `Modal.Overlay`. Here the
 * opposite is true and is the entire point: mr-board's RowMenu builds its item
 * list conditionally — review items, a resume item, a respond item, a doctor
 * item, N peer items, a separator, then either the Slack marks or the
 * find/post pair — so the consumer, not the recipe, decides what parts exist
 * and in what order. `<ContextMenu.Item>` / `<ContextMenu.Label>` /
 * `<ContextMenu.Separator>` are genuinely separate, independently-composable
 * parts a call site imports and sequences itself, which is the skill's § 12
 * test for a compound (composability, not slot count).
 *
 * TWO CONSEQUENCES OF `defineCompound` THAT DO NOT APPLY TO ANY OTHER RECIPE
 * IN THIS KIT, both of which have bitten soribashi (skill § 4 + § 10):
 *   - it does NOT call `autoVars` at all, and has no automatic fallback. A
 *     compound that declared `variants` would get none of the free
 *     `--contextmenu-bg`/`-color`/`-border` vars; this one declares none, so
 *     there is nothing to merge and the `vars` resolver below is only its one
 *     scalar.
 *   - its `getStyles` takes an OPTIONS OBJECT, never the bare-string form the
 *     rest of the kit uses: a part styling its own slot calls `getStyles()`,
 *     and a part reaching across to a sibling slot calls
 *     `getStyles({ part: 'hint' })`. `getStyles('hint')` does not typecheck
 *     here and would not work if it did.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 3 as const;

/**
 * The full declared slot set, as the const array `defineCompound` requires
 * (skill § 11): the slot set is NOT recoverable by unioning part names with
 * CSS-module class keys, because that union can neither add a styled slot that
 * has no part nor drop a part that has no slot. This recipe proves the first
 * direction — `hint` is a real style slot (mr-board's `.tui-menu-hint`) that
 * `Item` composes internally, exactly the relationship soribashi's Popover
 * `positioner` and Tabs `indicator` have to their own parts maps. There is no
 * `ContextMenu.Hint`: a hint is a property OF an item, and promoting it to a
 * part would let a call site render one on its own, outside any item.
 *
 * Mapped one-for-one onto mr-board's `.tui-menu*` family:
 *
 *   `root`      -> `.tui-menu`
 *   `label`     -> `.tui-menu-label`
 *   `item`      -> `.tui-menu-item`
 *   `hint`      -> `.tui-menu-hint`   (styled slot, no part — see above)
 *   `separator` -> `.tui-menu-sep`
 */
const CONTEXTMENU_SLOT_KEYS = ["root", "item", "label", "separator", "hint"] as const;

type ContextMenuSlotKey = (typeof CONTEXTMENU_SLOT_KEYS)[number];

/** Every part's render ctx. `object` for the extras (this compound publishes
    no `context()` of its own) and `readonly []` for the variants tuple (it
    declares none), so `ctx.variant` is correctly `undefined`. */
type Ctx<TProps> = PartRenderCtx<TProps, object, readonly [], ContextMenuSlotKey>;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief). Self-identifying, so each value works standing alone from
 * mr-board's residual `style.css` without needing an ancestor to disambiguate
 * which recipe it is:
 *
 *   root slot      -> "contextmenu"            (drop-in for `.tui-menu`)
 *   item slot      -> "contextmenu-item"       (`.tui-menu-item`)
 *   label slot     -> "contextmenu-label"      (`.tui-menu-label`)
 *   separator slot -> "contextmenu-separator"  (`.tui-menu-sep`)
 *   hint slot      -> "contextmenu-hint"       (`.tui-menu-hint`)
 *
 * ADOPTION NOTE. `.tui-menu-noting`, `.tui-menu-note`, `.tui-menu-note-hint`,
 * `.tui-menu-check` and `.tui-menu-spin` are NOT absorbed here and MUST stay
 * in mr-board's stylesheet — see ContextMenu.module.css's header for which is
 * which and why. The two note-mode-adjacent selectors that are ANCESTOR-scoped
 * on an absorbed class need rewriting rather than keeping:
 *   `.tui-menu-noting .tui-menu-label`
 *     -> `.tui-menu-noting [data-part="contextmenu-label"]`
 * (and `.tui-menu-noting` itself becomes a class RowMenu passes through
 * `className`, which the builder folds into the root slot for free).
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` is stamped in the
 * NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Modal.tsx's identical comment for the failure mode this closes.
 * On a compound it matters on EVERY part, not just the root, since each part
 * has its own consumer-facing prop surface. Pinned by ContextMenu.test.tsx's
 * "a consumer-supplied data-part does not win, on the root or on a part".
 */
export const CONTEXTMENU_PARTS = {
  root: "contextmenu",
  item: "contextmenu-item",
  label: "contextmenu-label",
  separator: "contextmenu-separator",
  hint: "contextmenu-hint",
} as const;

/**
 * How far the clamped menu is kept from every viewport edge, in CSS pixels —
 * mr-board's own `8`, appearing four times in one expression there. A plain
 * number rather than a spacing token because it is consumed in JS geometry
 * (`window.innerWidth - width - MARGIN`), not in CSS: routing it through a
 * custom property would mean reading computed styles back out mid-measure for
 * no gain.
 */
const VIEWPORT_MARGIN = 8;

/**
 * The one value in mr-board's `.tui-menu*` family with no theme rung, routed
 * through a recipe-local custom property — the same pattern Modal's
 * `MODAL_SCALARS` / ToastHost's `TOASTHOST_SCALARS` use. Unconditional, not
 * keyed by props. See ContextMenu.module.css's header for why `200px` has no
 * rung (it is a fixed floating-panel MEASURE, not a padding-margin-gap
 * literal, and unlike `320px` it appears exactly once in the board).
 */
const CONTEXTMENU_SCALARS = { minWidth: "200px" } as const;

/**
 * Strips the Styles API's own config keys, which `useStyles` consumes
 * internally and which are not valid DOM attributes. Every part needs this,
 * not just the root: `defineCompound` hands each part its own merged props
 * untouched. No `render` key to strip (that is Base UI's polymorphism
 * mechanism, and this kit has no @base-ui/react dependency), and no
 * vocabulary-axis destructure either — this recipe opts into no axes, so
 * `size`/`intent`/`variant` are not on any part's prop surface.
 */
function stripFrameworkKeys<
  T extends Partial<
    Record<"classNames" | "styles" | "vars" | "attributes" | "unstyled", unknown>
  >,
>(props: T): Omit<T, "classNames" | "styles" | "vars" | "attributes" | "unstyled"> {
  const {
    classNames: _classNames,
    styles: _styles,
    vars: _vars,
    attributes: _attributes,
    unstyled: _unstyled,
    ...rest
  } = props;
  return rest;
}

/**
 * The ROOT part's own props. The full public surface is `ContextMenuProps`
 * below: this, plus every div attribute, plus the Styles API and the universal
 * style props the builder adds for free.
 */
export interface ContextMenuOwnProps {
  /** Requested viewport x of the anchor point (a cursor position, typically
      `event.clientX`). CLAMPED, not obeyed — see the layout effect. */
  x: number;
  /** Requested viewport y of the anchor point (`event.clientY`). */
  y: number;
  /** The menu's accessible name (`aria-label` on the root). */
  ariaLabel: string;
  /** Called on Escape, on a mousedown outside the menu, on scroll, and on
      resize. NOT called when an item is clicked — closing after an action is
      the caller's decision, exactly as in mr-board (its Slack-mark items
      deliberately keep the menu open so several marks can be set at once). */
  onClose: () => void;
  children?: ReactNode;
}

type ContextMenuRootProps_ = ContextMenuOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** The `Item` part's own props — mr-board's `MenuItem` signature verbatim. */
export interface ContextMenuItemOwnProps {
  /** The item's leading text. A ReactNode, not a string: mr-board passes
      fragments and interpolated labels. */
  label: ReactNode;
  /** Right-hand annotation ("herdr", "gitlab", "peer", "+ note"). Rendered
      into the `hint` slot, and IGNORED when `trailing` is given. */
  hint?: string;
  /** An arbitrary right-hand node that REPLACES the hint — mr-board's Slack
      ✓ mark and its per-emoji spinner. Deliberately a free ReactNode: those
      two are board chrome (`.tui-menu-check` / `.tui-menu-spin`, which stay
      app-side), not menu-shell slots. */
  trailing?: ReactNode;
  /** Disables the underlying `<button>`; the disabled styling follows from
      `:disabled` in the stylesheet, not from a data attribute. */
  disabled?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

type ContextMenuItemProps_ = ContextMenuItemOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "children" | "disabled" | "onClick">;

/** The `Label` part's own props: a section heading at the top of the menu
    (mr-board renders the MR's `!iid` there). */
export interface ContextMenuLabelOwnProps {
  children?: ReactNode;
}

type ContextMenuLabelProps_ = ContextMenuLabelOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** The `Separator` part takes no own props — it is a 1px rule, so its
    internal render-time props type is just the DOM attribute surface, the
    same role `ContextMenuRootProps_` / `ContextMenuItemProps_` /
    `ContextMenuLabelProps_` play for their parts (trailing-underscore,
    not exported: the public full-props type is `ContextMenuSeparatorProps`
    below). */
type ContextMenuSeparatorProps_ = Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/**
 * @deprecated The old name claimed to be "own props" (Root/Item/Label's
 * `XxxOwnProps` types hold each part's own declared fields, distinct from the
 * DOM attributes they're combined with). Separator has no fields of its own,
 * so this type was ALWAYS the full DOM attribute surface — the opposite of
 * what `OwnProps` means for its siblings. Renamed to `ContextMenuSeparatorProps_`
 * to match the sibling parts' internal-props convention; this alias is kept
 * only because the barrel (`src/index.ts`) re-exported the old name. Prefer
 * `ContextMenuSeparatorProps` (`ComponentProps<typeof ContextMenu.Separator>`,
 * below) for the full public props type.
 */
export type ContextMenuSeparatorOwnProps = ContextMenuSeparatorProps_;

export const ContextMenu = defineCompound({
  name: "ContextMenu",
  classes,
  slotKeys: CONTEXTMENU_SLOT_KEYS,
  // A COMPOUND HAS NO AUTOMATIC `autoVars` FALLBACK AT ALL (skill § 4), so
  // unlike the single-component recipes there is nothing this resolver could
  // be replacing — and no `variants` are declared, so there is nothing to
  // merge in either. One scalar, unconditionally, on the root slot.
  vars: () => ({ root: { "--sb-contextmenu-min-w": CONTEXTMENU_SCALARS.minWidth } }),
  parts: {
    root: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuRootProps_>) => {
        const {
          x,
          y,
          ariaLabel,
          onClose,
          children: _children,
          ...rest
        } = stripFrameworkKeys(props);

        // A part's `render` runs inside the builder's own forwardRef function
        // component body on every render (define-compound.tsx's `CompoundRoot`),
        // so every hook below obeys the rules of hooks exactly as if written
        // directly in a function component.
        const menuRef = useRef<HTMLDivElement | null>(null);
        const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

        // The recipe needs its own handle on the element (to measure it, and to
        // answer "was that mousedown inside me?"), and a consumer may still
        // pass a ref of their own. Merged in a callback ref rather than by
        // reaching for a framework helper — soribashi has none, and this is the
        // only recipe in the kit that needs one. Memoised on `ref` so the
        // callback's identity is stable across renders; a fresh identity every
        // render would make React detach and re-attach it each time.
        const setRefs = useCallback(
          (el: HTMLDivElement | null) => {
            menuRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) (ref as { current: unknown }).current = el;
          },
          [ref],
        );

        // KEEP THE MENU ON SCREEN. mr-board's own two-pass trick, with the one
        // correction recorded at the bottom of this comment:
        // render once at the requested point (hidden, see `anchored` below),
        // measure the real box, then clamp both axes into the viewport with a
        // margin at every edge. `useLayoutEffect`, not `useEffect`, so the
        // corrected position is committed BEFORE the browser paints — with
        // useEffect the menu would visibly jump.
        //
        // DEPS ARE `[x, y]` ONLY, which is mr-board's list minus its third
        // entry (`noteFor`, the app's note-mode toggle — a different-sized box
        // that has to be re-measured). That dep cannot come along: the shell
        // has no knowledge of a consumer's modes. THE ADOPTION ANSWER is to
        // give a mode-swapped menu its own React `key`, which remounts it and
        // re-runs this effect against the new box; RowMenu already renders note
        // mode as an entirely separate return, so this costs it one attribute.
        //
        // ONE DELIBERATE CORRECTION TO THE PORT, recorded rather than passed
        // off as verbatim: mr-board measures with `getBoundingClientRect()`,
        // which returns the TRANSFORMED box. This recipe's own entry animation
        // (`contextmenu-in`) opens on `scale(0.97) translateY(-2px)` and is
        // already running when this effect fires, so a rect measure clamps
        // against a box 3% narrower than the one that will actually be on
        // screen a frame later — and the settled menu then overhangs its own
        // margin by ~6px at the right/bottom edges (observed: 409 against a
        // 406 limit). `offsetWidth`/`offsetHeight` are the UNTRANSFORMED
        // border-box measures, identical to the rect whenever no transform is
        // active and correct when one is. Pinned by ContextMenu.test.tsx's
        // clamp cases, which read the box only after the animation has
        // finished — with the rect form they fail.
        useLayoutEffect(() => {
          const el = menuRef.current;
          if (!el) return;
          const width = el.offsetWidth;
          const height = el.offsetHeight;
          setPos({
            left: Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN)),
            top: Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN)),
          });
        }, [x, y]);

        // Escape goes through the shared LIFO layer stack, so it closes only
        // the TOPMOST open modal/drawer/menu rather than every layer at once.
        useEscapeClose(onClose);

        // The other three dismissals, verbatim from mr-board. Note the shapes:
        // `mousedown` (not click) so the menu is gone before the underlying
        // element's own click handler runs; `scroll` in the CAPTURE phase
        // because scroll does not bubble from a scrolling descendant to
        // window; and no `contains` check on either scroll or resize, since a
        // fixed-position menu anchored to a stale point is wrong whatever
        // moved.
        useEffect(() => {
          const onDown = (e: MouseEvent) => {
            if (!menuRef.current?.contains(e.target as Node)) onClose();
          };
          document.addEventListener("mousedown", onDown);
          window.addEventListener("scroll", onClose, true);
          window.addEventListener("resize", onClose);
          return () => {
            document.removeEventListener("mousedown", onDown);
            window.removeEventListener("scroll", onClose, true);
            window.removeEventListener("resize", onClose);
          };
        }, [onClose]);

        // Before the first measurement there is no honest position to paint at,
        // so the menu is laid out (it must be, to be measurable) but not shown.
        const anchored: CSSProperties = pos
          ? { left: pos.left, top: pos.top }
          : { left: x, top: y, visibility: "hidden" };
        // MERGED, not replaced: `getStyles()` has already folded in the
        // consumer's own `style` and the universal style props, and the anchor
        // has to sit on top of both without discarding either.
        const rootStyles = getStyles();

        return (
          <div
            ref={setRefs}
            // Band 1, the overridable head: mr-board's own presentation
            // default. `role` is a documented courtesy, replaceable the same
            // way Modal's and ToastHost's are.
            role="menu"
            // Band 2: everything the consumer passed, `className` included (the
            // builder has already folded it into getStyles() below).
            {...rest}
            // Band 3, the non-overridable tail — nothing below may be replaced
            // from a call site. `aria-label` is DERIVED from an own prop, and
            // `style` is the merge described above: a consumer's `style` still
            // applies, it just cannot move the menu off its clamped anchor
            // (which is the recipe's whole job).
            {...rootStyles}
            style={{ ...rootStyles.style, ...anchored }}
            data-part={CONTEXTMENU_PARTS.root}
            aria-label={ariaLabel}
          >
            {children}
          </div>
        );
      },
    },
    item: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuItemProps_>) => {
        const { label, hint, trailing, ...rest } = stripFrameworkKeys(props);
        return (
          <button
            ref={ref as Ref<HTMLButtonElement>}
            // Band 1, the overridable head. `role="menuitem"` is mr-board's.
            // `type="button"` is an ADDITION, and a safe one: a bare <button>
            // defaults to type="submit", so an item rendered inside a form
            // would submit it. mr-board's menu never sits in a form, which is
            // why the bug never surfaced there; a kit recipe cannot assume that.
            role="menuitem"
            type="button"
            // Band 2: everything the consumer passed — `disabled` and `onClick`
            // among them, both left in `rest` deliberately rather than
            // destructured and re-applied, since both are real button
            // attributes that need no translation.
            {...rest}
            // Band 3, the non-overridable tail.
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.item}
          >
            <span>{label}</span>
            {/* mr-board's `trailing ?? (hint && <span…>)` — trailing REPLACES
                the hint rather than sitting beside it. The label's own <span>
                carries no slot because the board gives it no class either: it
                exists purely so `justify-content: space-between` has two
                children to push apart. */}
            {trailing ??
              (hint ? (
                <span {...getStyles({ part: "hint" })} data-part={CONTEXTMENU_PARTS.hint}>
                  {hint}
                </span>
              ) : null)}
          </button>
        );
      },
    },
    label: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuLabelProps_>) => {
        const { children: _children, ...rest } = stripFrameworkKeys(props);
        return (
          <div
            ref={ref as Ref<HTMLDivElement>}
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.label}
          >
            {children}
          </div>
        );
      },
    },
    separator: {
      render: ({ props, getStyles, ref }: Ctx<ContextMenuSeparatorProps_>) => (
        <div
          ref={ref as Ref<HTMLDivElement>}
          // Band 1. `role="separator"` is an ADDITION to mr-board's bare
          // <div>, and a deliberate one: `separator` is valid owned content
          // for `role="menu"`, and without it the rule is exposed to a screen
          // reader as a generic element inside a menu — i.e. as noise between
          // the menuitems rather than as the grouping cue it is drawn to be.
          // Replaceable from a call site (band 1), unlike data-part.
          role="separator"
          {...stripFrameworkKeys(props)}
          {...getStyles()}
          data-part={CONTEXTMENU_PARTS.separator}
        />
      ),
    },
  },
});

/** Everything a call site may pass to the menu itself, own props included. */
export type ContextMenuProps = ComponentProps<typeof ContextMenu>;
/** Everything a call site may pass to `<ContextMenu.Item>`. */
export type ContextMenuItemProps = ComponentProps<typeof ContextMenu.Item>;
/** Everything a call site may pass to `<ContextMenu.Label>`. */
export type ContextMenuLabelProps = ComponentProps<typeof ContextMenu.Label>;
/** Everything a call site may pass to `<ContextMenu.Separator>`. */
export type ContextMenuSeparatorProps = ComponentProps<typeof ContextMenu.Separator>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from. Compound
 * PARTS carry their own `.extend` too (registered as `ContextMenuItem`,
 * `ContextMenuLabel`, `ContextMenuSeparator`), so a theme can set part-level
 * defaults without going through the root.
 */
export const contextMenuTheme = ContextMenu.extend({});
