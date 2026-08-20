import { mergeRefs } from "@soribashi/core";
import type { PartRenderCtx } from "@soribashi/core";
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defineCompound } from "../../builders.ts";
import { useEscapeClose } from "../../hooks/index.ts";
import classes from "./ContextMenu.module.css";

/** Authoring category (3 = persistent navigational compound). Read off this
    module by scripts/derive.ts to build the kit's manifest; not dead code. */
export const recipeCategory = 3 as const;

/** The full declared slot set, NOT recoverable by unioning part names with
    CSS-module class keys: `hint` is a real style slot with no part, because a
    hint is a property OF an item and promoting it would let a call site render
    one outside any item. */
const CONTEXTMENU_SLOT_KEYS = ["root", "item", "label", "separator", "hint"] as const;

type ContextMenuSlotKey = (typeof CONTEXTMENU_SLOT_KEYS)[number];

/** Every part's render ctx. `object` for the extras (this compound publishes no
    `context()`) and `readonly []` for variants (it declares none), so
    `ctx.variant` is correctly `undefined`. */
type Ctx<TProps> = PartRenderCtx<TProps, object, readonly [], ContextMenuSlotKey>;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail on EVERY part: each has its own consumer-facing prop surface, so each
    could otherwise have its `data-part` replaced. */
export const CONTEXTMENU_PARTS = {
  root: "contextmenu",
  item: "contextmenu-item",
  label: "contextmenu-label",
  separator: "contextmenu-separator",
  hint: "contextmenu-hint",
} as const;

/** Viewport keep-out for the clamped menu, in CSS pixels. A plain number, not a
    spacing token: it is consumed in JS geometry, not in CSS. */
const VIEWPORT_MARGIN = 8;

const CONTEXTMENU_SCALARS = { minWidth: "200px" } as const;

/** Strips the Styles API's own config keys, which `useStyles` consumes and
    which are not valid DOM attributes. Every part needs this: `defineCompound`
    hands each part its own merged props untouched. */
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

/** The root part's own props; `ContextMenuProps` below is the full surface. */
export interface ContextMenuOwnProps {
  /** Requested viewport x of the anchor point (typically `event.clientX`).
      CLAMPED, not obeyed — see the layout effect. */
  x: number;
  /** Requested viewport y of the anchor point (`event.clientY`). */
  y: number;
  /** The menu's accessible name (`aria-label` on the root). */
  ariaLabel: string;
  /** Called on Escape, on a mousedown outside, on scroll, and on resize. NOT
      called when an item is clicked — closing after an action is the caller's
      decision (mr-board's Slack-mark items deliberately stay open). */
  onClose: () => void;
  /** A focusable descendant to focus once, after the clamp commits. The menu is
      `visibility: hidden` until measured, and such a subtree cannot take focus
      at all — so a child's own `autoFocus`, or a focus call from a passive
      effect, silently no-ops. This prop is correctly ordered against the clamp.
      Omit it and nothing steals focus. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called every time the clamped position commits, including on a later
      re-clamp — unlike `initialFocusRef`, which fires once per mount. */
  onPositioned?: () => void;
  children?: ReactNode;
}

type ContextMenuRootProps_ = ContextMenuOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** The `Item` part's own props — mr-board's `MenuItem` signature verbatim. */
export interface ContextMenuItemOwnProps {
  /** The item's leading text. A ReactNode: callers pass fragments. */
  label: ReactNode;
  /** Right-hand annotation. Rendered into the `hint` slot, and IGNORED when
      `trailing` is given. */
  hint?: string;
  /** An arbitrary right-hand node that REPLACES the hint. */
  trailing?: ReactNode;
  /** Disables the underlying `<button>`; styling follows from `:disabled`. */
  disabled?: boolean;
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

type ContextMenuItemProps_ = ContextMenuItemOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref" | "children" | "disabled" | "onClick">;

/** The `Label` part's own props: a section heading at the top of the menu. */
export interface ContextMenuLabelOwnProps {
  children?: ReactNode;
}

type ContextMenuLabelProps_ = ContextMenuLabelOwnProps &
  Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** The `Separator` part declares no own props, so its internal props type is
    just the DOM attribute surface. */
type ContextMenuSeparatorProps_ = Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

/** @deprecated Separator has no fields of its own, so this was always the full
    DOM attribute surface — the opposite of what `OwnProps` means for its
    siblings. Prefer `ContextMenuSeparatorProps`. */
export type ContextMenuSeparatorOwnProps = ContextMenuSeparatorProps_;

export const ContextMenu = defineCompound({
  name: "ContextMenu",
  classes,
  slotKeys: CONTEXTMENU_SLOT_KEYS,
  // Two `defineCompound` facts that apply nowhere else in the kit: it has no
  // automatic autoVars fallback at all (so there is nothing this resolver could
  // be replacing), and its `getStyles` takes an OPTIONS OBJECT — a part styling
  // its own slot calls `getStyles()`, one reaching across calls
  // `getStyles({ part: 'hint' })`. The bare-string form does not typecheck.
  vars: () => ({ root: { "--sb-contextmenu-min-w": CONTEXTMENU_SCALARS.minWidth } }),
  parts: {
    root: {
      render: ({ props, getStyles, children, ref }: Ctx<ContextMenuRootProps_>) => {
        const {
          x,
          y,
          ariaLabel,
          onClose,
          initialFocusRef,
          onPositioned,
          children: _children,
          ...rest
        } = stripFrameworkKeys(props);

        // A part's `render` runs inside the builder's own forwardRef component
        // body on every render, so these hooks obey the rules of hooks normally.
        const menuRef = useRef<HTMLDivElement | null>(null);
        const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
        // A plain mutable ref, not state: flipping it must not schedule a render.
        const hasFocusedRef = useRef(false);

        // The recipe needs its own handle on the element (to measure it, and to
        // answer "was that mousedown inside me?") while a consumer may still
        // pass a ref. Memoised on `ref`: `mergeRefs` returns a fresh callback
        // per call, and a fresh identity every render would make React detach
        // and re-attach it each time.
        const setRefs = useMemo(() => mergeRefs(menuRef, ref), [ref]);

        // Keep the menu on screen: render once at the requested point (hidden,
        // see `anchored`), measure, then clamp both axes. `useLayoutEffect` so
        // the correction commits before paint — with useEffect the menu jumps.
        //
        // `offsetWidth`/`offsetHeight`, NOT `getBoundingClientRect()`: the entry
        // animation opens on `scale(0.97)` and is already running when this
        // fires, so a rect measure clamps against a box 3% narrower than the one
        // that lands, and the settled menu overhangs its margin by ~6px.
        //
        // Deps are `[x, y]` only. A consumer whose menu changes size (mr-board's
        // note mode) gives it a fresh React `key` to remount and re-measure —
        // the shell cannot know about a consumer's modes.
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

        // Its own effect, keyed on the COMMITTED `pos` rather than the requested
        // `[x, y]` — they run on different renders. By the time this body runs,
        // `setPos` has landed as `visibility` flipping to visible: the earliest
        // point a focus call can succeed, and still pre-paint.
        useLayoutEffect(() => {
          if (!pos) return;
          onPositioned?.();
          if (initialFocusRef && !hasFocusedRef.current) {
            hasFocusedRef.current = true;
            initialFocusRef.current?.focus();
          }
        }, [pos, onPositioned, initialFocusRef]);

        useEscapeClose(onClose);

        // Note the shapes: `mousedown` (not click) so the menu is gone before
        // the underlying element's own click handler runs; `scroll` in the
        // CAPTURE phase, because scroll does not bubble from a scrolling
        // descendant to window.
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
        // Merged, not replaced: getStyles() has already folded in the consumer's
        // own `style` and the universal style props.
        const rootStyles = getStyles();

        return (
          <div
            ref={setRefs}
            role="menu"
            {...rest}
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
            role="menuitem"
            type="button"
            // `disabled` and `onClick` stay in `rest` deliberately: both are
            // real button attributes that need no translation.
            {...rest}
            {...getStyles()}
            data-part={CONTEXTMENU_PARTS.item}
          >
            {/* The label's <span> carries no slot because the board gives it no
                class either: it exists so space-between has two children. */}
            <span>{label}</span>
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

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from.
    Compound PARTS carry their own `.extend` too (registered as
    `ContextMenuItem`/`ContextMenuLabel`/`ContextMenuSeparator`). */
export const contextMenuTheme = ContextMenu.extend({});
