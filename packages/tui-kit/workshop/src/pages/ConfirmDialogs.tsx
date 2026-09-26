import { ConfirmDialog } from "@mattstack/tui-kit";
import { useState } from "react";

/**
 * The ConfirmDialog recipe's workshop page.
 *
 * Imports from the BARREL (`@mattstack/tui-kit`, aliased to `../src` by
 * workshop/vite.config.ts), never a deep `../../src/recipes/…` path — same
 * rule every other page follows.
 *
 * OPENED BY A BUTTON rather than rendered permanently, same reasoning as
 * Modals.tsx: `ConfirmDialog` renders Modal underneath, which takes the whole
 * viewport and locks body scroll for as long as it is mounted.
 */

export function ConfirmDialogs() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <h1>ConfirmDialog</h1>
      <p>
        A destructive-action confirm built on Modal: a title, a body, and two{" "}
        <code>size="sm"</code> buttons — Cancel and a confirm whose{" "}
        <code>intent</code> defaults to <code>"bad"</code>. Initial focus lands
        on Cancel, not the confirm button, so a stray Enter never triggers the
        destructive action. Escape, an overlay click, and Modal's own close
        button all cancel, same as clicking Cancel.
      </p>

      <button type="button" onClick={() => setOpen(true)}>
        remove myapp
      </button>

      <ConfirmDialog
        open={open}
        title="Remove myapp?"
        confirmLabel="Remove"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        This deletes its service and route.
      </ConfirmDialog>
    </div>
  );
}
