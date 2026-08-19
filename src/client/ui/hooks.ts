import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { pushLayer, handleEscape } from "./layers.ts";

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

// Layers share a single document listener -- registered when the first layer
// pushes, torn down when the last one pops -- rather than one listener per
// open modal/drawer/menu. Escape delegates to layers.ts's stack, which pops
// only the topmost layer (see that module for the LIFO semantics).
let openLayers = 0;
let escListener: ((e: KeyboardEvent) => void) | null = null;

/** Join the app's layer stack for the lifetime of the calling component:
    Escape closes only the topmost open layer (modal, drawer, or menu), not
    every open layer at once. Pushes a stable wrapper once per mount (not once
    per render) so a re-rendered lower layer never re-registers itself to the
    top of the stack -- `onClose` is read through a ref that's kept current
    every render, while the pushed closure's identity never changes. */
function useEscapeClose(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const pop = pushLayer(() => onCloseRef.current());
    openLayers++;
    if (!escListener) {
      escListener = (e: KeyboardEvent) => {
        if (e.key === "Escape") handleEscape();
      };
      document.addEventListener("keydown", escListener);
    }
    return () => {
      pop();
      openLayers--;
      if (openLayers === 0 && escListener) {
        document.removeEventListener("keydown", escListener);
        escListener = null;
      }
    };
  }, []);
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
