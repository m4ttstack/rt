import { useEffect, useState } from "react";

/**
 * Minimal hash router. Two routes: the leaderboard (no hash) and a person's detail page
 * (`#/u/<username>?stat=<metricKey>`). Hash-based so deep links and browser back/forward work
 * with zero server changes (no SPA fallback needed). The `stat` is only the initial focus;
 * switching tabs on the detail page is local state, so "back" returns straight to the board.
 */
export interface Route {
  user: string | null;
  stat: string | null;
  page: string | null;
}

function parseHash(): Route {
  if (window.location.hash === "#settings") {
    return { user: null, stat: null, page: "settings" };
  }
  const m = window.location.hash.match(/^#\/u\/([^/?]+)(?:\?stat=([^&]+))?/);
  if (!m) return { user: null, stat: null, page: null };
  return { user: decodeURIComponent(m[1]!), stat: m[2] ? decodeURIComponent(m[2]) : null, page: null };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Navigate to a person's detail page, opening on the given stat. Pushes a history entry. */
export function navigateToUser(user: string, stat: string): void {
  window.location.hash = `#/u/${encodeURIComponent(user)}?stat=${encodeURIComponent(stat)}`;
}

/** Return to the leaderboard. */
export function navigateHome(): void {
  window.location.hash = "";
}
