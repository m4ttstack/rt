import type { ComponentProps, HTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import { useBodyScrollLock, useEscapeClose } from "../../hooks/index.ts";
import classes from "./SideDrawer.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 2 = TRANSIENT OVERLAY (§ 2.2) — it mounts, it dims the page, it unmounts,
 * and it owns Escape and the overlay-click affordance while it is on screen.
 *
 * IMPLEMENTED ON `defineComponent`, NOT `defineCompound`, for exactly the
 * reasons Modal.tsx sets out at length (spec divergence 2(c); task-8-report.md
 * § 3) — no @base-ui/react in this kit, and no consumer imports a
 * `SideDrawer.Panel`. The case is if anything stronger here: this recipe has
 * only TWO elements, and the drawer deliberately owns nothing inside the panel
 * (see SIDEDRAWER_SELECTORS), so there is nothing a compound could compose.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 2 as const;

/**
 * The recipe's style slots — TWO, and deliberately no more.
 *
 *   `root`    -> `.tui-cd`         (right) / `.tui-drawer`         (left)
 *   `overlay` -> `.tui-cd-overlay` (right) / `.tui-drawer-overlay` (left)
 *
 * THE DRAWER OWNS ONLY OVERLAY + PANEL. Unlike Modal, it has no built-in
 * title/close row: CommentsDrawer's head and the mobile drawer's head differ
 * enough (icon-close button vs. plain title, different classes) that each
 * renders its own inside `children` — mr-board's own reasoning, carried
 * forward. mr-board's board CSS still targets those internals
 * (`.tui-drawer-head`, `.tui-drawer-controls`, `.tui-cd-head`, …), so they
 * stay APP-SIDE classes passed through `children` and are not slots here.
 * That is a hard parity constraint from this task's brief, not a style
 * choice; SideDrawer.module.css records the one internal rule that still
 * needs rewriting at adoption (`.tui-drawer .tui-sidebar`, which is
 * descendant-scoped on the panel's own class).
 *
 * `root` IS THE PANEL, not the outermost element, for the same machinery
 * reason Modal's root is the frame: `useStyles` folds a consumer's
 * `className`/`style` and the universal style props into the `root` selector
 * only, and mr-board's `panelClassName` is what dressed the panel.
 */
const SIDEDRAWER_SELECTORS = ["root", "overlay"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief). Self-identifying, so each value works standing alone from
 * mr-board's residual `style.css`:
 *
 *   root slot    -> "sidedrawer"          (drop-in for BOTH `.tui-cd` and
 *                                          `.tui-drawer`; the side is carried
 *                                          by `data-side`, see below)
 *   overlay slot -> "sidedrawer-overlay"  (drop-in for both overlays)
 *
 * ONE VALUE REPLACES TWO BOARD CLASSES PER SLOT, which is the whole point of
 * the merge — but it means an app-side rule that used to distinguish the two
 * families by class name must now distinguish them by side:
 *
 *   `.tui-cd`            -> `[data-part="sidedrawer"][data-side="right"]`
 *   `.tui-drawer`        -> `[data-part="sidedrawer"][data-side="left"]`
 *   `.tui-cd-overlay`    -> `[data-part="sidedrawer-overlay"][data-side="right"]`
 *   `.tui-drawer-overlay`-> `[data-part="sidedrawer-overlay"][data-side="left"]`
 *
 * `data-side` IS THEREFORE PART OF THE CROSS-BOUNDARY CONTRACT, not just an
 * internal styling hook, and it is stamped on BOTH elements for that reason.
 * SideDrawer.module.css lists the one rule pair mr-board must keep in this
 * rewritten form (the left overlay's mobile-only `display` gate).
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` — and here
 * `data-side` alongside it — is stamped in the NON-OVERRIDABLE TAIL, after
 * `{...rest}`. `data-side` belongs there rather than in band 1 because it is
 * DERIVED from the `side` own prop and because CSS keys on it: a consumer
 * overriding it would silently lay the drawer out on the wrong edge while the
 * `side` prop said otherwise. Pinned by SideDrawer.test.tsx's "a
 * consumer-supplied data-part or data-side does not win".
 */
export const SIDEDRAWER_PARTS = { root: "sidedrawer", overlay: "sidedrawer-overlay" } as const;

/** Which viewport edge the panel is pinned to. THE API PROMOTION this recipe
    exists for: mr-board's SideDrawer took raw `overlayClassName` /
    `panelClassName` strings and let the call site pick the family. */
export type SideDrawerSide = "left" | "right";

/**
 * The § 6 dimension-record pattern, keyed on this recipe's OWN `side` axis
 * rather than the theme's `size` vocabulary — the pattern's shape (a plain
 * `Record<string, string>` near the top of the recipe, read inside the `vars`
 * resolver) is what matters, not which axis keys it, and `side` is the only
 * axis these two values vary along.
 *
 * The values are mr-board's own, verbatim from the census: the comments
 * drawer is a reading surface for prose and wants the room, the burger menu
 * holds a roster and a control stack and does not. Both stay
 * theme-overridable two ways, exactly as Button's heights do — per instance
 * via `SideDrawer.extend({ vars })` overriding `--sb-sidedrawer-w`, or via
 * `.extend({ defaultProps: { side } })` changing which key is read.
 */
const SIDEDRAWER_WIDTHS: Record<string, string> = {
  right: "min(460px, 92vw)",
  left: "min(320px, 85vw)",
};

/**
 * The recipe's OWN props. The full public surface is `SideDrawerProps` below:
 * this, plus every div attribute, plus the Styles API and the universal style
 * props the builder adds for free.
 */
export interface SideDrawerOwnProps {
  /**
   * Which edge the drawer is pinned to. Drives the panel's width, its border
   * edge, its shadow, the overlay's alignment and stacking order, and the
   * left panel's own padding — see SideDrawer.module.css's merge map.
   */
  side: SideDrawerSide;
  /** The dialog's accessible name (`aria-label` on the panel). */
  ariaLabel: string;
  /** Called on Escape, and on an overlay click unless `onOverlayClick` is given. */
  onClose: () => void;
  /**
   * REPLACES the overlay's `onClose` handler when given (`onOverlayClick ??
   * onClose`, verbatim from mr-board — a replacement, not an addition). Exists
   * for CommentsDrawer, which renders inside a clickable row and needs to stop
   * that click from bubbling before closing; every other caller just closes.
   */
  onOverlayClick?: (e: MouseEvent) => void;
  children?: ReactNode;
}

type SideDrawerProps_ = SideDrawerOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "children">;

export const SideDrawer = defineComponent<
  SideDrawerProps_,
  typeof SIDEDRAWER_SELECTORS,
  readonly [],
  readonly []
>({
  name: "SideDrawer",
  selectors: SIDEDRAWER_SELECTORS,
  classes,
  // A RECIPE-SUPPLIED `vars` RESOLVER REPLACES THE BUILDER'S AUTOMATIC
  // autoVars CALL (skill § 4 + § 10) — but SideDrawer declares no `variants`,
  // so there is no auto-derived output to preserve/merge here
  // (task-8-report.md § 4's second corollary).
  //
  // The `?? SIDEDRAWER_WIDTHS.right` tail is the same defensive shape the
  // report's Chip snippet uses for a size record: `side` is required on the
  // own type, but a theme `defaultProps` path or a JS consumer can still hand
  // this resolver something the record has no key for, and an undefined width
  // would collapse the panel to nothing rather than fail loudly.
  vars: (_theme, props) => ({
    root: {
      "--sb-sidedrawer-w":
        SIDEDRAWER_WIDTHS[(props as { side?: string }).side ?? "right"] ??
        (SIDEDRAWER_WIDTHS.right as string),
    },
  }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same way
    // every prior recipe strips them. No vocabulary-axis destructure is
    // needed: SideDrawer opts into no axes — `side` is a recipe-local prop
    // stamped by hand as `data-side`, the established pattern for a
    // non-vocabulary enum (skill § 7's `data-order`/`data-fluid` note).
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

    // `render` runs inside the builder's own forwardRef function-component
    // body on every render (see define-component.tsx), so these obey the rules
    // of hooks exactly as if written directly in a function component. Both
    // calls are VERBATIM from mr-board's own SideDrawer, in the same order.
    useEscapeClose(onClose);
    useBodyScrollLock();

    return (
      <div
        // The overlay is NOT the root slot (see SIDEDRAWER_SELECTORS), so it
        // takes no `{...rest}`: everything a consumer passes belongs to the
        // panel, exactly as mr-board's `panelClassName` did.
        {...getStyles("overlay")}
        data-part={SIDEDRAWER_PARTS.overlay}
        data-side={side}
        onClick={onOverlayClick ?? onClose}
      >
        <div
          // KNOWN SORIBASHI LIMITATION (SORI-14, filed against Icon's svg
          // root): every builder's render ctx types `ref` as `Ref<HTMLElement>`
          // rather than the element this recipe actually renders.
          ref={ref as Ref<HTMLDivElement>}
          // Band 1, the overridable head: mr-board's own presentation default.
          // NOTE WHAT IS *NOT* HERE — `aria-modal`. mr-board's SideDrawer sets
          // role and label and stops; only its Modal is aria-modal. Adding it
          // would change how a screen reader treats the rest of the page while
          // a drawer is open, which is a behaviour change, not a port. Pinned
          // by SideDrawer.test.tsx's "carries NO aria-modal".
          role="dialog"
          // Band 2: everything the consumer passed, `className` included (the
          // builder has already folded it into getStyles("root") below).
          {...rest}
          // Band 3, the non-overridable tail — nothing below may be replaced
          // from a call site. `aria-label` and `data-side` are both DERIVED
          // from own props; `onClick`'s stopPropagation is STRUCTURAL (it is
          // the only thing keeping a click inside the drawer from bubbling to
          // the overlay and closing it), carried verbatim from mr-board
          // including the consequence that a consumer's own frame `onClick`
          // would be replaced rather than composed.
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

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const sideDrawerTheme = SideDrawer.extend({});
