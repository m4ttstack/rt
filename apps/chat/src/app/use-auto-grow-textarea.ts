import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Sizes a `rows={1}` textarea to its content on every `value` change. The
 * reset to `auto` first is what lets the box shrink: `scrollHeight` never
 * reports less than the current fixed height, so measuring without it can
 * only ever grow. Assumes `box-sizing: border-box` (the app's global
 * reset), under which `scrollHeight` already includes the padding.
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
