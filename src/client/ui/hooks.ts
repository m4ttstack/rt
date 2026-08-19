import { useEffect, useRef } from "react";

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

export { useRevealOnChange, useEscapeClose };
