import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listShippedCss } from "../scripts/copy-recipe-css.ts";
import { listRecipeDirs } from "../scripts/derive.ts";

const SRC = resolve(import.meta.dirname, "..", "src");

/** Absolute targets of every relative `.css` import in a recipe's TSX,
    default-import and side-effect forms alike. */
function cssImportsOf(tsxPath: string): string[] {
  const source = readFileSync(tsxPath, "utf8");
  const re = /import\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']*\.css)["']/g;
  return [...source.matchAll(re)].map((m) => resolve(dirname(tsxPath), m[1] as string));
}

/** `.ts` / `.tsx` files in a recipe directory, tests excluded, so a helper
    module (e.g. `Tooltip/TooltipCard.tsx`) is covered alongside `<Name>.tsx`. */
function recipeModulesOf(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    .map((entry) => join(dir, entry));
}

describe("listShippedCss", () => {
  const root = mkdtempSync(join(tmpdir(), "tui-kit-copy-css-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("lists every .module.css and .keyframes.css under the root, and nothing else", () => {
    const tree = [
      "recipes/A/A.module.css",
      "recipes/A/A.keyframes.css",
      "recipes/A/A.tsx",
      "recipes/A/A.test.tsx",
      "recipes/A/__screenshots__/A.visual.test.tsx/stray.module.css",
      "canvas.css",
      "generated/theme.css",
    ];
    for (const rel of tree) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), "");
    }

    expect(listShippedCss(root).map((f) => relative(root, f)).sort()).toEqual([
      "recipes/A/A.keyframes.css",
      "recipes/A/A.module.css",
    ]);
  });
});

describe("copy-recipe-css ships every stylesheet a recipe imports", () => {
  it("covers each relative .css import in every module of every recipe directory", () => {
    const shipped = new Set(listShippedCss(SRC).map((f) => relative(SRC, f)));
    const missing: string[] = [];
    for (const name of listRecipeDirs()) {
      for (const modulePath of recipeModulesOf(join(SRC, "recipes", name))) {
        for (const css of cssImportsOf(modulePath)) {
          const rel = relative(SRC, css);
          if (!shipped.has(rel)) missing.push(rel);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
