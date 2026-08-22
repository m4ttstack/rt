import type { CSSProperties, HTMLAttributes, ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** The old CSS `transition-delay` before the card faded in, now a show timer:
    a quick pass-through hover shouldn't flash a card. Hiding stays immediate
    (no matching hide delay) — that half was never delayed either. */
export const TOOLTIP_SHOW_DELAY_MS = 150;

/** Clamped distance from the viewport edges, mirroring ContextMenu's own
    VIEWPORT_MARGIN: consumed in JS geometry, not a spacing token. */
const VIEWPORT_MARGIN = 8;

/** Visible while the pointer is over `triggerRef`'s element, or (when
    `focusWithin`) focus sits anywhere inside it — gated by
    `TOOLTIP_SHOW_DELAY_MS` on entry, immediate on exit. Listens on the DOM
    node directly rather than through React props, so a consumer's own
    `onMouseEnter`/`onFocus` on the trigger is never at risk of being
    clobbered. Also closes immediately on window scroll/resize: a position
    computed at a scroll offset that has since changed is wrong, and closing
    is simpler and safer than re-measuring mid-scroll. */
export function useTooltipReveal(
  triggerRef: RefObject<HTMLElement | null>,
  { active, focusWithin }: { active: boolean; focusWithin: boolean },
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) return;
    const el = triggerRef.current;
    if (!el) return;

    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const clearShowTimer = () => {
      if (showTimer !== null) {
        clearTimeout(showTimer);
        showTimer = null;
      }
    };
    const show = () => {
      clearShowTimer();
      showTimer = setTimeout(() => setVisible(true), TOOLTIP_SHOW_DELAY_MS);
    };
    const hide = () => {
      clearShowTimer();
      setVisible(false);
    };
    // focusin/focusout (not focus/blur) — the ones that bubble, so a single
    // listener on the trigger sees focus land on or leave any descendant.
    const onFocusIn = (e: FocusEvent) => {
      if (el.contains(e.target as Node)) show();
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !el.contains(next)) hide();
    };

    el.addEventListener("mouseenter", show);
    el.addEventListener("mouseleave", hide);
    if (focusWithin) {
      el.addEventListener("focusin", onFocusIn);
      el.addEventListener("focusout", onFocusOut);
    }
    return () => {
      clearShowTimer();
      el.removeEventListener("mouseenter", show);
      el.removeEventListener("mouseleave", hide);
      if (focusWithin) {
        el.removeEventListener("focusin", onFocusIn);
        el.removeEventListener("focusout", onFocusOut);
      }
    };
  }, [triggerRef, active, focusWithin]);

  useEffect(() => {
    if (!visible) return;
    const close = () => setVisible(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [visible]);

  return visible;
}

/** Reads a trigger-scoped CSS custom property as resolved pixels. The card
    portals to `document.body`, OUTSIDE the trigger's subtree, so it cannot
    inherit a custom property the trigger carries on itself (`--sb-tooltip-gap`,
    `--sd-tooltip-gap`) the way it could when the two were DOM siblings. This
    measures the property off a throwaway CHILD of the trigger instead, where
    it's still in scope, and lets a real layout property (`height`) do the
    rem/em/px unit conversion rather than reimplementing it by parsing the
    custom property's raw string. */
function resolveGapPx(scopeEl: HTMLElement, varName: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;";
  probe.style.height = `var(${varName})`;
  scopeEl.appendChild(probe);
  const px = Number.parseFloat(getComputedStyle(probe).height);
  scopeEl.removeChild(probe);
  return Number.isFinite(px) ? px : 0;
}

interface TooltipCardProps {
  triggerRef: RefObject<HTMLElement | null>;
  visible: boolean;
  /** The trigger-scoped gap custom property name, resolved via `resolveGapPx`. */
  gapVar: string;
  part: string;
  cardProps: HTMLAttributes<HTMLDivElement> & { className?: string; style?: CSSProperties };
  children: ReactNode;
}

/** The hover card, portaled to `document.body` so no ancestor's `overflow`
    can clip it — a `position: fixed` descendant is STILL clipped by an
    overflow ancestor's paint clip (only leaving that subtree fixes it, a
    plain `position: fixed` is not enough). Renders NOTHING while hidden, not
    merely invisibly: an always-mounted hidden node is exactly what inflated
    an `overflow-x: auto` ancestor's `scrollHeight` under the old `::after`.
    `aria-hidden` and `data-part` are stamped in the tail, after `cardProps`,
    so neither is overridable — the card exposes nothing to AT by contract. */
export function TooltipCard({ triggerRef, visible, gapVar, part, cardProps, children }: TooltipCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Portal creation deferred to an effect, not computed during render — the
  // deck server does renderToStaticMarkup of OTHER components in this same
  // bundle, and `visible` starts false so this branch is unreached during any
  // SSR pass regardless, but the mount gate makes that a structural
  // guarantee rather than a fact about the initial state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Renders once already visible (hidden, unclamped) so `cardRef` exists to
  // measure — same two-step shape as ContextMenu's own clamp.
  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!trigger || !card) return;
    const rect = trigger.getBoundingClientRect();
    const gap = resolveGapPx(trigger, gapVar);
    const width = card.offsetWidth;
    // Only the RIGHT edge is clamped (per contract) — `rect.left` wins
    // whenever the card already fits, so a trigger flush against the left
    // edge still gets a card flush against it too, not nudged in by a floor
    // margin nothing asked for.
    const left = Math.max(0, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
    setPos({ left, top: rect.bottom + gap });
  }, [visible, triggerRef, gapVar]);

  if (!mounted || !visible) return null;

  const trigger = triggerRef.current;
  const fallback = trigger?.getBoundingClientRect();
  const style: CSSProperties = pos
    ? { ...cardProps.style, left: pos.left, top: pos.top }
    : {
        ...cardProps.style,
        left: fallback?.left ?? 0,
        top: fallback?.bottom ?? 0,
        visibility: "hidden",
      };

  return createPortal(
    <div {...cardProps} ref={cardRef} style={style} data-part={part} aria-hidden="true">
      {children}
    </div>,
    document.body,
  );
}
