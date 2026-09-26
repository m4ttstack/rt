import { useLocationProperty } from 'wouter/use-browser-location';

/** The URL fragment, live: wouter's store already listens to pushState,
    replaceState, popstate and hashchange. */
export function useHash(): string {
  return useLocationProperty(() => window.location.hash);
}
