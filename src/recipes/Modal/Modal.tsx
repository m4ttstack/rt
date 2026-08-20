import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { defineComponent } from "../../builders.ts";
import { useBodyScrollLock, useEscapeClose } from "../../hooks/index.ts";
import { ICONS } from "../Icon/Icon.tsx";
import classes from "./Modal.module.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code.
    Built on `defineComponent`, not `defineCompound` — see docs/decisions.md. */
export const recipeCategory = 2 as const;

/** `root` IS THE FRAME, not the outermost element: `useStyles` merges a
    consumer's `className`/`style` into the `root` selector only, and in
    mr-board `className` means the frame while `overlayClassName` dresses the
    scrim. Any other mapping lands a consumer's class on the wrong element. */
const MODAL_SELECTORS = ["root", "overlay", "head", "title", "close"] as const;

/** Stable selector surface for app-side CSS, stamped in the non-overridable
    tail so a call site cannot sever an app's `[data-part]` rules.
    `.tui-modal-title` and `.tui-modal-x` are absorbed here AND still used
    app-side by two drawer heads — deleting either board rule at adoption
    silently unstyles them. See docs/decisions.md. */
export const MODAL_PARTS = {
  root: "modal",
  overlay: "modal-overlay",
  head: "modal-head",
  title: "modal-title",
  close: "modal-close",
} as const;

/** Verbatim mr-board values with no theme rung (viewport- or em-relative, or a
    fixed dialog measure), routed through recipe-local custom properties. */
const MODAL_SCALARS = {
  overlayPadY: "8vh",
  maxWidth: "420px",
  maxHeight: "80vh",
  titleTracking: "0.02em",
} as const;

/** Modal's own props; `ModalProps` below is the full public surface. */
export interface ModalOwnProps {
  /** The head row's label. A ReactNode: callers pass fragments. */
  title: ReactNode;
  /** The dialog's accessible name (`aria-label` on the frame). */
  ariaLabel: string;
  /** Called on Escape, on an overlay click, and from the close button. */
  onClose: () => void;
  /** Replaces the default `ICONS.close` svg. Exists for SettingsModal, whose
      literal "✕" is a real visual difference, preserved not unified away. */
  closeGlyph?: ReactNode;
  /** A class for the OVERLAY; `className` dresses the FRAME. */
  overlayClassName?: string;
  children?: ReactNode;
}

type ModalProps_ = ModalOwnProps & Omit<HTMLAttributes<HTMLDivElement>, "ref" | "title" | "children">;

export const Modal = defineComponent<
  ModalProps_,
  typeof MODAL_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "Modal",
  selectors: MODAL_SELECTORS,
  classes,
  // Nothing to merge with the builder's automatic autoVars output, which a
  // recipe-supplied resolver replaces: Modal declares no `variants`.
  vars: () => ({
    overlay: { "--sb-modal-overlay-pad-y": MODAL_SCALARS.overlayPadY },
    root: {
      "--sb-modal-max-w": MODAL_SCALARS.maxWidth,
      "--sb-modal-max-h": MODAL_SCALARS.maxHeight,
    },
    title: { "--sb-modal-title-tracking": MODAL_SCALARS.titleTracking },
  }),
  render: ({ props, getStyles, ref }) => {
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

    // `render` runs inside the builder's own forwardRef component body on every
    // render, so hooks here obey the rules of hooks normally.
    useEscapeClose(onClose);
    useBodyScrollLock();

    return (
      <div
        // The overlay is not the root slot, so it takes no `{...rest}`:
        // everything a consumer passes belongs to the frame. `overlayClassName`
        // goes through getStyles's per-call option so it merges with the
        // recipe's own class rather than replacing it.
        {...getStyles("overlay", { className: overlayClassName })}
        data-part={MODAL_PARTS.overlay}
        onClick={onClose}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal
          {...rest}
          // Non-overridable tail. `onClick`'s stopPropagation is STRUCTURAL —
          // the only thing keeping a click inside the dialog from bubbling to
          // the overlay and closing it — so a consumer's own frame `onClick` is
          // replaced rather than composed, exactly as in mr-board.
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

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const modalTheme = Modal.extend({});
