import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Browser tier. Ported from soribashi's packages/ui/vitest.browser.config.ts
 * and vitest.visual.config.ts, MERGED into one project: soribashi splits them
 * because its visual baselines are run by a separate `test:visual` script that
 * is deliberately outside the default `projects` list, whereas this kit's
 * brief puts both behaviours behind one `bun run test`. The merge is just the
 * union of the two files — the include glob covers `*.visual.test.tsx` (which
 * `*.test.tsx` already matches, hence no `exclude` here), and the screenshot
 * comparator block comes across verbatim.
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
    // `src/**`, NOT `src/recipes/**`. Together with the node tier's
    // `src/**/*.test.ts`, the two projects must partition every test file
    // under src/ between them, because a file matched by NO project is not an
    // error in vitest — it is simply never run, and the summary reports
    // nothing missing. Scoped to `src/recipes/**` this tier had a hole: a
    // `*.test.tsx` written under src/hooks/ (Task 7's territory) or anywhere
    // else in src/ would have silently disappeared. `test/**` is listed for the
    // same reason and not because a browser test is expected to live there.
    //
    // The partition, stated once: this tier takes every `*.test.tsx` under
    // src/ and test/, the node tier takes every `*.test.ts` under the same two
    // roots. `*.visual.test.tsx` is already matched by `*.test.tsx` and is
    // named separately only for readability.
    include: [
      "src/**/*.test.tsx",
      "src/**/*.visual.test.tsx",
      "test/**/*.test.tsx",
      "test/**/*.visual.test.tsx",
    ],
    // Loads the generated theme.css once, so every browser test renders
    // against the real emitted custom properties instead of each test file
    // importing the stylesheet itself. This is what makes a computed-style
    // assertion meaningful: without it, every `var(--...)` in a recipe's CSS
    // module resolves to nothing.
    setupFiles: ["./test/setup.browser.ts"],
    browser: {
      enabled: true,
      headless: true,
      // `reducedMotion` is an ENVIRONMENT input that recipe CSS can legally
      // read: Chip.module.css turns its pulse off under
      // `@media (prefers-reduced-motion: reduce)`, which is correct behaviour
      // and deliberately not something a test should have to work around. Left
      // unset, playwright inherits whatever the launching machine prefers, so a
      // developer with "reduce motion" on in macOS would watch six of Chip's
      // cases go red for a reason that has nothing to do with the recipe — and
      // the visual baselines would capture a different frame besides. Pinned to
      // `no-preference` so this tier is deterministic across machines; the
      // reduced-motion branch is a stylesheet decision, verified by reading the
      // CSS, not by inheriting the developer's OS settings.
      // Chip.test.tsx's "runs under no-preference reduced motion" case is this
      // option's canary, and fails first if it is ever dropped.
      //
      // IT BELONGS ON THE PROVIDER, not on an `instances` entry:
      // `contextOptions` (playwright's own `browser.newContext` options) is a
      // member of `PlaywrightProviderOptions`, and `BrowserInstanceOption`
      // rejects both `context` and `contextOptions`. This repo's tsconfig
      // includes the vitest configs, which is how that was caught rather than
      // silently ignored.
      provider: playwright({ contextOptions: { reducedMotion: "no-preference" } }),
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
