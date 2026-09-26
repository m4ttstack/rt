import type { ComponentProps, HTMLAttributes, MouseEvent, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import { useBodyScrollLock, useEscapeClose } from "../../hooks/index.ts";
import classes from "./SideDrawer.module.css";
import "./SideDrawer.keyframes.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code.
    Built on `defineComponent`, not `defineCompound` — see docs/decisions.md. */
export const recipeCategory = 2 as const;

/** Two slots, and no more: the drawer owns overlay + panel and nothing inside
    it, so each caller's own head keeps the app-side classes mr-board targets.
    `root` IS THE PANEL, not the outermost element — `useStyles` folds a
    consumer's `className`/`style` into the `root` selector only. */
const SIDEDRAWER_SELECTORS = ["root", "overlay"] as const;

/**
 * Stable selector surface for app-side CSS, stamped in the non-overridable tail
 * so a call site cannot sever an app's `[data-part]` rules.
 *
 * One value replaces TWO board classes per slot (`.tui-cd`, `.tui-drawer`), so
 * an app rule that told them apart by class must now tell them apart by
 * `data-side` — which makes `data-side` part of the cross-boundary contract,
 * and is why it too sits in the non-overridable tail, on both elements.
 */
export const SIDEDRAWER_PARTS = { root: "sidedrawer", overlay: "sidedrawer-overlay" } as const;

/** Which viewport edge the panel is pinned to. */
export type SideDrawerSide = "left" | "right";

/** Verbatim mr-board widths, retunable via `SideDrawer.extend({ vars })`. */
const SIDEDRAWER_WIDTHS: Record<string, string> = {
  right: "min(460px, 92vw)",
  left: "min(320px, 85vw)",
};

/** SideDrawer's own props; `SideDrawerProps` below is the full public surface. */
export interface SideDrawerOwnProps {
  /** Which edge the drawer is pinned to. Drives width, border edge, shadow,
      the overlay's alignment and stacking order, and the panel's padding. */
  side: SideDrawerSide;
  /** The dialog's accessible name (`aria-label` on the panel). */
  ariaLabel: string;
  /** Called on Escape, and on an overlay click unless `onOverlayClick` is given. */
  onClose: () => void;
  /** REPLACES the overlay's `onClose` handler when given, rather than adding
      to it. For a drawer inside a clickable row that must stop that click
      bubbling before closing. */
  onOverlayClick?: (e: MouseEvent) => void;
  children?: ReactNode;
}

type SideDrawerProps_ = SideDrawerOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

export const SideDrawer = defineComponent<
  SideDrawerProps_,
  typeof SIDEDRAWER_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "SideDrawer",
  selectors: SIDEDRAWER_SELECTORS,
  classes,
  // The `??` tail is defensive: a theme `defaultProps` path or a JS consumer can
  // still hand this resolver a key the record lacks, and an undefined width
  // collapses the panel to nothing rather than failing loudly.
  vars: (_theme, props) => ({
    root: {
      "--sb-sidedrawer-w":
        SIDEDRAWER_WIDTHS[(props as { side?: string }).side ?? "right"] ??
        (SIDEDRAWER_WIDTHS.right as string),
    },
  }),
  render: ({ props, getStyles, ref }) => {
    const {
      side,
      ariaLabel,
      onClose,
      onOverlayClick,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // `render` runs inside the builder's own forwardRef component body on every
    // render, so hooks here obey the rules of hooks normally.
    useEscapeClose(onClose);
    useBodyScrollLock();

    return (
      <div
        // The overlay is not the root slot, so it takes no `{...rest}`:
        // everything a consumer passes belongs to the panel.
        {...getStyles("overlay")}
        data-part={SIDEDRAWER_PARTS.overlay}
        data-side={side}
        onClick={onOverlayClick ?? onClose}
      >
        <div
          ref={ref}
          // No `aria-modal`, deliberately: mr-board's SideDrawer sets role and
          // label and stops — only its Modal is aria-modal. Adding it would
          // change how a screen reader treats the rest of the page.
          role="dialog"
          {...rest}
          // Non-overridable tail. `onClick`'s stopPropagation is STRUCTURAL —
          // the only thing keeping a click inside the drawer from bubbling to
          // the overlay and closing it — so a consumer's own frame `onClick` is
          // replaced rather than composed, exactly as in mr-board.
          {...getStyles("root")}
          data-part={SIDEDRAWER_PARTS.root}
          data-side={side}
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type SideDrawerProps = ComponentProps<typeof SideDrawer>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const sideDrawerTheme = SideDrawer.extend({});
