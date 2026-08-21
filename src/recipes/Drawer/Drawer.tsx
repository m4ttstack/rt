import { mergeRefs } from "@soribashi/core";
import type { ComponentProps, CSSProperties, ReactNode, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineComponent } from "../../builders.ts";
import { SideDrawer } from "../SideDrawer/SideDrawer.tsx";
import classes from "./Drawer.module.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code.
    Built on `defineComponent`, not `defineCompound` — see docs/decisions.md;
    the caller's `open` prop is the whole lifecycle, same as Modal/SideDrawer. */
export const recipeCategory = 2 as const;

/** Drawer owns the nav bar, header strip and content body; SideDrawer owns
    the overlay, panel chrome and Escape/scroll-lock plumbing underneath it —
    `root` names the SideDrawer instance itself, not a slot this module draws
    (same split as ConfirmDialog/Modal). */
const DRAWER_SELECTORS = ["root", "nav", "back", "title", "navAction", "close", "header", "content"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules. No `root`
    entry is stamped: SideDrawer already stamps `data-part="sidedrawer"` on
    that element. */
export const DRAWER_PARTS = {
  /** Never stamped on a DOM node — query `[data-part="sidedrawer"]` for the
      panel instead. */
  root: "drawer",
  nav: "drawer-nav",
  back: "drawer-back",
  title: "drawer-title",
  navAction: "drawer-navaction",
  close: "drawer-close",
  header: "drawer-header",
  content: "drawer-content",
} as const;

/** The panel width at rest; overridden to `100%` under `NARROW_QUERY`. */
const DRAWER_WIDTH = "21rem";

/** Below this, the panel goes full-width. A `matchMedia` query, not a CSS
    breakpoint: the swap has to reach `--sb-sidedrawer-w`, a value SideDrawer's
    own stylesheet reads, from render state rather than from a media query
    Drawer.module.css would have no way to address. */
const NARROW_QUERY = "(max-width: 45rem)";

/** One entry in a consumer-owned screen stack. Drawer renders only the top;
    it never mutates the array itself. */
export type DrawerScreen = {
  id: string;
  title: ReactNode;
  /** The nav bar's "save" slot. */
  navAction?: { label: string; onAction(): void; disabled?: boolean };
  /** Status strip / error banner region rendered under the nav bar. */
  header?: ReactNode;
  content: ReactNode;
};

/** Drawer's own props; `DrawerProps` below is the full public surface. */
export interface DrawerOwnProps {
  open: boolean;
  /** Consumer-owned; top of stack renders. */
  stack: DrawerScreen[];
  /** Pops the stack. Drawer never mutates it itself. */
  onBack(): void;
  onClose(): void;
  ariaLabel: string;
  /** Focus target restored on close. `| null` because that's what
      `useRef<HTMLElement>(null)` actually returns under React 19's
      `RefObject` type. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export const Drawer = defineComponent<
  DrawerOwnProps,
  typeof DRAWER_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "Drawer",
  selectors: DRAWER_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const { open, stack, onBack, onClose, ariaLabel, returnFocusRef } = props;

    const panelRef = useRef<HTMLDivElement>(null);
    const setRefs = useMemo(() => mergeRefs(panelRef, ref), [ref]);

    // Derives push/pop from a length delta rather than tracking the action
    // that caused it — Drawer only ever sees the stack it is handed, never
    // the call that produced it. Mutated during render, not an effect: the
    // canonical "compare to the previous render" ref pattern, and it must
    // settle within the SAME render the length changed in, before the
    // content below reads it for this paint.
    const prevLenRef = useRef(stack.length);
    const directionRef = useRef<"push" | "pop">("push");
    if (stack.length !== prevLenRef.current) {
      directionRef.current = stack.length > prevLenRef.current ? "push" : "pop";
      prevLenRef.current = stack.length;
    }

    // Focus enters the panel for as long as `open` is true and leaves for
    // `returnFocusRef` the moment it isn't — the cleanup, not the body, is
    // what fires on the true -> false transition, so this needs no separate
    // "was open" tracking.
    useEffect(() => {
      if (!open) return;
      panelRef.current?.focus();
      return () => {
        returnFocusRef?.current?.focus();
      };
    }, [open, returnFocusRef]);

    const [isNarrow, setIsNarrow] = useState(
      () => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches,
    );
    useEffect(() => {
      const mql = window.matchMedia(NARROW_QUERY);
      const update = () => setIsNarrow(mql.matches);
      update();
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }, []);

    // Escape reaches this through SideDrawer's own `onClose` (its Escape
    // handler calls whatever `onClose` it was given). An overlay click gets
    // its OWN handler below (`onOverlayClick={onClose}`), deliberately not
    // this one: leaving the drawer's footprint entirely is a full close from
    // any depth, same as ✕, which also bypasses this and calls the raw
    // `onClose` directly.
    const backThenClose = useCallback(() => {
      if (stack.length > 1) onBack();
      else onClose();
    }, [stack.length, onBack, onClose]);

    if (!open) return null;

    const top = stack[stack.length - 1];
    if (!top) return null;
    const previous = stack.length > 1 ? stack[stack.length - 2] : undefined;
    const navAction = top.navAction;

    const contentStyles = getStyles("content");
    const slideStyle = {
      ...contentStyles.style,
      "--sb-drawer-slide-x": directionRef.current === "push" ? "1.5rem" : "-1.5rem",
    } as CSSProperties;

    return (
      <SideDrawer
        ref={setRefs}
        side="right"
        ariaLabel={ariaLabel}
        onClose={backThenClose}
        onOverlayClick={onClose}
        tabIndex={-1}
        // The instance `vars` prop is Styles API precedence-highest for its
        // selector — it overrides SideDrawer's own built-in width resolver
        // for `--sb-sidedrawer-w` without touching SideDrawer's defaults or
        // fighting it on class specificity.
        vars={() => ({ root: { "--sb-sidedrawer-w": isNarrow ? "100%" : DRAWER_WIDTH } })}
        {...getStyles("root", { dataAttrs: { "data-full-width": isNarrow ? "true" : undefined } })}
      >
        <div className={classes.frame}>
          <div {...getStyles("nav")} data-part={DRAWER_PARTS.nav}>
            {previous && (
              <button
                type="button"
                {...getStyles("back")}
                data-part={DRAWER_PARTS.back}
                onClick={() => onBack()}
              >
                {"‹ "}
                {previous.title}
              </button>
            )}
            <div className={classes.navRow}>
              <span {...getStyles("title")} data-part={DRAWER_PARTS.title}>
                {top.title}
              </span>
              <div className={classes.navActions}>
                {navAction && (
                  <button
                    type="button"
                    {...getStyles("navAction")}
                    data-part={DRAWER_PARTS.navAction}
                    onClick={() => navAction.onAction()}
                    disabled={navAction.disabled}
                  >
                    {navAction.label}
                  </button>
                )}
                <button
                  type="button"
                  {...getStyles("close")}
                  data-part={DRAWER_PARTS.close}
                  onClick={() => onClose()}
                  aria-label="close"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
          {top.header != null && (
            <div {...getStyles("header")} data-part={DRAWER_PARTS.header}>
              {top.header}
            </div>
          )}
          <div
            key={top.id}
            {...contentStyles}
            style={slideStyle}
            data-part={DRAWER_PARTS.content}
          >
            {top.content}
          </div>
        </div>
      </SideDrawer>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type DrawerProps = ComponentProps<typeof Drawer>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const drawerTheme = Drawer.extend({});
