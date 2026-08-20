import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { pushLayer, handleEscape } from "./layers.ts";
import { acquireScrollLock, releaseScrollLock } from "./scroll-lock.ts";

// Re-exported so a consumer importing only the `./hooks` subpath can still
// exercise the DOM-free cores in its own tests.
export { pushLayer, handleEscape, acquireScrollLock, releaseScrollLock };
export type { OverflowTarget } from "./scroll-lock.ts";

/** Scrolls the returned ref's element into its scroll container whenever `key`
    turns truthy or changes, for content that can render below the fold of a
    height-capped modal. `block: "nearest"` is deliberate: it is a no-op when
    the element is already visible, so this never yanks a settled modal around. */
function useRevealOnChange<T extends HTMLElement = HTMLElement>(key: unknown) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (key) ref.current?.scrollIntoView({ block: "nearest" });
  }, [key]);
  return ref;
}

// One shared document listener for all layers, registered on the first push
// and torn down on the last pop.
let openLayers = 0;
let escListener: ((e: KeyboardEvent) => void) | null = null;

/** Join the app's layer stack for the calling component's lifetime: Escape
    closes only the topmost open layer, not every one at once. The pushed
    closure's identity never changes (once per mount, not once per render), so
    a re-rendered lower layer cannot re-register itself to the top of the
    stack; `onClose` is read through a ref kept current every render. */
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
    changes. Two traps, both load-bearing: reset to "auto" first or the box can
    only ever grow (scrollHeight is clamped by the current height, so deleting
    text would leave the extra rows behind); and add the border back, because
    scrollHeight covers content + padding but not the border while border-box
    `height` is responsible for it. The border is measured off the element
    rather than hardcoded, so it survives a CSS change. */
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

/** Lock body scroll for the calling component's lifetime. Counter-based (see
    scroll-lock.ts) so instances need not unmount in mount order. */
function useBodyScrollLock(): void {
  useEffect(() => {
    acquireScrollLock(document.body.style);
    return () => {
      releaseScrollLock(document.body.style);
    };
  }, []);
}

/** One transient toast: a fresh id per addToast() call and the text to show. */
interface Toast {
  id: number;
  text: string;
}

/** Transient toast queue: each addToast() call appends one with a fresh id and
    self-removes it after 3.5s. */
function useToasts(): { toasts: Toast[]; addToast: (text: string) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const addToast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return { toasts, addToast };
}

export { useRevealOnChange, useEscapeClose, useAutoGrowTextarea, useBodyScrollLock, useToasts };
export type { Toast };
