#!/usr/bin/env bun
/**
 * Copies every recipe stylesheet under `src/` into the matching path under
 * `dist/src/`: the `*.module.css` each recipe default-imports, and the
 * `*.keyframes.css` siblings that carry `@keyframes` and their `animation`
 * declarations (docs/decisions.md). `tsc` emits JS and `.d.ts` for `.ts` /
 * `.tsx` inputs only; left uncopied, the compiled `dist/recipes/X/X.js`
 * would import a stylesheet that does not exist in the published package
 * and break at the consumer's bundler. `src/canvas.css` and
 * `src/generated/theme.css` are deliberately NOT matched: package.json ships
 * them at their `src/` paths.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dirname, "..", "src");
const DIST_ROOT = resolve(import.meta.dirname, "..", "dist", "src");

const SHIPPED_CSS_SUFFIXES = [".module.css", ".keyframes.css"] as const;

/** Absolute paths of every stylesheet the build must copy, `__screenshots__` skipped. */
export function listShippedCss(root: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__screenshots__") continue;
      out.push(...listShippedCss(full));
    } else if (SHIPPED_CSS_SUFFIXES.some((suffix) => full.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  let copied = 0;
  for (const file of listShippedCss()) {
    const relative = file.slice(SRC_ROOT.length + 1);
    const dest = join(DIST_ROOT, relative);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    copied += 1;
  }
  console.log(`[tui-kit] copy-recipe-css: copied ${copied} recipe stylesheet(s) into dist`);
}

if (import.meta.main) main();
