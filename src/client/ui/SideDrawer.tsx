import type { ReactNode } from "react";
import { useEscapeClose, useBodyScrollLock } from "./hooks.ts";

/** Shared frame for the app's side drawers: overlay around a stopPropagation'd
    panel, dialog semantics, and Escape-to-close. Unlike Modal, the drawer has
    no built-in title/close row — CommentsDrawer's and the mobile drawer's
    heads differ enough (icon-close button vs. plain title, different classes)
    that they render their own inside `children`. `onOverlayClick` exists for
    CommentsDrawer, which renders inside a clickable row and needs to stop that
    click from bubbling before closing; every other caller just closes. */
function SideDrawer({
  overlayClassName,
  panelClassName,
  ariaLabel,
  onClose,
  onOverlayClick,
  children,
}: {
  overlayClassName: string;
  panelClassName: string;
  ariaLabel: string;
  onClose: () => void;
  onOverlayClick?: (e: React.MouseEvent) => void;
  children: ReactNode;
}) {
  useEscapeClose(onClose);
  useBodyScrollLock();
  return (
    <div className={overlayClassName} onClick={onOverlayClick ?? onClose}>
      <div className={panelClassName} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={ariaLabel}>
        {children}
      </div>
    </div>
  );
}

export { SideDrawer };
