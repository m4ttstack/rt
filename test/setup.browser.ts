// Registered as `setupFiles` in vitest.browser.config.ts. Imported once so
// every browser-tier test renders against the real generated theme.css
// instead of each test file importing it individually.
//
// This import is also the only thing that makes the kit's dark mechanism
// observable in a test: the theme carries both schemes through `light-dark()`
// and the `.dark` block does nothing but flip `color-scheme`, so a test that
// does not load this file sees every `var(--...)` resolve to nothing rather
// than to the wrong colour.
import "../src/generated/theme.css";

// React 19 gates `act()` behind this global, checked once per module load,
// not per call — a test file that sets it locally after React has already
// been imported (by `renderWithTheme` or anything else) is too late. Needed
// by any test that pairs `vi.useFakeTimers()` with a React state update made
// FROM INSIDE a fake-timer-fired callback (CopyButton.test.tsx's copied-flash
// cases are the first): that update reaches React's fiber synchronously, but
// its DOM commit is scheduled onto a real macrotask the fake clock cannot
// advance, so an assertion made right after `vi.advanceTimersByTimeAsync`
// resolves can read a state that has changed internally but not yet painted
// — `act()` forces the pending commit first. A plain user click doesn't need
// this (it crosses a real Playwright/CDP round trip, which is itself a
// macrotask boundary React's scheduler flushes against), which is why this
// was not needed before CopyButton.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
