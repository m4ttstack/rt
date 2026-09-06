import { TOASTHOST_PARTS, ToastHost } from "@mattstack/tui-kit";
import { useToasts } from "@mattstack/tui-kit/hooks";

/**
 * The ToastHost recipe's workshop page.
 *
 * Imports the recipe from the BARREL (`@mattstack/tui-kit`, aliased to
 * `../src` by workshop/vite.config.ts) — same rule Chips.tsx/StatusDots.tsx
 * follow — and `useToasts` from its own `/hooks` subpath export, since the
 * barrel itself stays recipes-only through Task 14 (controller ruling R9;
 * see src/index.ts's own comment). This page is the first in the workshop to
 * exercise a recipe alongside the hook it's designed to pair with.
 *
 * No scheme toggle of its own — the sidebar's Dark button flips `.dark` on
 * <html>, and the toast card's colours (`--card`/`--border`/`--accent`/
 * `--fg`) follow through the theme with zero wiring here.
 */

export function ToastHosts() {
  const { toasts, addToast } = useToasts();

  return (
    <div>
      <h1>ToastHost</h1>
      <p>
        mr-board's <code>.tui-toasts</code>/<code>.tui-toast</code> transient
        confirmation stack, fixed to the viewport's bottom-right. Pairs with
        Task 7's <code>useToasts()</code> hook — every button below calls the
        SAME <code>addToast</code>, so firing several in a row shows the real
        stacking/self-removal behaviour (each entry clears itself after
        3.5s).
      </p>

      <h2 style={{ marginTop: "2rem" }}>fire a toast</h2>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem" }}>
        <button type="button" onClick={() => addToast("posted to slack")}>
          posted to slack
        </button>
        <button type="button" onClick={() => addToast("copied")}>
          copied
        </button>
        <button
          type="button"
          onClick={() => addToast("re-review requested from bob, carol")}
        >
          re-review requested
        </button>
      </div>

      <h2 style={{ marginTop: "2rem" }}>role / aria-live</h2>
      <p>
        The host carries <code>role="status"</code> and{" "}
        <code>aria-live="polite"</code> by default (both overridable — see
        <code> data-part</code> below for the same non-overridable-tail
        convention every other recipe follows). An empty queue renders
        nothing at all, verbatim from mr-board's own <code>ToastHost</code>.
      </p>

      <h2 style={{ marginTop: "2rem" }}>data-part</h2>
      <p>
        The host carries <code>data-part="{TOASTHOST_PARTS.root}"</code>, and
        each entry <code>data-part="{TOASTHOST_PARTS.toast}"</code> — the
        tui-kit convention that replaces the hashed CSS-module class name as
        mr-board's cross-boundary selector hook: <code>.tui-toasts</code>{" "}
        becomes <code>[data-part="toasthost"]</code>, and{" "}
        <code>.tui-toast</code> becomes{" "}
        <code>[data-part="toasthost-toast"]</code>.
      </p>

      <ToastHost toasts={toasts} />
    </div>
  );
}
