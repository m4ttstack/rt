import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** Scrolls the returned ref's element into its scroll container whenever `key`
    turns truthy or changes. For content that appears at the bottom of a capped,
    scrollable modal: the settings modal stops at 80vh, so a fresh invite row or
    an expanded join input can render below the fold with nothing to bring it
    into view. `block: "nearest"` is deliberate -- it's a no-op when the element
    is already visible, so this never yanks a settled modal around. */
function useRevealOnChange<T extends HTMLElement = HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (key) ref.current?.scrollIntoView({ block: "nearest" });
  }, [key]);
  return ref;
}

/** Close a modal on Escape, for the lifetime of the calling component. */
function useEscapeClose(onClose: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Auto-grow a textarea to fit its content, re-measuring whenever `deps`
    changes. Reset to "auto" first or the box can only ever grow -- scrollHeight
    is clamped by the current height, so deleting text would leave the extra
    rows behind. scrollHeight covers content + padding but NOT the border, while
    the global box-sizing: border-box makes `height` responsible for the border
    too; assigning scrollHeight alone would leave the box a border's worth short
    of its own content. Measure the border off the element rather than
    hardcoding the stylesheet's width, so it survives a CSS change. */
function useAutoGrowTextarea(deps: readonly unknown[]): RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, deps);
  return ref;
}

/** Lock body scroll for the calling component's lifetime, restoring whatever
    the body's overflow was before. Keeps a modal/drawer's own scroll region
    from showing a second scrollbar alongside the page's. */
function useBodyScrollLock(): void {
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);
}

export { useRevealOnChange, useEscapeClose, useAutoGrowTextarea, useBodyScrollLock };
