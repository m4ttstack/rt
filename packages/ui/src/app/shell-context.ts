import { createContext, useContext } from 'react';

export interface ShellRailState {
  expanded: boolean;
  close: () => void;
}

export const ShellRailContext = /* @__PURE__ */ createContext<ShellRailState>({
  expanded: false,
  close: () => {},
});

export function useShellRail(): ShellRailState {
  return useContext(ShellRailContext);
}
