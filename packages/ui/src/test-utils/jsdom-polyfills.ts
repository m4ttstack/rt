// jsdom implements neither `window.matchMedia` nor `ResizeObserver`, and
// this package needs both: Mantine's color-scheme hooks call `matchMedia`
// unconditionally (to detect the OS preference for "auto"), and
// `@mantine/core`'s `ScrollArea` -- used directly by `AcceptableList` and
// `RangePicker`, transitively by `VirtualList` and `SearchableMenu` --
// observes its viewport on mount.
//
// These live inside `packages/ui/src` rather than in the repo-root vitest
// setup so the package stays self-contained: a consuming app gets the
// polyfills its tests require via `@mattstack/app-kit/test-utils`, and
// calls `installJsdomPolyfills()` from whatever setup file it already has.
import { afterEach } from 'vitest';

type ColorSchemePreference = 'light' | 'dark';

let prefersColorScheme: ColorSchemePreference = 'light';

/**
 * Simulates an OS-level `prefers-color-scheme` for one test (see
 * `useColorScheme.test.tsx`'s auto-scheme regression test). Call before
 * rendering; `installJsdomPolyfills` resets it after every test so a
 * simulated preference never leaks.
 */
export function setPrefersColorScheme(scheme: ColorSchemePreference) {
  prefersColorScheme = scheme;
}

export function installJsdomPolyfills() {
  if (typeof window === 'undefined') return;

  if (!window.matchMedia) {
    window.matchMedia = (query: string) => {
      const isDarkQuery = query.includes('prefers-color-scheme: dark');
      const isLightQuery = query.includes('prefers-color-scheme: light');
      // Any query this polyfill doesn't recognize (i.e. not a
      // prefers-color-scheme check) reports `matches: false` -- previously an
      // unrecognized query fell through to the "not dark" branch and reported
      // `matches: true` whenever the simulated scheme was 'light', which is
      // wrong for e.g. an unrelated width/orientation media query.
      const matches = isDarkQuery
        ? prefersColorScheme === 'dark'
        : isLightQuery
          ? prefersColorScheme === 'light'
          : false;
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    };
  }

  if (!window.ResizeObserver) {
    class ResizeObserverPolyfill {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverPolyfill;
  }

  afterEach(() => {
    prefersColorScheme = 'light';
  });
}
