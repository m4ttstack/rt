import type { ReactNode } from "react";
import { ICONS } from "./Icon.tsx";
import { useEscapeClose } from "./hooks.ts";

/** Shared frame for the app's centered modals: overlay (click to close) around
    a stopPropagation'd panel with a title row and close button. Callers supply
    only their content; the skeleton (classes, dialog semantics, Escape) is
    identical across every modal in the app. `closeGlyph` exists solely for
    SettingsModal, whose close button has always rendered a literal "✕" rather
    than the ICONS.close svg the other modals use — a real visual difference,
    not an oversight, so it's preserved via the prop instead of unified away. */
function Modal({
  title,
  ariaLabel,
  onClose,
  className,
  overlayClassName,
  closeGlyph,
  children,
}: {
  title: ReactNode;
  ariaLabel: string;
  onClose: () => void;
  className?: string;
  overlayClassName?: string;
  closeGlyph?: ReactNode;
  children: ReactNode;
}) {
  useEscapeClose(onClose);
  return (
    <div
      className={overlayClassName ? `tui-modal-overlay ${overlayClassName}` : "tui-modal-overlay"}
      onClick={onClose}
    >
      <div
        className={className ? `tui-modal ${className}` : "tui-modal"}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={ariaLabel}
      >
        <div className="tui-modal-head">
          <span className="tui-modal-title">{title}</span>
          <button className="tui-modal-x" onClick={onClose} aria-label="close">
            {closeGlyph ?? ICONS.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export { Modal };
