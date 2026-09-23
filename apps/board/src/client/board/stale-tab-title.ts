import { useEffect } from 'react';

const STALE_MARK = '⚠ ';

/** Marks the browser tab's title while the board's data is stale, so a
    background tab says so without being opened. Keyed on the boolean, so
    polls that keep it stale never stack a second mark. */
export function useStaleTabTitle(stale: boolean): void {
  useEffect(() => {
    if (!stale) return;
    const base = document.title;
    document.title = STALE_MARK + base;
    return () => {
      document.title = base;
    };
  }, [stale]);
}
