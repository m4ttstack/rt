import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Browser tier. Ported from soribashi's packages/ui/vitest.browser.config.ts
 * and vitest.visual.config.ts, MERGED into one project: soribashi splits them
 * because its visual baselines are run by a separate `test:visual` script that
 * is deliberately outside the default `projects` list, whereas this kit's
 * brief puts both behaviours behind one `bun run test`. The merge is just the
 * union of the two files — the include glob widens to cover
 * `*.visual.test.tsx` (which `*.test.tsx` already matches, hence no `exclude`
 * here), and the screenshot comparator block comes across verbatim.
 *
 * `root` is anchored to this config file's own directory rather than left to
 * Vite's default (the process cwd) so `include` resolves against the repo
 * regardless of where the run was invoked from — soribashi's rationale, kept.
 */
export default defineConfig({
  plugins: [react()],
  root: import.meta.dirname,
  test: {
    name: "browser",
    include: ["src/recipes/**/*.test.tsx", "src/recipes/**/*.visual.test.tsx"],
    // Loads the generated theme.css once, so every browser test renders
    // against the real emitted custom properties instead of each test file
    // importing the stylesheet itself. This is what makes a computed-style
    // assertion meaningful: without it, every `var(--...)` in a recipe's CSS
    // module resolves to nothing.
    setupFiles: ["./test/setup.browser.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      // NOTE THE NESTING: `expect.toMatchScreenshot` belongs to
      // BrowserConfigOptions, i.e. `test.browser.expect`, NOT `test.expect`
      // (whose only members in vitest 4.1 are `requireAssertions` and `poll`).
      // soribashi's vitest.visual.config.ts has it one level out, under
      // `test.expect`, where it is silently dropped — a mistake nothing there
      // catches because its tsconfig `include` covers no vitest config file, so
      // the excess-property error never gets raised. This kit's tsconfig DOES
      // include the vitest configs, which is how the nesting was found.
      expect: {
        toMatchScreenshot: {
          comparatorName: "pixelmatch",
          comparatorOptions: {
            // Vitest 4.1's visual-regression docs set no default for either
            // value ("that's up for the user to decide"); these are the two
            // numbers its own example config pairs. `threshold` (0-1,
            // per-pixel Lab distance) absorbs anti-aliasing / subpixel font
            // noise; `allowedMismatchedPixelRatio` is preferred over a fixed
            // pixel count because it scales with each fixture's screenshot
            // size.
            threshold: 0.2,
            allowedMismatchedPixelRatio: 0.01,
          },
        },
      },
    },
  },
});
