import { createContext, useContext } from 'react';

/**
 * What the rail chrome publishes to whatever it hosts. Only the header
 * height so far, because that is the one number a hosted `PageShell` has to
 * agree with: the rail's header is `position: fixed`, so the page below it
 * needs a matching `topOffset` to clear it.
 *
 * Before this existed the two were kept in sync by hand (a shared constant
 * passed to both), and nothing caught a drift -- the layout just read subtly
 * wrong. A hosted `PageShell` now defaults its `topOffset` to this, and an
 * explicit `topOffset` still wins.
 */
export interface RailShellContextValue {
  headerHeight: number;
}

export const RailShellContext = /* @__PURE__ */ createContext<
  RailShellContextValue | undefined
>(undefined);

/**
 * The hosting rail chrome's header height, or `undefined` outside a
 * `RailShell`. Undefined is the normal standalone case, not an error.
 */
export function useRailShellHeaderHeight(): number | undefined {
  return useContext(RailShellContext)?.headerHeight;
}
