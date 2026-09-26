import { defineConfig } from "vitest/config";

/**
 * Root aggregator. Vitest 4 removed the standalone `vitest.workspace.ts` file
 * (the `test.workspace` option went with it); `test.projects` on a root config
 * is the documented replacement — see soribashi's own root vitest.config.ts,
 * which this mirrors, and https://vitest.dev/guide/projects.
 *
 * Two tiers, both run by `bun run test`:
 *
 *   node    — pure logic: the theme/census suite and the two mechanical CSS
 *             gates, plus any `*.test.ts` colocated with a recipe. No DOM, no
 *             browser, fast.
 *   browser — every recipe's `*.test.tsx` and `*.visual.test.tsx`, rendered in
 *             a real headless Chromium through playwright. This is the tier
 *             that can actually observe `light-dark()` resolving, computed
 *             styles, and screenshots; jsdom cannot.
 *
 * Kept as two sibling config FILES rather than inline project objects because
 * the browser tier needs its own Vite plugin set (`@vitejs/plugin-react`) and
 * its own `root`, and because it stays runnable on its own via
 * `vitest --config vitest.browser.config.ts` when debugging a launch problem.
 */
export default defineConfig({
  test: {
    projects: ["./vitest.node.config.ts", "./vitest.browser.config.ts"],
  },
});
