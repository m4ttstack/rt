import { registerTheme, SoribashiProvider } from "@soribashi/core";
import type { ReactNode } from "react";
import { render } from "vitest-browser-react";
import { tuiTheme } from "../src/theme.ts";

// Module top, once per test file that imports this helper — see the block
// comment on renderWithTheme for why this is load-bearing rather than
// decoration.
registerTheme(tuiTheme);

/**
 * The one render entry point for every browser/visual test in this kit.
 *
 * Two pieces of wiring, both MANDATORY and both silent when missing — which is
 * exactly why they live here once instead of being repeated per test file:
 *
 *   `registerTheme(tuiTheme)` — src/builders.ts imports the theme TYPE only and
 *   deliberately never calls registerTheme (a value import would close an
 *   import cycle the moment the theme grows a per-component `.extend()`
 *   entry). The registration therefore has to happen at an entry point.
 *   soribashi's factory reads the registered theme for dev-time vocabulary
 *   validation; without it, an out-of-vocabulary `intent="nope"` sails through
 *   a test that should have complained.
 *
 *   `<SoribashiProvider theme={tuiTheme}>` — `useTheme()` falls back to an
 *   EMPTY default theme when no provider is above it, and that fallback's
 *   default intent resolver bypasses `tuiIntentResolver` entirely. Nothing
 *   throws: the recipe renders, `--probe-color` and friends resolve against
 *   soribashi's default ramp names instead of the kit's single-shade families,
 *   and the test passes against the wrong colours. Mirrors soribashi's own
 *   apps/workshop/src/main.tsx provider wiring.
 *
 * `render` is vitest-browser-react's, which returns a Promise — callers await
 * it (`const screen = await renderWithTheme(<X />)`).
 *
 * `options` is passed straight through so a visual test can mount into a
 * container it prepared itself (e.g. one already carrying the `dark` class, so
 * the very first paint is dark rather than a light frame followed by a flip).
 */
export function renderWithTheme(
  ui: ReactNode,
  options?: Parameters<typeof render>[1],
): ReturnType<typeof render> {
  return render(<SoribashiProvider theme={tuiTheme}>{ui}</SoribashiProvider>, options);
}
