import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Pos {
  x: number;
  y: number;
  below: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * A real hover/focus tooltip (not the native title attribute). Portaled to <body> with
 * fixed positioning so it escapes the table's overflow-x-auto clipping, flips below the
 * trigger when near the top of the viewport, and clamps to stay on-screen horizontally.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 140;
    setPos({
      x: clamp(r.left + r.width / 2, 180, window.innerWidth - 180),
      y: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
      className="cursor-help decoration-slate-500 decoration-dotted underline-offset-4 outline-none hover:underline focus-visible:underline"
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, ${pos.below ? "0" : "-100%"})`,
            }}
            className="pointer-events-none z-50 w-64 rounded-lg border border-white/10 bg-[#161b26] px-3 py-2 text-left text-xs font-normal normal-case leading-snug text-slate-200 shadow-xl shadow-black/40"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
