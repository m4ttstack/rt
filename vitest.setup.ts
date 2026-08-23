import '@testing-library/jest-dom/vitest';

// The matchMedia and ResizeObserver polyfills `src/ui` needs travel with it,
// so vendoring apps get them by copying the kit rather than by reproducing
// this file. See src/ui/storybook/jsdom-polyfills.ts.
import { installJsdomPolyfills } from '@ui/storybook/jsdom-polyfills';

installJsdomPolyfills();

// jsdom ships `window.scrollTo` only as a "not implemented" stub that logs a
// noisy jsdomError. The app's router scrolls to the top on every route
// change (src/app/App.tsx), so any test that navigates would trigger it --
// replace it with a real no-op. App-level, so it stays here rather than
// travelling with `src/ui`.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
