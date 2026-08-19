import type { Toast } from "../types.ts";

/** Bottom-right stack of transient confirmations. */
function ToastHost({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="tui-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="tui-toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export { ToastHost };
