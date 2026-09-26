import { useCallback, useLayoutEffect } from 'react';
import {
  useComputedColorScheme,
  useMantineColorScheme,
  type MantineColorScheme,
} from '@mantine/core';

import { useLocalStorage } from './useStorage';

const COLOR_SCHEME_STORAGE_KEY = 'ui-color-scheme';

/**
 * Reads/writes the persisted color-scheme preference through the shadowed
 * `useLocalStorage` (getInitialValueInEffect: false), so the value is
 * available synchronously on first render -- no read-in-an-effect flicker.
 *
 * Default matches the `defaultColorScheme="auto"` passed to MantineProvider
 * in main.tsx, so a first-time visitor sees the same behavior whether or not
 * this hook has run yet.
 */
export function useStoredColorScheme() {
  return useLocalStorage<MantineColorScheme>({
    key: COLOR_SCHEME_STORAGE_KEY,
    defaultValue: 'auto',
  });
}

/**
 * The color-scheme preference plus everything derived from it, backed by our
 * own persisted value rather than Mantine's built-in
 * `localStorageColorSchemeManager`. Using the shadowed `useLocalStorage`
 * with `getInitialValueInEffect: false` ensures the scheme is read
 * synchronously on first render, avoiding a flash of the default.
 *
 * Returns:
 * - `isDarkMode` / `isLightMode` -- the RESOLVED scheme, so they answer
 *   correctly under the default `'auto'` preference (which follows the OS).
 * - `colorScheme` -- the raw stored preference (`'light' | 'dark' | 'auto'`).
 * - `computedColorScheme` -- the same value `'auto'` resolves to.
 * - `toggleColorScheme(manualValue?)` -- flips the preference, or sets it
 *   directly when passed `'dark'`/`'light'` or an is-dark boolean.
 * - `lightDark(light, dark)` -- picks one of two values for the resolved
 *   scheme (also available on its own as `useLightDark()`).
 * - `toggle` / `setColorScheme` -- aliases of the two `toggleColorScheme`
 *   forms, kept because they read better at most call sites.
 *
 * Mantine's own `setColorScheme` is called via `useLayoutEffect` (so it runs
 * before paint) to keep Mantine's internal state and the
 * `data-mantine-color-scheme` attribute in sync with our persisted value.
 *
 * That sync only runs when the two states actually differ. Mantine's
 * `setColorScheme` has a side effect beyond setting state: it injects a
 * `*, *::before, *::after { transition: none !important }` style tag for
 * ~10ms (its anti-flicker move for real scheme changes). Its identity also
 * changes every render, so an unconditional effect keyed on it re-fires on
 * EVERY re-render of every consumer -- globally suppressing all CSS
 * transitions in the same commit (this is what froze the app shell rail's
 * width tween on any page rendering a `useColorScheme` consumer). Real
 * scheme changes still go through the setter, keeping the anti-flicker
 * behavior where it belongs.
 */
export function useColorScheme() {
  const {
    colorScheme: mantineColorScheme,
    setColorScheme: setMantineColorScheme,
  } = useMantineColorScheme();
  const [storedColorScheme, setStoredColorScheme] = useStoredColorScheme();
  // The shadowed useLocalStorage's non-overloaded signature widens its return
  // type to `T | undefined` even when a defaultValue is supplied (a TS
  // quirk of collapsing Mantine's overloaded useLocalStorage into one
  // signature) -- defaultValue: 'auto' means this is never undefined at
  // runtime, so fall back only to satisfy the type.
  const colorScheme: MantineColorScheme = storedColorScheme ?? 'auto';

  useLayoutEffect(() => {
    if (mantineColorScheme !== colorScheme) {
      setMantineColorScheme(colorScheme);
    }
  }, [colorScheme, mantineColorScheme, setMantineColorScheme]);

  // `colorScheme` is the raw stored preference, which is `'auto'` under the
  // app's default -- not yet resolved to `light`/`dark`. `useComputedColorScheme`
  // resolves `'auto'` against the OS preference (via `@mantine/hooks`'
  // `useColorScheme`, which reads `matchMedia('(prefers-color-scheme: dark)')`).
  // `getInitialValueInEffect: false` mirrors the anti-flicker approach used for
  // the stored preference above: read the OS preference synchronously on first
  // render instead of defaulting then correcting in an effect.
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: false,
  });
  const isDarkMode = computedColorScheme === 'dark';
  const isLightMode = !isDarkMode;

  const toggleColorScheme = useCallback(
    (manualValue?: MantineColorScheme | boolean) => {
      if (typeof manualValue === 'boolean') {
        // Support an "isDarkMode" boolean.
        setStoredColorScheme(manualValue ? 'dark' : 'light');
        return;
      }
      if (typeof manualValue !== 'undefined') {
        setStoredColorScheme(manualValue);
        return;
      }
      // No argument: flip whatever is currently RENDERED, so toggling out of
      // `'auto'` lands on the opposite of what the user is looking at.
      setStoredColorScheme(isDarkMode ? 'light' : 'dark');
    },
    [isDarkMode, setStoredColorScheme]
  );

  const setColorScheme = useCallback(
    (value: MantineColorScheme) => {
      setStoredColorScheme(value);
    },
    [setStoredColorScheme]
  );

  const toggle = useCallback(() => {
    toggleColorScheme();
  }, [toggleColorScheme]);

  const lightDark = useCallback(
    <T = unknown>(lightValue: T, darkValue: T) =>
      isDarkMode ? darkValue : lightValue,
    [isDarkMode]
  );

  return {
    isDarkMode,
    isLightMode,
    colorScheme,
    computedColorScheme,
    toggleColorScheme,
    toggle,
    setColorScheme,
    lightDark,
  };
}

/**
 * Shortcut for the `lightDark` function: returns a picker that resolves one
 * of two values against the *actually-rendered* color scheme.
 *
 * ```tsx
 * const lightDark = useLightDark();
 * <Paper shadow={lightDark('sm', 'none')} />
 * ```
 *
 * Resolution goes through `computedColorScheme`, not the raw stored
 * preference: under the default `'auto'` the preference is literally
 * `'auto'`, which would always fall through to the light value: resolving
 * instead follows the OS preference (or whatever Mantine has actually
 * painted) the same way the rest of the UI does.
 */
export function useLightDark() {
  const { lightDark } = useColorScheme();
  return lightDark;
}
