import { useCallback, useState } from 'react';

import { useIsMobile } from '@mattstack/app-kit/hooks';

export interface UseRailStateOptions {
  /** Start with the desktop rail expanded. @default false */
  defaultExpanded?: boolean;
}

export interface RailState {
  /** Mobile-open state (the header toggle / overlay dismissal pair). */
  opened: boolean;
  /** The desktop expand-toggle state, untouched by mobile opens. */
  expanded: boolean;
  /** What the rail should actually render: pass this to `RailShell`'s
   * `railExpanded` and to `Rail`/`RailEntry`'s `expanded`. */
  effectiveExpanded: boolean;
  toggleOpened: () => void;
  close: () => void;
  toggleExpanded: () => void;
}

/**
 * State wiring for `RailShell` + `Rail`: mobile open/close plus the desktop
 * expand toggle, with the expand-then-open rule inside -- on mobile the
 * rail opens already expanded (a slim icon strip floating over a dimmed
 * page is a trap, a labeled nav is the point), while the desktop expand
 * state is untouched.
 *
 * Neither state persists: `opened` is ephemeral by nature, and `expanded`
 * deliberately resets per visit.
 */
export function useRailState({
  defaultExpanded = false,
}: UseRailStateOptions = {}): RailState {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [opened, setOpened] = useState(false);
  const effectiveExpanded = expanded || (isMobile && opened);

  const toggleOpened = useCallback(() => setOpened(value => !value), []);
  const close = useCallback(() => setOpened(false), []);
  const toggleExpanded = useCallback(() => setExpanded(value => !value), []);

  return {
    opened,
    expanded,
    effectiveExpanded,
    toggleOpened,
    close,
    toggleExpanded,
  };
}
