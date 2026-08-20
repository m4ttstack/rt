import type { ComponentProps, HTMLAttributes, ReactNode, Ref } from "react";
import { defineComponent } from "../../builders.ts";
import { useBodyScrollLock, useEscapeClose } from "../../hooks/index.ts";
import { ICONS } from "../Icon/Icon.tsx";
import classes from "./Modal.module.css";

/**
 * Authoring category from soribashi's recipe conversion playbook's four
 * categories (soribashi
 * docs/superpowers/specs/2026-04-26-recipe-conversion-playbook.md § 2, reached
 * through .claude/skills/authoring-a-recipe/SKILL.md § 2):
 * 2 = TRANSIENT OVERLAY (§ 2.2) — it mounts, it dims the page, it unmounts,
 * and it owns the open/close affordances (Escape, overlay click, close button)
 * for as long as it is on screen. That is the honest authoring record and it
 * is what this constant reports to the manifest.
 *
 * IMPLEMENTED ON `defineComponent`, NOT `defineCompound`, WHICH THE SKILL'S
 * § 2 PAIRS WITH CATEGORY 2. This is a sanctioned builder deviation (spec
 * divergence 2(c); the reasoning is recorded in task-8-report.md § 3 as "the
 * sanctioned defineComponent-over-defineCompound call"), and the full argument
 * travels with the code rather than living only in a report:
 *
 *   - The skill pairs category 2 with `defineCompound` because in soribashi a
 *     transient overlay is a wrapper over BASE UI parts, whose open/close
 *     lifecycle Base UI owns. THIS KIT HAS NO @base-ui/react DEPENDENCY AND
 *     NONE PLANNED (task-8-report.md § 1): the markup is mr-board's own, and
 *     the lifecycle is the caller's `{open && <Modal …/>}` conditional plus
 *     Task 7's `useEscapeClose`/`useBodyScrollLock` hooks. The premise the
 *     pairing rests on is simply absent.
 *   - The real test for `defineCompound` is COMPOSABILITY, not slot count
 *     (skill § 12): reach for it only when a consumer genuinely imports and
 *     orders the parts themselves (`<Modal.Root><Modal.Title/>…`). mr-board's
 *     Modal is one component taking `title` / `children` / `closeGlyph` and
 *     rendering overlay + frame itself; there is no `Modal.Overlay` anyone
 *     imports, and inventing one would be an API promotion the spec lists
 *     this recipe under straight ports. soribashi's own Alert (five slots) and
 *     Checkbox (four) are single `defineComponent` recipes for exactly this
 *     reason.
 *   - Two concrete things follow from staying on `defineComponent`, both of
 *     which have bitten soribashi: `defineCompound` does not call `autoVars`
 *     at all (skill § 4), and its `getStyles` takes an options object
 *     (`getStyles({ part: 'x' })`) rather than the bare-string form used
 *     throughout this file. Neither applies here.
 *
 * So `overlay` / `head` / `title` / `close` are STYLE SLOTS and `data-part`
 * values, not parts, and `RecipeMeta.parts` is correctly empty.
 *
 * Read by scripts/derive.ts to build the kit's manifest; not itself derived,
 * since it records an authoring decision, not a fact recoverable from
 * RecipeMeta or the CSS.
 */
export const recipeCategory = 2 as const;

/**
 * The recipe's style slots, matching mr-board's `.tui-modal*` family
 * one-for-one:
 *
 *   `root`    -> `.tui-modal`          (the dialog FRAME)
 *   `overlay` -> `.tui-modal-overlay`  (the fixed scrim)
 *   `head`    -> `.tui-modal-head`
 *   `title`   -> `.tui-modal-title`
 *   `close`   -> `.tui-modal-x`
 *
 * WHY `root` IS THE FRAME AND NOT THE OUTERMOST ELEMENT. `useStyles` merges
 * the consumer's own `className` and `style` into `getStyles(...)` ONLY for
 * the `root` selector (`rootInstanceClass = isRoot ? config.className : ''`,
 * hooks/use-styles.ts), and the universal style props land on `root` too. In
 * mr-board's Modal, `className` means `.tui-modal` — the frame — and
 * `overlayClassName` is the separate prop for the scrim. Making the frame the
 * root is therefore the only mapping under which ReviewModal's
 * `className="tui-review-modal"` keeps landing where its board rule expects
 * it, for free, through the machinery rather than by hand. `overlayClassName`
 * is threaded to the overlay slot explicitly, via `getStyles`'s per-call
 * `className` option. Pinned by Modal.test.tsx's "routes className to the
 * FRAME and overlayClassName to the OVERLAY".
 */
const MODAL_SELECTORS = ["root", "overlay", "head", "title", "close"] as const;

/**
 * tui-kit's `data-part` convention (design spec § "Parity mechanics" 1;
 * controller ruling R7 — task-8-report.md § 5, which SUPERSEDES this task's
 * own brief). Self-identifying, so each value works standing alone from
 * mr-board's residual `style.css` without needing an ancestor to disambiguate
 * which recipe it is:
 *
 *   root slot    -> "modal"          (the drop-in replacement for `.tui-modal`)
 *   overlay slot -> "modal-overlay"  (`.tui-modal-overlay`)
 *   head slot    -> "modal-head"     (`.tui-modal-head`)
 *   title slot   -> "modal-title"    (`.tui-modal-title`)
 *   close slot   -> "modal-close"    (`.tui-modal-x`)
 *
 * THE ROOT VALUE IS THE BARE `modal` (controller ruling R12). This recipe
 * briefly shipped `modal-frame`, on the reading that the controller had named
 * overlay and frame explicitly; R12 settles it the other way, and correctly —
 * § 5's rule is `root -> <lowercased recipe name>`, the frame IS the root
 * slot (see MODAL_SELECTORS above for why the frame and not the overlay holds
 * that position), and every other recipe in the kit follows the bare form
 * (`panel`, `sidedrawer`, `chip`, `segmented`). The `-frame` suffix
 * bought nothing `modal` beside `modal-overlay` did not already read
 * unambiguously, and cost the kit its one exception.
 *
 * ADOPTION NOTE, TWO RULES THAT MUST SURVIVE. `.tui-modal-title` and
 * `.tui-modal-x` are absorbed here AND still used app-side: Board.tsx's mobile
 * drawer head and CommentsDrawer's head each render their own
 * `<span className="tui-modal-title">` / `<button className="tui-modal-x">`
 * inside a SideDrawer's `children`. Those elements are not Modal slots, so
 * deleting either board rule at adoption would silently unstyle both drawer
 * heads. Keep both; this recipe's copies are additional, not replacements.
 *
 * THE SPREAD POSITION IS PART OF THE CONVENTION: `data-part` is stamped in
 * the NON-OVERRIDABLE TAIL, after `{...rest}`, alongside `getStyles` — see
 * Icon.tsx's/Chip.tsx's identical comment for the failure mode this closes.
 * Pinned by Modal.test.tsx's "a consumer-supplied data-part does not win".
 */
export const MODAL_PARTS = {
  root: "modal",
  overlay: "modal-overlay",
  head: "modal-head",
  title: "modal-title",
  close: "modal-close",
} as const;

/**
 * The four values in mr-board's `.tui-modal*` family with no theme rung, each
 * routed through a recipe-local custom property. See Modal.module.css's block
 * comment for why each one has no rung (three are viewport- or em-relative;
 * `420px` is a fixed dialog measure, not a spacing literal). Unconditional —
 * not keyed by props — the same shape ToastHost's `TOASTHOST_SCALARS` and
 * Panel's `PANEL_TITLE_SCALARS` have.
 */
const MODAL_SCALARS = {
  overlayPadY: "8vh",
  maxWidth: "420px",
  maxHeight: "80vh",
  titleTracking: "0.02em",
} as const;

/**
 * The recipe's OWN props. The full public surface is `ModalProps` below: this,
 * plus every div attribute, plus the Styles API and the universal style props
 * the builder adds for free.
 */
export interface ModalOwnProps {
  /** The head row's label. A ReactNode, not a string: mr-board's callers pass
      fragments (`<>❯ review · !{mr.iid}</>`). */
  title: ReactNode;
  /** The dialog's accessible name (`aria-label` on the frame). */
  ariaLabel: string;
  /** Called on Escape, on an overlay click, and from the close button. */
  onClose: () => void;
  /**
   * Replaces the default `ICONS.close` svg in the close button. Exists solely
   * for SettingsModal, whose close button has always rendered a literal "✕" —
   * a real visual difference, not an oversight, so it is preserved via this
   * prop instead of unified away. Comment carried over from mr-board's own
   * `src/client/ui/Modal.tsx`.
   */
  closeGlyph?: ReactNode;
  /**
   * A class for the OVERLAY. `className` (which every builder already accepts)
   * dresses the FRAME — see MODAL_SELECTORS's comment for why the frame is the
   * root slot and this is the one that needs its own prop.
   */
  overlayClassName?: string;
  children?: ReactNode;
}

type ModalProps_ = ModalOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "title" | "children">;

export const Modal = defineComponent<
  ModalProps_,
  typeof MODAL_SELECTORS,
  readonly [],
  readonly []
>({
  name: "Modal",
  selectors: MODAL_SELECTORS,
  classes,
  // A RECIPE-SUPPLIED `vars` RESOLVER REPLACES THE BUILDER'S AUTOMATIC
  // autoVars CALL (skill § 4 + § 10) — but Modal declares no `variants`, so
  // there is no auto-derived output to preserve/merge here (task-8-report.md
  // § 4's second corollary): this `vars` key is only the four scalars above.
  vars: () => ({
    overlay: { "--sb-modal-overlay-pad-y": MODAL_SCALARS.overlayPadY },
    root: {
      "--sb-modal-max-w": MODAL_SCALARS.maxWidth,
      "--sb-modal-max-h": MODAL_SCALARS.maxHeight,
    },
    title: { "--sb-modal-title-tracking": MODAL_SCALARS.titleTracking },
  }),
  render: ({ props, getStyles, ref }) => {
    // The Styles API's own config keys are consumed internally by useStyles
    // and are not valid DOM attributes, so they are stripped here the same way
    // every prior recipe strips them. No vocabulary-axis destructure is
    // needed: Modal opts into no axes.
    const {
      title,
      ariaLabel,
      onClose,
      closeGlyph,
      overlayClassName,
      children,
      classNames: _classNames,
      styles: _styles,
      vars: _vars,
      attributes: _attributes,
      unstyled: _unstyled,
      ...rest
    } = props;

    // `render` runs inside the builder's own forwardRef function-component
    // body on every render (see define-component.tsx, and CopyButton.tsx's /
    // Panel.tsx's identical comment), so hooks called here obey the rules of
    // hooks exactly as if written directly in a function component.
    //
    // Both calls are VERBATIM from mr-board's own Modal, in the same order.
    // `useEscapeClose` joins the shared LIFO layer stack, so Escape closes
    // only the TOPMOST open modal/drawer/menu; `useBodyScrollLock` takes one
    // counted lock, so stacked overlays don't have to unmount in mount order.
    // Both behaviours are pinned in Modal.test.tsx rather than assumed.
    useEscapeClose(onClose);
    useBodyScrollLock();

    return (
      <div
        // The overlay is NOT the root slot (see MODAL_SELECTORS), so it takes
        // no `{...rest}`: everything a consumer passes belongs to the frame,
        // exactly as in mr-board. `overlayClassName` is threaded through
        // getStyles's per-call `className` option so it merges with the
        // recipe's own class rather than replacing it.
        {...getStyles("overlay", { className: overlayClassName })}
        data-part={MODAL_PARTS.overlay}
        onClick={onClose}
      >
        <div
          // KNOWN SORIBASHI LIMITATION (SORI-14, filed against Icon's svg
          // root): every builder's render ctx types `ref` as `Ref<HTMLElement>`
          // rather than the element this recipe actually renders, so a cast is
          // required even though `<div>` IS an HTMLElement.
          ref={ref as Ref<HTMLDivElement>}
          // Band 1, the overridable head: mr-board's own presentation
          // defaults. `role`/`aria-modal` are a documented courtesy — a
          // consumer may replace either, the same way ToastHost's role is
          // replaceable.
          role="dialog"
          aria-modal
          // Band 2: everything the consumer passed, `className` included (the
          // builder has already folded it into getStyles("root") below).
          {...rest}
          // Band 3, the non-overridable tail — nothing below may be replaced
          // from a call site.
          //
          // `aria-label` lives here rather than in band 1 because it is
          // DERIVED from an own prop (`ariaLabel`), the same reasoning
          // Panel's `data-collapsed` and StatusDot's `data-tip` give.
          //
          // `onClick` likewise: the stopPropagation is STRUCTURAL — it is the
          // only thing keeping a click inside the dialog from bubbling to the
          // overlay and closing it. Carried verbatim from mr-board, including
          // the consequence that a consumer-supplied `onClick` on the frame is
          // replaced rather than composed. No mr-board call site passes one;
          // composing the two would be an API change, not a port.
          {...getStyles("root")}
          data-part={MODAL_PARTS.root}
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
        >
          <div {...getStyles("head")} data-part={MODAL_PARTS.head}>
            <span {...getStyles("title")} data-part={MODAL_PARTS.title}>
              {title}
            </span>
            <button
              type="button"
              {...getStyles("close")}
              data-part={MODAL_PARTS.close}
              onClick={onClose}
              aria-label="close"
            >
              {closeGlyph ?? ICONS.close}
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type ModalProps = ComponentProps<typeof Modal>;

/**
 * The recipe's theme-entry convenience export — the no-op `.extend({})` a
 * consumer's `createTheme({ components: [...] })` can start from.
 */
export const modalTheme = Modal.extend({});
