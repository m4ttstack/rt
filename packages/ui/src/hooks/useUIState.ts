import { useDeferredValue, useState } from 'react';

import { useLocalStorage } from './useStorage';

/**
 * A state value for the UI plus a deferred value for expensive
 * operations/renders that can lag a render behind without hurting UX.
 *
 * @returns [uiState, setUIState, deferredValue]
 */
export function useUIState<T>(defaultValue: T) {
  const [uiState, setUIState] = useState<T>(defaultValue);
  const deferredValue = useDeferredValue(uiState);

  return [uiState, setUIState, deferredValue] as const;
}

export type UIState<T> = ReturnType<typeof useUIState<T>>;

/**
 * Same shape as `useUIState`, but persisted. Routes through the shadowed
 * `useLocalStorage` (from `./useStorage`, `getInitialValueInEffect: false`)
 * rather than `@mantine/hooks` directly, so the persisted value is available
 * synchronously on first render.
 *
 * @returns [uiState, setUIState, deferredValue]
 */
export function useStoredUIState<T>(defaultValue: T, key: string) {
  const [uiState, setUIState] = useLocalStorage<T>({ key, defaultValue });
  const deferredValue = useDeferredValue(uiState);

  return [uiState, setUIState, deferredValue] as const;
}
