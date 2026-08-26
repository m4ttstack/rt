import { useState } from 'react';

import { useLocalStorage } from '@ui/hooks';

type SideDrawerState = readonly [boolean, (value: boolean) => void];

/**
 * The sidebar's open/closed state: plain component state by default,
 * upgraded to a localStorage-persisted value when `drawerStateKey` is
 * provided (via the kit's anti-flicker `useLocalStorage` shadow, so the
 * persisted value is read synchronously on first render).
 *
 * Both hooks always run to keep hook order stable; the unused one is
 * simply ignored. The fallback key is never written to -- its setter is
 * only ever returned when a real `drawerStateKey` exists.
 */
export function useSideDrawerState({
  drawerStateKey,
  initialValue,
}: {
  drawerStateKey?: string;
  initialValue: boolean;
}): SideDrawerState {
  const plain = useState(initialValue);
  const [storedValue = initialValue, setStoredValue] = useLocalStorage<boolean>(
    {
      key: drawerStateKey ?? 'page-shell-sidebar-unkeyed',
      defaultValue: initialValue,
    }
  );

  return drawerStateKey ? [storedValue, setStoredValue] : plain;
}
