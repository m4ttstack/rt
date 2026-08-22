#!/usr/bin/env bun
/**
 * Copies every `*.module.css` under `src/recipes/**` into the matching path
 * under `dist/recipes/**`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Each recipe imports its CSS module by relative specifier, e.g.
 * `import classes from "./Button.module.css"` in src/recipes/Button/Button.tsx.
 * `tsc` only emits JS/`.d.ts` for `.ts`/`.tsx` inputs — it does not copy the
 * `.module.css` siblings those imports point at. Left uncopied, the compiled
 * `dist/recipes/Button/Button.js` would carry an import to a file that does
 * not exist in the published package, breaking at the consumer's bundler.
 *
 * Unlike @soribashi/core (framework-only, no components), tui-kit ships real
 * components with real CSS Modules, so this step has no equivalent in the
 * reference package's build.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dirname, "..", "src");
const DIST_ROOT = resolve(import.meta.dirname, "..", "dist", "src");

function* walkModuleCss(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__screenshots__") continue;
      yield* walkModuleCss(full);
    } else if (full.endsWith(".module.css")) {
      yield full;
    }
  }
}

function main(): void {
  let copied = 0;
  for (const file of walkModuleCss(SRC_ROOT)) {
    const relative = file.slice(SRC_ROOT.length + 1);
    const dest = join(DIST_ROOT, relative);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    copied += 1;
  }
  console.log(`[tui-kit] copy-recipe-css: copied ${copied} CSS module file(s) into dist`);
}

main();
