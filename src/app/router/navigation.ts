import { useSyncExternalStore } from 'react';

// The whole "router state" is the browser's own location; this module only
// adds a change-notification layer on top of the history API. pushState /
// replaceState don't fire any DOM event, so navigate() notifies subscribers
// itself; popstate (back/forward) is forwarded into the same listener set.
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}

function getPathname(): string {
  return window.location.pathname;
}

/**
 * SPA navigation: pushState (or replaceState) to `to`, then notify every
 * `usePath` subscriber so the route re-renders. No-ops the history write on
 * the current URL so re-clicking the active link doesn't stack duplicate
 * history entries.
 */
export function navigate(to: string, options?: { replace?: boolean }) {
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (to !== current) {
    window.history[options?.replace ? 'replaceState' : 'pushState'](
      null,
      '',
      to
    );
  }
  notify();
}

function getSearch(): string {
  return window.location.search;
}

/** The current pathname, re-rendering on navigate() and popstate. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, getPathname);
}

/**
 * The current query string, re-rendering on the same notifications `usePath`
 * does. Which route renders is the pathname's business; this carries the
 * state a link has to hand across a route boundary, which React state cannot
 * do when the link is mounted outside the route it targets.
 */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, getSearch);
}
