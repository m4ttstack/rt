import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { defineComponent } from "../../builders.ts";
import { Button } from "../Button/Button.tsx";
import { Modal } from "../Modal/Modal.tsx";
import classes from "./ConfirmDialog.module.css";

/** Authoring category (2 = transient overlay). Read off this module by
    scripts/derive.ts to build the kit's manifest; not dead code.
    Built on `defineComponent`, not `defineCompound` — see docs/decisions.md;
    the caller's `open` prop is the whole lifecycle, same as Modal/SideDrawer. */
export const recipeCategory = 2 as const;

/** Modal owns the overlay, frame, head, and close button; this recipe renders
    only its own body and foot INTO Modal's children, so `root` names the
    Modal instance itself rather than a slot this module draws. */
const CONFIRMDIALOG_SELECTORS = ["root", "body", "foot"] as const;

/** Stable selector surface for app-side CSS. `body` and `foot` are stamped
    in the non-overridable tail so a call site cannot sever an app's
    `[data-part]` rules; `root` is Modal's frame, not stamped by this recipe. */
export const CONFIRMDIALOG_PARTS = {
  root: "confirmdialog",
  body: "confirmdialog-body",
  foot: "confirmdialog-foot",
} as const;

/** ConfirmDialog's own props; `ConfirmDialogProps` below is the full public surface. */
export interface ConfirmDialogOwnProps {
  open: boolean;
  /** The head row's label, and (when a string, with no `ariaLabel` given) the
      dialog's accessible name. */
  title: ReactNode;
  onConfirm: () => void;
  /** Called on cancel, on Escape, and on an overlay click — Modal's `onClose`
      routes all three here, so cancelling and closing are the same action. */
  onCancel: () => void;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  /** The confirm button's intent. Destructive by default; "accent" is for a
      confirm that isn't itself destructive (only the copy is a warning). */
  intent?: "bad" | "accent";
  ariaLabel?: string;
  children?: ReactNode;
}

export const ConfirmDialog = defineComponent<
  ConfirmDialogOwnProps,
  typeof CONFIRMDIALOG_SELECTORS,
  readonly [],
  readonly [],
  HTMLDivElement
>({
  name: "ConfirmDialog",
  selectors: CONFIRMDIALOG_SELECTORS,
  classes,
  render: ({ props, getStyles, ref }) => {
    const { open, title, onConfirm, onCancel, confirmLabel, cancelLabel, intent, ariaLabel, children } =
      props;

    const cancelRef = useRef<HTMLButtonElement>(null);

    // `render` runs inside the builder's own forwardRef component body on
    // every render, so hooks here obey the rules of hooks normally — the
    // early return below stays AFTER every hook call. Deps on `open` alone:
    // a re-render while already open must not steal focus back mid-interaction.
    useEffect(() => {
      if (open) cancelRef.current?.focus();
    }, [open]);

    if (!open) return null;

    // Modal's `ariaLabel` is required; the empty string only surfaces when
    // `title` is a non-string node AND no `ariaLabel` was given.
    const resolvedAriaLabel = ariaLabel ?? (typeof title === "string" ? title : "");

    return (
      <Modal
        ref={ref}
        {...getStyles("root")}
        title={title}
        ariaLabel={resolvedAriaLabel}
        onClose={onCancel}
      >
        <div {...getStyles("body")} data-part={CONFIRMDIALOG_PARTS.body}>
          {children}
        </div>
        <div {...getStyles("foot")} data-part={CONFIRMDIALOG_PARTS.foot}>
          <Button ref={cancelRef} size="sm" onClick={onCancel}>
            {cancelLabel ?? "Cancel"}
          </Button>
          <Button size="sm" intent={intent ?? "bad"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    );
  },
});

/** Everything a call site may pass, own props included. */
export type ConfirmDialogProps = ComponentProps<typeof ConfirmDialog>;

/** No-op `.extend({})` a consumer's `createTheme({ components })` starts from. */
export const confirmDialogTheme = ConfirmDialog.extend({});
