import '@testing-library/jest-dom/vitest';

import { installJsdomPolyfills } from '@mattstack/app-kit/test-utils';

installJsdomPolyfills();

// jsdom ships `window.scrollTo` only as a "not implemented" stub that logs a
// noisy jsdomError. The app's router scrolls to the top on every route
// change (src/app/App.tsx), so any test that navigates would trigger it --
// replace it with a real no-op.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}

// Same story for `Element.prototype.scrollIntoView` -- jsdom has no layout
// engine to scroll, and Spotlight calls it on every selection change.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
