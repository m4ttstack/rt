# Keyframes Outside CSS Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every kit recipe animate under `Bun.build` by moving each `@keyframes` block and its `animation` / `animation-name` declarations out of `*.module.css` into a plain `<Recipe>.keyframes.css` sibling, shipped, gated, and documented.

**Architecture:** Bun through 1.3.14 hashes a CSS module's `@keyframes` ident but emits `animation` references verbatim (oven-sh/bun#18921), so a module-scoped keyframe paints frame zero and never moves. Vite has the opposite failure mode: it hashes an `animation` ident in a module even when no local `@keyframes` exists. The only layout both bundlers get right is BOTH halves in a non-module stylesheet, selected by the recipe's public `data-part`, side-effect-imported from the recipe TSX, still inside `@layer soribashi.recipes`. Five recipes are affected: Spinner, Chip, Drawer, ContextMenu, ToastHost. Three gates lock the layout in: a node-tier `bun build` test that reads the emitted CSS, a browser-tier assertion that the computed `animationName` matches a real `CSSKeyframesRule`, and a scanner rule that rejects motion declarations inside any `.module.css`.

**Tech Stack:** TypeScript 7, React 19, @soribashi/core builders, CSS Modules, vitest 4 (node tier + playwright browser tier), Bun 1.3.13 (local), tsc build with `scripts/copy-recipe-css.ts`.

**Spec:** https://github.com/m4ttstack/tui-kit/issues/1 (no local spec file; the issue is the spec. Its "Done when" list is reproduced under Global Constraints.)

## Global Constraints

- Keyframe idents stay exactly: `sb-spinner-spin`, `chip-pulse`, `drawer-slide-in`, `contextmenu-in`, `toasthost-in`. Never rename. They are global now, and their uniqueness is the collision avoidance.
- Do not bump Bun and do not document "use a newer Bun". The kit must animate on Buns that still carry the bug.
- Do not change animation timing, easing, or reduced-motion behaviour. Every duration, timing function, iteration count and `prefers-reduced-motion` override moves verbatim.
- Do not leave `animation` / `animation-name` in a `.module.css` with the `@keyframes` elsewhere (Vite hashes the reference and the workshop freezes). Both halves move together.
- `:global()` is not an option: `@keyframes :global(name)` is a hard parse error in Bun.
- Every new stylesheet opens with `@layer soribashi.recipes {` as its first non-comment statement and passes `test/no-hardcoded-values.test.ts` unchanged (token-backed values; keyframe-selector percentages allowed).
- New stylesheets must land in `dist/` via `scripts/copy-recipe-css.ts`; do not add a second copy script.
- Comments: only constraints the code cannot show. No narration, no task numbers, no review history. No em dashes or en dashes anywhere (use `...`, parens, or rephrase).
- Commit after every task, on a branch off `main` named `fix-keyframes-outside-css-modules`. Commit messages are short and imperative, in the style of `git log` (`fix: ...`, `test: ...`, `chore: ...`).
- Never open a browser for verification. The workshop check at the end is reported back for the human to run.
- Done when (verbatim from the issue):
  - `Bun.build` of a consumer that imports these recipes emits an `animation` / `animation-name` whose ident matches a `@keyframes` rule in the same bundle
  - Vite workshop still animates all five recipes
  - the new keyframes-resolution tests fail if the names diverge again
  - `copy-recipe-css` (or successor) ships whatever new CSS files the recipes import
  - `docs/decisions.md` notes why keyframes are not in the CSS module

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `test/fixtures/bun-build-entry.ts` | One-line barrel re-export that `bun build` bundles in the packaging gate |
| `test/bun-build-keyframes.test.ts` | Node-tier gate: bundles the barrel with `bun build`, parses emitted CSS, asserts every `animation` ident has a matching `@keyframes` and the five global names are present |
| `test/keyframes.ts` | Browser-tier helper: walks `document.styleSheets` (into `@layer` / `@media`) for a `CSSKeyframesRule` matching an element's computed `animationName` |
| `test/copy-recipe-css.test.ts` | Node-tier test for the copy script's file listing, plus the invariant that every `.css` a recipe TSX imports is shipped |
| `src/recipes/Spinner/Spinner.keyframes.css` | `[data-part="spinner"]` animation + `@keyframes sb-spinner-spin` |
| `src/recipes/Chip/Chip.keyframes.css` | `[data-part="chip"][data-pulse]` longhands, reduced-motion override, `@keyframes chip-pulse` |
| `src/recipes/Drawer/Drawer.keyframes.css` | `[data-part="drawer-content"]` animation, reduced-motion override, `@keyframes drawer-slide-in` |
| `src/recipes/ContextMenu/ContextMenu.keyframes.css` | `[data-part="contextmenu"]` animation + `@keyframes contextmenu-in` |
| `src/recipes/ToastHost/ToastHost.keyframes.css` | `[data-part="toasthost-toast"]` animation + `@keyframes toasthost-in` |

**Modified**

| Path | Change |
|---|---|
| `scripts/copy-recipe-css.ts` | Ship `.keyframes.css` alongside `.module.css`; export the listing; guard `main()` with `import.meta.main` |
| `scripts/derive.ts` | Include `<Name>.keyframes.css` in `files` and in the `tokenDependencies` scrape |
| `test/no-hardcoded-values.test.ts` | Sweep `*.keyframes.css` with the same rules; reject `@keyframes` / `animation` inside any `.module.css` |
| `test/token-existence.test.ts` | Assert the keyframes file and its tokens reach the manifest |
| `src/recipes/{Spinner,Chip,Drawer,ContextMenu,ToastHost}/*.module.css` | Motion removed |
| `src/recipes/{Spinner,Chip,Drawer,ContextMenu,ToastHost}/*.tsx` | `import "./<Name>.keyframes.css";` |
| `src/recipes/{Spinner,Chip,Drawer,ContextMenu,ToastHost}/*.test.tsx` | Keyframes-resolution assertion; comments that named the module as the animation's home corrected |
| `src/recipes/{Spinner,Chip,ContextMenu,ToastHost}/*.visual.test.tsx` | Header comments that name `<Name>.module.css` as the animation's home corrected |
| `package.json` | `gates` script runs the two new node-tier tests |
| `docs/decisions.md` | New decision record |

**Reference facts every task relies on**

- `bun --version` locally is `1.3.13`, which has the bug. `bun build test/fixtures/bun-build-entry.ts --outdir <tmp> --target browser` today emits `@keyframes sb-spinner-spin_UXKcrg` next to `animation: sb-spinner-spin .8s linear infinite` (and the same shape for the other four).
- Vite (the workshop AND the vitest browser tier) rewrites `animation: sb-spinner-spin` inside a module to `_sb-spinner-spin_<hash>` whether or not the module declares that keyframe. Verified against the installed vite 8.2.2.
- `data-part` values: Spinner root `spinner`; Chip root `chip` (pulse stamps a bare `data-pulse` attribute); Drawer content `drawer-content`; ContextMenu root `contextmenu`; ToastHost toast `toasthost-toast`.
- Recipe-local custom properties the keyframes read are set inline on the same element by the recipe TSX: `--sb-chip-pulse-period` (Chip root, `1.4s`), `--sb-drawer-slide-x` (Drawer content). `--spacing-px12` (ToastHost) is a theme token.
- Test runners: node tier `bunx vitest run --project node <file>`, browser tier `bunx vitest run --project browser <file>`, everything `bun run test`, typecheck `bun run typecheck`, gates `bun run gates`.
- `types/css-modules.d.ts` already declares `declare module "*.css";`, so a side-effect `.css` import type-checks with no further work. `tsc` with `verbatimModuleSyntax` preserves side-effect imports in `dist/`, and `rewriteRelativeImportExtensions` leaves `.css` specifiers untouched.
- Visual tests freeze motion with an unlayered `animation: none !important`, which keeps beating the layered recipe rule after the move. Leave those freezes alone.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the working branch**

```bash
cd /Users/matt/Documents/GitHub/tui-kit
git checkout -b fix-keyframes-outside-css-modules main
```

Expected: `Switched to a new branch 'fix-keyframes-outside-css-modules'`. Working tree clean.

---

### Task 1: Bun bundle gate (red until the last recipe moves)

This gate is the issue's first "done when" bullet, encoded as a test. It is expected to FAIL from this task until Task 7 finishes; each recipe task turns one of its rows green. Commit it red, with a message that says so.

**Files:**
- Create: `test/fixtures/bun-build-entry.ts`
- Create: `test/bun-build-keyframes.test.ts`

**Interfaces:**
- Produces: `KIT_KEYFRAMES` (the five global idents); later tasks do not import it, they make its rows pass.

- [ ] **Step 1: Write the fixture entry**

```ts
// test/fixtures/bun-build-entry.ts
export * from "../../src/index.ts";
```

- [ ] **Step 2: Write the gate**

```ts
// test/bun-build-keyframes.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Packaging gate for oven-sh/bun#18921: Bun through 1.3.14 hashes a CSS
 * module's `@keyframes` ident but emits `animation` / `animation-name`
 * verbatim, so a keyframe declared inside `*.module.css` paints frame zero
 * and never moves in a consumer built with `Bun.build`. The kit keeps
 * keyframes AND their `animation` declarations in a plain
 * `<Recipe>.keyframes.css` sibling (docs/decisions.md). This test bundles
 * the barrel with the local `bun` and reads the CSS it emits, the only place
 * the mismatch is observable: computed styles report the specified ident
 * either way, and the Vite tiers rewrite both sides so they never see it.
 */

const ENTRY = join(import.meta.dirname, "fixtures", "bun-build-entry.ts");

/** Every keyframe ident the kit ships, under the global name it must keep. */
const KIT_KEYFRAMES = [
  "chip-pulse",
  "contextmenu-in",
  "drawer-slide-in",
  "sb-spinner-spin",
  "toasthost-in",
] as const;

/** `animation` shorthand words that are never a custom ident. */
const ANIMATION_KEYWORDS = new Set([
  "none",
  "infinite",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step-start",
  "step-end",
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

function bundleWithBun(): string {
  const outdir = mkdtempSync(join(tmpdir(), "tui-kit-bun-build-"));
  try {
    execFileSync("bun", ["build", ENTRY, "--outdir", outdir, "--target", "browser"], {
      stdio: "pipe",
    });
    return readdirSync(outdir)
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(outdir, file), "utf8"))
      .join("\n");
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

function keyframesNames(css: string): Set<string> {
  return new Set([...css.matchAll(/@keyframes\s+([^\s{]+)/g)].map((m) => m[1] as string));
}

/** Custom idents named by every `animation` / `animation-name` declaration. */
function referencedAnimationNames(css: string): string[] {
  const names: string[] = [];
  for (const m of css.matchAll(/(?<![\w-])animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    const value = (m[1] as string).replace(/[\w-]+\([^)]*\)/g, " ");
    for (const token of value.split(/[\s,]+/)) {
      if (!token || ANIMATION_KEYWORDS.has(token)) continue;
      if (/^[\d.]+(?:m?s)?$/.test(token)) continue;
      names.push(token);
    }
  }
  return names;
}

describe("Bun.build: every animation ident resolves inside the emitted bundle", () => {
  let css = "";
  beforeAll(() => {
    css = bundleWithBun();
  });

  it("the bundle carries CSS with keyframes at all", () => {
    expect(css.length).toBeGreaterThan(0);
    expect(keyframesNames(css).size).toBeGreaterThanOrEqual(KIT_KEYFRAMES.length);
  });

  it.each(KIT_KEYFRAMES)("emits @keyframes %s under its global, unhashed name", (name) => {
    expect([...keyframesNames(css)]).toContain(name);
  });

  it("every animation / animation-name ident names a @keyframes rule in the same bundle", () => {
    const declared = keyframesNames(css);
    const referenced = referencedAnimationNames(css);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and confirm the failure shape**

Run: `bunx vitest run --project node test/bun-build-keyframes.test.ts`

Expected: 7 tests. The "carries CSS" row passes. All five `emits @keyframes ...` rows FAIL (the emitted names are `sb-spinner-spin_UXKcrg`, `chip-pulse_M3mBmg`, `drawer-slide-in_-79vAw`, `contextmenu-in_53XRdw`, `toasthost-in_L9sWBA`; hashes may differ). The "every ... ident names a @keyframes rule" row FAILS listing all five bare idents as unresolved.

If instead the run errors with `spawn bun ENOENT`, bun is not on the PATH of the shell running vitest; fix the environment, do not change the test.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 5: Commit (red on purpose)**

```bash
git add test/fixtures/bun-build-entry.ts test/bun-build-keyframes.test.ts
git commit -m "test: gate Bun.build keyframes resolution (red until the keyframes split lands)"
```

---

### Task 2: Ship `.keyframes.css` from the copy script

**Files:**
- Modify: `scripts/copy-recipe-css.ts`
- Create: `test/copy-recipe-css.test.ts`

**Interfaces:**
- Produces: `export function listShippedCss(root?: string): string[]` from `scripts/copy-recipe-css.ts` (absolute paths of every `.module.css` and `.keyframes.css` under `root`, `__screenshots__` skipped).

- [ ] **Step 1: Write the failing tests**

```ts
// test/copy-recipe-css.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("covers each relative .css import in every recipe's TSX", () => {
    const shipped = new Set(listShippedCss(SRC).map((f) => relative(SRC, f)));
    const missing: string[] = [];
    for (const name of listRecipeDirs()) {
      for (const css of cssImportsOf(join(SRC, "recipes", name, `${name}.tsx`))) {
        const rel = relative(SRC, css);
        if (!shipped.has(rel)) missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --project node test/copy-recipe-css.test.ts`
Expected: FAIL. `listShippedCss` is not exported (`SyntaxError` / `is not a function`), and the module's top-level `main()` may also have run and printed `[tui-kit] copy-recipe-css: copied ...` into the test output.

- [ ] **Step 3: Rewrite the script**

Replace the whole file with:

```ts
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
```

`import.meta.main` is typed by `@types/node` (`web-globals/importmeta.d.ts`), true under `bun scripts/copy-recipe-css.ts`, and absent (falsy) when vitest imports the module.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run --project node test/copy-recipe-css.test.ts`
Expected: PASS, 2 tests. Confirm the output contains NO `[tui-kit] copy-recipe-css: copied` line (that would mean `main()` ran under vitest).

- [ ] **Step 5: Confirm the build path still works**

Run: `bun run build && ls dist/src/recipes/Spinner`
Expected: the build log includes `copy-recipe-css: copied 23 recipe stylesheet(s) into dist` (one module per recipe today; the count grows by five over Tasks 3 to 7), and `Spinner.module.css` is listed.

- [ ] **Step 6: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add scripts/copy-recipe-css.ts test/copy-recipe-css.test.ts
git commit -m "build: copy-recipe-css ships *.keyframes.css; export the listing"
```

---

### Task 3: Spinner split, browser helper, scanner sweep

The first recipe carries the shared pieces: the browser-tier keyframes helper and the scanner extension that covers `*.keyframes.css`. Steps 3 to 7 walk the split in two halves on purpose, so the new browser assertion is observed failing on the exact half-split the issue warns about.

**Files:**
- Create: `test/keyframes.ts`
- Create: `src/recipes/Spinner/Spinner.keyframes.css`
- Modify: `src/recipes/Spinner/Spinner.module.css`
- Modify: `src/recipes/Spinner/Spinner.tsx:3`
- Modify: `src/recipes/Spinner/Spinner.test.tsx`
- Modify: `src/recipes/Spinner/Spinner.visual.test.tsx:8-14` (header comment)
- Modify: `test/no-hardcoded-values.test.ts` (real-file sweep section at the bottom)

**Interfaces:**
- Produces: `export function animationResolution(el: Element): { name: string; found: boolean }` and `export function hasKeyframesRule(name: string): boolean` from `test/keyframes.ts`. Tasks 4 to 7 import `animationResolution`.
- Produces: `findCssFiles(dir, suffix)` inside `test/no-hardcoded-values.test.ts`, replacing `findModuleCssFiles(dir)`.

- [ ] **Step 1: Write the browser helper**

```ts
// test/keyframes.ts
/**
 * Computed `animation-name` reports the SPECIFIED ident whether or not any
 * loaded `@keyframes` rule carries that name, so `!== "none"` stays green on
 * an element that never moves (oven-sh/bun#18921 is exactly that: a hashed
 * `@keyframes` next to an unhashed reference). This walks every readable
 * sheet, descending into grouping rules (`@layer`, `@media`, `@supports`),
 * for a `CSSKeyframesRule` named exactly what the element resolved to.
 */
export function hasKeyframesRule(name: string): boolean {
  const walk = (rules: CSSRuleList): boolean => {
    for (const rule of rules) {
      if (rule instanceof CSSKeyframesRule && rule.name === name) return true;
      if (rule instanceof CSSGroupingRule && walk(rule.cssRules)) return true;
    }
    return false;
  };
  for (const sheet of document.styleSheets) {
    try {
      if (walk(sheet.cssRules)) return true;
    } catch {
      // A cross-origin sheet throws on `cssRules`; none of the kit's are.
    }
  }
  return false;
}

/** `found` is true only when `el` names an animation AND some loaded sheet
    declares `@keyframes` under that exact name. */
export function animationResolution(el: Element): { name: string; found: boolean } {
  const name = getComputedStyle(el).animationName;
  return { name, found: name !== "none" && hasKeyframesRule(name) };
}
```

- [ ] **Step 2: Add the Spinner assertion**

In `src/recipes/Spinner/Spinner.test.tsx`, add the import after the `renderWithTheme` import:

```ts
import { animationResolution } from "../../../test/keyframes.ts";
```

and add this case at the end of the `describe("Spinner (browser)", ...)` block:

```tsx
  it("spins via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(<Spinner />);

    const { name, found } = animationResolution(rootOf(screen.container));
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("sb-spinner-spin");
  });
```

- [ ] **Step 3: Run it against the unchanged recipe**

Run: `bunx vitest run --project browser src/recipes/Spinner/Spinner.test.tsx`
Expected: the new case FAILS on the second assertion: `found` is true (Vite rewrote both sides), but `name` is a hashed form like `_sb-spinner-spin_1no2u_1`, not `sb-spinner-spin`. Every other Spinner case passes.

- [ ] **Step 4: Half-split: move only the `@keyframes` block**

Create `src/recipes/Spinner/Spinner.keyframes.css`:

```css
/* Both halves of the spin live here, outside Spinner.module.css, keyed on
   the public `data-part`: see docs/decisions.md, "Keyframes live outside
   the CSS module". */
@layer soribashi.recipes {
  @keyframes sb-spinner-spin {
    to {
      transform: rotate(360deg);
    }
  }
}
```

In `src/recipes/Spinner/Spinner.module.css`, delete the `@keyframes sb-spinner-spin { ... }` block (lines 16-20) but LEAVE `animation: sb-spinner-spin 0.8s linear infinite;` on `.root` for now.

In `src/recipes/Spinner/Spinner.tsx`, add the side-effect import directly under the module import:

```ts
import classes from "./Spinner.module.css";
import "./Spinner.keyframes.css";
```

- [ ] **Step 5: Run it on the half-split and watch the guard bite**

Run: `bunx vitest run --project browser src/recipes/Spinner/Spinner.test.tsx`
Expected: the new case FAILS on the FIRST assertion: `no @keyframes rule named "_sb-spinner-spin_<hash>" in any loaded sheet`. Vite hashed the module's `animation` reference; the global `@keyframes sb-spinner-spin` from the sibling file does not match it. This is the Vite-side breakage the issue predicts, and the reason both halves move together.

- [ ] **Step 6: Finish the split**

`src/recipes/Spinner/Spinner.keyframes.css` becomes:

```css
/* Both halves of the spin live here, outside Spinner.module.css, keyed on
   the public `data-part`: see docs/decisions.md, "Keyframes live outside
   the CSS module". */
@layer soribashi.recipes {
  [data-part="spinner"] {
    animation: sb-spinner-spin 0.8s linear infinite;
  }

  @keyframes sb-spinner-spin {
    to {
      transform: rotate(360deg);
    }
  }
}
```

`src/recipes/Spinner/Spinner.module.css` becomes:

```css
/* `aria-hidden` by contract: the busy CONTEXT (Button, Badge) owns the
   accessible state via `aria-busy`, not this glyph. */
@layer soribashi.recipes {
  .root {
    display: inline-block;
    width: var(--sb-spinner-size);
    height: var(--sb-spinner-size);
    flex-shrink: 0;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: var(--radius-round);
    vertical-align: middle;
  }
}
```

- [ ] **Step 7: Run the Spinner browser tier**

Run: `bunx vitest run --project browser src/recipes/Spinner/Spinner.test.tsx src/recipes/Spinner/Spinner.visual.test.tsx`
Expected: PASS, including the new case (`name` is now the global `sb-spinner-spin`) and the visual baselines (the unlayered `animation: none !important` freeze still wins over the layered `[data-part="spinner"]` rule).

- [ ] **Step 8: Correct the visual test's header comment**

In `src/recipes/Spinner/Spinner.visual.test.tsx`, the header says `Spinner.module.css's .root carries a perpetual animation`. Change that sentence so it names the real home:

```ts
 * but `animation: none` rather than `transition: none`: Spinner.keyframes.css
 * puts a perpetual `animation` (the spin) on `[data-part="spinner"]`, not a
 * transition, so a capture mid-rotation would be non-deterministic between runs.
```

- [ ] **Step 9: Extend the scanner sweep to `*.keyframes.css`**

In `test/no-hardcoded-values.test.ts`, Part 2 (below the `RECIPES_DIR` constant), replace `findModuleCssFiles` and the describe block with:

```ts
function findCssFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findCssFiles(full, suffix));
    } else if (entry.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

function toPosix(file: string): string {
  return relative(RECIPES_DIR, file).split(/[\\/]/).join("/");
}

describe("no hardcoded values: real recipe stylesheets", () => {
  const moduleFiles = findCssFiles(RECIPES_DIR, ".module.css").sort((a, b) => a.localeCompare(b));
  const keyframesFiles = findCssFiles(RECIPES_DIR, ".keyframes.css").sort((a, b) =>
    a.localeCompare(b),
  );

  /**
   * soribashi's floor here is `files.length > 0`, which cannot hold in this
   * kit: the gate is committed before the first recipe exists (Icon lands
   * next), and a floor that has to be disabled for a while is a floor nobody
   * re-enables. The replacement is strictly stronger AND true at zero... it
   * pins the sweep to the directory listing, so a recipe folder whose
   * stylesheet is missing, misnamed, or in a subfolder the walker doesn't
   * reach fails here rather than being silently skipped.
   */
  it("sweeps exactly one CSS module per recipe directory", () => {
    expect(moduleFiles.map(toPosix)).toEqual(
      listRecipeDirs().map((name) => `${name}/${name}.module.css`),
    );
  });

  /**
   * A keyframes sibling is optional (only recipes that animate carry one),
   * so there is no one-per-directory floor; what IS pinned is that each one
   * sits directly in its recipe directory under `<Recipe>.keyframes.css`,
   * the path the copy script, derive.ts and the recipe's own import agree on.
   */
  it("every keyframes stylesheet sits in its recipe directory, named after it", () => {
    const dirs = listRecipeDirs();
    for (const rel of keyframesFiles.map(toPosix)) {
      const dir = rel.split("/")[0] as string;
      expect(dirs, `${rel} is not inside a recipe directory`).toContain(dir);
      expect(rel).toBe(`${dir}/${dir}.keyframes.css`);
    }
  });

  it.each([...moduleFiles, ...keyframesFiles].map((f) => [toPosix(f), f] as const))(
    "%s has no hardcoded colour/length values outside the allowlist",
    (_label, file) => {
      const source = readFileSync(file, "utf8");
      const violations = scanCssModule(source, toPosix(file));
      expect(violations, formatViolations(violations)).toEqual([]);
    },
  );
});
```

(The doc comment above the one-per-directory row is the existing one, re-emitted with its dash replaced by an ellipsis.)

- [ ] **Step 10: Run the node gates**

Run: `bunx vitest run --project node test/no-hardcoded-values.test.ts test/copy-recipe-css.test.ts test/bun-build-keyframes.test.ts`
Expected:
- `no-hardcoded-values`: PASS. The sweep now lists 24 stylesheets (23 modules + `Spinner/Spinner.keyframes.css`), and the keyframes file passes (`0.8s` is a time value, `360deg` is not a length).
- `copy-recipe-css`: PASS (the new `./Spinner.keyframes.css` import is shipped).
- `bun-build-keyframes`: the `emits @keyframes sb-spinner-spin` row now PASSES; the other four idents and the "every ident" row still FAIL.

- [ ] **Step 11: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add test/keyframes.ts test/no-hardcoded-values.test.ts src/recipes/Spinner
git commit -m "fix: Spinner keyframes and animation move to Spinner.keyframes.css"
```

---

### Task 4: Chip split

**Files:**
- Create: `src/recipes/Chip/Chip.keyframes.css`
- Modify: `src/recipes/Chip/Chip.module.css:39-61`
- Modify: `src/recipes/Chip/Chip.tsx:4`
- Modify: `src/recipes/Chip/Chip.test.tsx` (new case; comment at line 463)
- Modify: `src/recipes/Chip/Chip.visual.test.tsx:12` (header comment)

**Interfaces:**
- Consumes: `animationResolution` from `test/keyframes.ts` (Task 3).

- [ ] **Step 1: Add the assertion**

In `src/recipes/Chip/Chip.test.tsx`, add the import after the `renderWithTheme` import:

```ts
import { animationResolution } from "../../../test/keyframes.ts";
```

and add this case directly after `"pulses on the board's cadence, and only when asked"`:

```tsx
  it("pulses via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(<Chip pulse>reviewing</Chip>);

    const { name, found } = animationResolution(chipOf(screen.container));
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("chip-pulse");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --project browser src/recipes/Chip/Chip.test.tsx`
Expected: the new case FAILS on `name` (a hashed `_chip-pulse_<hash>`), everything else passes.

- [ ] **Step 3: Create the keyframes file**

`src/recipes/Chip/Chip.keyframes.css`:

```css
/* The pulse's longhands, its reduced-motion override and its keyframes live
   here, outside Chip.module.css, keyed on the public `data-part`: see
   docs/decisions.md, "Keyframes live outside the CSS module". */
@layer soribashi.recipes {
  [data-part="chip"][data-pulse] {
    animation-name: chip-pulse;
    animation-duration: var(--sb-chip-pulse-period);
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    [data-part="chip"][data-pulse] {
      animation-name: none;
    }
  }

  @keyframes chip-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
}
```

- [ ] **Step 4: Remove the motion from the module**

In `src/recipes/Chip/Chip.module.css`, delete these three blocks entirely (the `.root[data-pulse]` rule, its `@media (prefers-reduced-motion: reduce)` override, and `@keyframes chip-pulse`):

```css
  .root[data-pulse] {
    animation-name: chip-pulse;
    animation-duration: var(--sb-chip-pulse-period);
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .root[data-pulse] {
      animation-name: none;
    }
  }

  @keyframes chip-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
```

Leave `.root[data-variant="outline"]` above and the `.root[data-dimmed]` comment and rule below untouched.

- [ ] **Step 5: Import it**

In `src/recipes/Chip/Chip.tsx`:

```ts
import classes from "./Chip.module.css";
import "./Chip.keyframes.css";
```

- [ ] **Step 6: Correct the two comments that name the module**

`src/recipes/Chip/Chip.test.tsx` line 463 area, inside `"runs under no-preference reduced motion, so the pulse cases mean something"`:

```ts
    // The pulse assertions read `animationName`, which Chip.keyframes.css sets to
```

`src/recipes/Chip/Chip.visual.test.tsx` line 12 header: replace `Chip.module.css carries a` with `Chip.keyframes.css carries a` and keep the rest of the sentence.

- [ ] **Step 7: Run the Chip browser tier**

Run: `bunx vitest run --project browser src/recipes/Chip/Chip.test.tsx src/recipes/Chip/Chip.visual.test.tsx`
Expected: PASS. The matrix rows that assert `animationName === "none"` for non-pulse chips and `!== "none"` for pulse chips are unaffected (the `[data-part="chip"][data-pulse]` selector has the same specificity the `.root[data-pulse]` rule had, and nothing else declares animation on the chip). Visual baselines unchanged.

- [ ] **Step 8: Run the node gates**

Run: `bunx vitest run --project node test/no-hardcoded-values.test.ts test/copy-recipe-css.test.ts test/bun-build-keyframes.test.ts`
Expected: no-hardcoded-values PASS (25 stylesheets swept; `0%, 100% {` and `50% {` are keyframe selectors, not values); copy-recipe-css PASS; bun-build: `chip-pulse` row now PASSES, three idents and the "every ident" row still fail.

- [ ] **Step 9: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/recipes/Chip
git commit -m "fix: Chip pulse keyframes and longhands move to Chip.keyframes.css"
```

---

### Task 5: Drawer split

**Files:**
- Create: `src/recipes/Drawer/Drawer.keyframes.css`
- Modify: `src/recipes/Drawer/Drawer.module.css:130-156`
- Modify: `src/recipes/Drawer/Drawer.tsx` (after the `./Drawer.module.css` import)
- Modify: `src/recipes/Drawer/Drawer.test.tsx` (case at line 291)

**Interfaces:**
- Consumes: `animationResolution` from `test/keyframes.ts` (Task 3).

- [ ] **Step 1: Strengthen the existing slide-in case**

In `src/recipes/Drawer/Drawer.test.tsx`, add the import after the `renderWithTheme` import:

```ts
import { animationResolution } from "../../../test/keyframes.ts";
```

Replace the body of `"the content slot slides in on mount"` so it reads:

```tsx
  it("the content slot slides in on mount, via a @keyframes rule a loaded sheet declares", async () => {
    const screen = await renderWithTheme(
      <Drawer open stack={rootStack()} onBack={noop} onClose={noop} ariaLabel="d" />,
    );

    const content = partOf(screen.container, DRAWER_PARTS.content);
    const { name, found } = animationResolution(content);
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("drawer-slide-in");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --project browser src/recipes/Drawer/Drawer.test.tsx`
Expected: that case FAILS on `name` (hashed), all others pass.

- [ ] **Step 3: Create the keyframes file**

`src/recipes/Drawer/Drawer.keyframes.css`:

```css
/* The content slide-in, its reduced-motion override and its keyframes live
   here, outside Drawer.module.css, keyed on the public `data-part`: see
   docs/decisions.md, "Keyframes live outside the CSS module".
   `--sb-drawer-slide-x` is set inline on the content element by Drawer.tsx
   (push vs. pop direction). */
@layer soribashi.recipes {
  [data-part="drawer-content"] {
    animation: drawer-slide-in 160ms ease-out;
  }

  @keyframes drawer-slide-in {
    from {
      opacity: 0;
      transform: translateX(var(--sb-drawer-slide-x));
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-part="drawer-content"] {
      animation: none;
    }
  }
}
```

- [ ] **Step 4: Remove the motion from the module**

In `src/recipes/Drawer/Drawer.module.css`, the tail of the file currently reads:

```css
  .content {
    flex: 1 1 auto;
    /* Without this a flex child's min-height defaults to its content size,
       which would let content overflow `.frame` instead of scrolling here. */
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-rem100);
    animation: drawer-slide-in 160ms ease-out;
  }

  @keyframes drawer-slide-in {
    from {
      opacity: 0;
      transform: translateX(var(--sb-drawer-slide-x));
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .content {
      animation: none;
    }
  }
}
```

Make it:

```css
  .content {
    flex: 1 1 auto;
    /* Without this a flex child's min-height defaults to its content size,
       which would let content overflow `.frame` instead of scrolling here. */
    min-height: 0;
    overflow-y: auto;
    padding: var(--spacing-rem100);
  }
}
```

- [ ] **Step 5: Import it**

In `src/recipes/Drawer/Drawer.tsx`, directly under `import classes from "./Drawer.module.css";`:

```ts
import "./Drawer.keyframes.css";
```

- [ ] **Step 6: Run the Drawer browser tier**

Run: `bunx vitest run --project browser src/recipes/Drawer/Drawer.test.tsx src/recipes/Drawer/Drawer.visual.test.tsx`
Expected: PASS, including the strengthened slide-in case with `name === "drawer-slide-in"`.

- [ ] **Step 7: Run the node gates**

Run: `bunx vitest run --project node test/no-hardcoded-values.test.ts test/copy-recipe-css.test.ts test/bun-build-keyframes.test.ts`
Expected: no-hardcoded-values PASS (26 swept; `160ms` is a time value); copy PASS; bun-build: `drawer-slide-in` row PASSES, two idents and the "every ident" row still fail.

- [ ] **Step 8: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/recipes/Drawer
git commit -m "fix: Drawer slide-in keyframes and animation move to Drawer.keyframes.css"
```

---

### Task 6: ContextMenu split

**Files:**
- Create: `src/recipes/ContextMenu/ContextMenu.keyframes.css`
- Modify: `src/recipes/ContextMenu/ContextMenu.module.css:12-41`
- Modify: `src/recipes/ContextMenu/ContextMenu.tsx` (after the `./ContextMenu.module.css` import)
- Modify: `src/recipes/ContextMenu/ContextMenu.test.tsx` (new case)
- Modify: `src/recipes/ContextMenu/ContextMenu.visual.test.tsx:11` (header comment)

**Interfaces:**
- Consumes: `animationResolution` from `test/keyframes.ts` (Task 3).

- [ ] **Step 1: Add the assertion**

In `src/recipes/ContextMenu/ContextMenu.test.tsx`, add the import after the `renderWithTheme` import:

```ts
import { animationResolution } from "../../../test/keyframes.ts";
```

and add this case directly after `"renders a labelled menu whose items are menuitems"`:

```tsx
  it("opens via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(
      <ContextMenu x={40} y={40} ariaLabel="m" onClose={noop}>
        <ContextMenu.Item label="open in gitlab" onClick={noop} />
      </ContextMenu>,
    );

    // `animation-name` is a static computed value: it still reads the ident
    // after the 90ms entry animation has finished, so no settle wait here.
    const { name, found } = animationResolution(rootOf(screen.container));
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("contextmenu-in");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --project browser src/recipes/ContextMenu/ContextMenu.test.tsx`
Expected: the new case FAILS on `name` (hashed), all others pass.

- [ ] **Step 3: Create the keyframes file**

`src/recipes/ContextMenu/ContextMenu.keyframes.css`:

```css
/* The entry animation and its keyframes live here, outside
   ContextMenu.module.css, keyed on the public `data-part`: see
   docs/decisions.md, "Keyframes live outside the CSS module".
   `contextmenu-in`, not mr-board's `tui-menu-in`: this ident is global, so
   the NAME is what keeps it from colliding with the board's own copy while
   both stylesheets are loaded. */
@layer soribashi.recipes {
  [data-part="contextmenu"] {
    animation: contextmenu-in 90ms ease-out;
  }

  @keyframes contextmenu-in {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-2px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
```

- [ ] **Step 4: Remove the motion from the module**

In `src/recipes/ContextMenu/ContextMenu.module.css`, delete `animation: contextmenu-in 90ms ease-out;` from `.root`, and delete the rename comment plus the keyframes block that follow it:

```css
  /* Renamed from mr-board's `tui-menu-in`: CSS modules scope a keyframe name
     the same way they scope a class, so the local name cannot collide with the
     board's own copy while both stylesheets are loaded. */
  @keyframes contextmenu-in {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(-2px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
```

(That comment's reasoning, "the hash prevents collision", is no longer true; the keyframes file's comment carries the corrected reason.) `.root` ends with `font-size: var(--font-size-px13);` afterwards.

- [ ] **Step 5: Import it**

In `src/recipes/ContextMenu/ContextMenu.tsx`, directly under `import classes from "./ContextMenu.module.css";`:

```ts
import "./ContextMenu.keyframes.css";
```

- [ ] **Step 6: Correct the visual test's header comment**

In `src/recipes/ContextMenu/ContextMenu.visual.test.tsx` line 11, replace `ContextMenu.module.css's .root carries a real` with `ContextMenu.keyframes.css puts a real` and adjust the sentence so it still reads: `... puts a real (one-shot, not perpetual) animation (contextmenu-in) on [data-part="contextmenu"], so a capture mid-open ...`.

- [ ] **Step 7: Run the ContextMenu browser tier**

Run: `bunx vitest run --project browser src/recipes/ContextMenu/ContextMenu.test.tsx src/recipes/ContextMenu/ContextMenu.visual.test.tsx`
Expected: PASS. The geometry cases still call `settledBox`, which waits on `el.getAnimations()`; the animation still runs (now from the sibling file), so nothing about their timing changes.

- [ ] **Step 8: Run the node gates**

Run: `bunx vitest run --project node test/no-hardcoded-values.test.ts test/copy-recipe-css.test.ts test/bun-build-keyframes.test.ts`
Expected: no-hardcoded-values PASS (27 swept; `-2px` is `2px`, allowlisted; `0.97` unitless); copy PASS; bun-build: `contextmenu-in` row PASSES, `toasthost-in` and the "every ident" row still fail.

- [ ] **Step 9: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/recipes/ContextMenu
git commit -m "fix: ContextMenu entry keyframes and animation move to ContextMenu.keyframes.css"
```

---

### Task 7: ToastHost split, manifest derivation

ToastHost's keyframes read a THEME token (`--spacing-px12`), which is what makes `scripts/derive.ts`'s token scrape need the keyframes file. That change and its test ride with this recipe.

**Files:**
- Create: `src/recipes/ToastHost/ToastHost.keyframes.css`
- Modify: `src/recipes/ToastHost/ToastHost.module.css:34-46`
- Modify: `src/recipes/ToastHost/ToastHost.tsx` (after the `./ToastHost.module.css` import)
- Modify: `src/recipes/ToastHost/ToastHost.test.tsx` (new case)
- Modify: `src/recipes/ToastHost/ToastHost.visual.test.tsx:12` (header comment)
- Modify: `scripts/derive.ts` (`ManifestEntry.files` doc, `buildManifestEntriesForDir`)
- Modify: `test/token-existence.test.ts` (new case)

**Interfaces:**
- Consumes: `animationResolution` from `test/keyframes.ts` (Task 3).
- Produces: `ManifestEntry.files` now includes `src/recipes/<Name>/<Name>.keyframes.css` when it exists; `tokenDependencies` covers both stylesheets.

- [ ] **Step 1: Add the browser assertion**

In `src/recipes/ToastHost/ToastHost.test.tsx`, add the import after the `renderWithTheme` import:

```ts
import { animationResolution } from "../../../test/keyframes.ts";
```

and add this case directly after `"applies its layered stylesheet to the rendered elements"`:

```tsx
  it("each toast slides in via a @keyframes rule a loaded sheet actually declares, under its global name", async () => {
    const screen = await renderWithTheme(<ToastHost toasts={TOASTS} />);

    const [first] = toastsOf(screen.container);
    const { name, found } = animationResolution(first as HTMLElement);
    expect(found, `no @keyframes rule named "${name}" in any loaded sheet`).toBe(true);
    expect(name).toBe("toasthost-in");
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run --project browser src/recipes/ToastHost/ToastHost.test.tsx`
Expected: the new case FAILS on `name` (hashed), all others pass.

- [ ] **Step 3: Create the keyframes file**

`src/recipes/ToastHost/ToastHost.keyframes.css`:

```css
/* The toast slide-in and its keyframes live here, outside
   ToastHost.module.css, keyed on the public `data-part`: see
   docs/decisions.md, "Keyframes live outside the CSS module". */
@layer soribashi.recipes {
  [data-part="toasthost-toast"] {
    animation: toasthost-in 140ms ease-out;
  }

  @keyframes toasthost-in {
    from {
      opacity: 0;
      transform: translateX(var(--spacing-px12));
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
```

- [ ] **Step 4: Remove the motion from the module**

In `src/recipes/ToastHost/ToastHost.module.css`, delete `animation: toasthost-in 140ms ease-out;` from `.toast` (so `.toast` ends with `max-width: 320px;`) and delete the `@keyframes toasthost-in { ... }` block that follows it. The file ends with `.toast`'s closing brace and the layer's closing brace.

- [ ] **Step 5: Import it**

In `src/recipes/ToastHost/ToastHost.tsx`, directly under `import classes from "./ToastHost.module.css";`:

```ts
import "./ToastHost.keyframes.css";
```

- [ ] **Step 6: Correct the visual test's header comment**

In `src/recipes/ToastHost/ToastHost.visual.test.tsx` line 12, replace `ToastHost.module.css's .toast carries a real` with `ToastHost.keyframes.css puts a real` and adjust so it reads: `... puts a real (one-shot, not perpetual) animation (toasthost-in) on [data-part="toasthost-toast"], so a capture mid-slide-in ...`.

- [ ] **Step 7: Run the ToastHost browser tier**

Run: `bunx vitest run --project browser src/recipes/ToastHost/ToastHost.test.tsx src/recipes/ToastHost/ToastHost.visual.test.tsx`
Expected: PASS.

- [ ] **Step 8: Write the failing manifest test**

In `test/token-existence.test.ts`, add this case inside the existing `describe`, after `"every manifest entry's name is unique"`:

```ts
  it("a recipe's keyframes stylesheet is part of its manifest entry and its token scrape", async () => {
    // ToastHost's slide-in offset (`--spacing-px12`) is referenced ONLY from
    // ToastHost.keyframes.css. A scrape that read the CSS module alone would
    // drop it, and the row below would then never check it against the theme.
    const manifest = await buildManifest();
    const toastHost = manifest.recipes.find((r) => r.name === "ToastHost");
    expect(toastHost?.files).toContain("src/recipes/ToastHost/ToastHost.keyframes.css");
    expect(toastHost?.tokenDependencies).toContain("--spacing-px12");
  });
```

- [ ] **Step 9: Run it to verify it fails**

Run: `bunx vitest run --project node test/token-existence.test.ts`
Expected: the new case FAILS on `files` (no keyframes entry) and would also fail on `tokenDependencies` (the module no longer references `--spacing-px12`).

- [ ] **Step 10: Extend derive.ts**

In `scripts/derive.ts`, change the `files` field doc on `ManifestEntry`:

```ts
  /** The four recipe files (tsx, module.css, test.tsx, visual.test.tsx), repo-relative,
      plus `<Name>.keyframes.css` when the recipe ships one. */
  files: string[];
```

and the `tokenDependencies` doc:

```ts
  /** Sorted, deduped theme CSS custom-property names the recipe's stylesheets (module
      and keyframes) depend on. */
  tokenDependencies: string[];
```

In `buildManifestEntriesForDir`, after `const visualTestPath = ...;` add:

```ts
  const keyframesPath = join(recipeDir, `${name}.keyframes.css`);
  const hasKeyframes = existsSync(keyframesPath);
```

and replace the two lines

```ts
  const files = [tsxPath, cssPath, testPath, visualTestPath].map(toRepoRelative);
  const tokenDependencies = extractTokenDependencies(cssSource);
```

with

```ts
  const keyframesSource = hasKeyframes ? readFileSync(keyframesPath, "utf-8") : "";
  const files = [
    tsxPath,
    cssPath,
    testPath,
    visualTestPath,
    ...(hasKeyframes ? [keyframesPath] : []),
  ].map(toRepoRelative);
  const tokenDependencies = extractTokenDependencies(`${cssSource}\n${keyframesSource}`);
```

`existsSync` and `readFileSync` are already imported at the top of derive.ts.

- [ ] **Step 11: Run the node gates**

Run: `bunx vitest run --project node test/token-existence.test.ts test/no-hardcoded-values.test.ts test/copy-recipe-css.test.ts test/bun-build-keyframes.test.ts`
Expected: ALL PASS. token-existence's new case is green and `--spacing-px12` still resolves against `src/generated/theme.css`; no-hardcoded-values sweeps 28 stylesheets; the Bun gate is fully green for the first time (five idents present unhashed, every reference resolved).

- [ ] **Step 12: Typecheck and commit**

Run: `bun run typecheck`
Expected: clean.

```bash
git add src/recipes/ToastHost scripts/derive.ts test/token-existence.test.ts
git commit -m "fix: ToastHost keyframes move to ToastHost.keyframes.css; derive scrapes them"
```

---

### Task 8: Lock it in: module motion ban, gates script, decision record

**Files:**
- Modify: `test/no-hardcoded-values.test.ts` (header comment, `Violation.kind`, new detector + unit rows + real-file row, `formatViolations`)
- Modify: `package.json:37` (`gates` script)
- Modify: `docs/decisions.md` (new section)

- [ ] **Step 1: Write the failing detector unit tests**

In `test/no-hardcoded-values.test.ts`, add a new describe block between Part 1 and Part 2:

```ts
describe("findMotionInModule", () => {
  it("flags an @keyframes block inside a CSS module", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  @keyframes spin { to { transform: rotate(360deg); } }",
      "}",
      "",
    ].join("\n");
    expect(findMotionInModule(css, "fixture.module.css")).toEqual([
      { path: "fixture.module.css", line: 2, token: "@keyframes", kind: "motion" },
    ]);
  });

  it("flags animation and animation-name declarations, whatever their value", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root { animation: spin 1s linear infinite; }",
      "  .root[data-x] { animation-name: none; }",
      "}",
      "",
    ].join("\n");
    expect(findMotionInModule(css, "fixture.module.css").map((v) => [v.line, v.token])).toEqual([
      [2, "animation:"],
      [3, "animation-name:"],
    ]);
  });

  it("ignores commented-out motion and other animation-* longhands", () => {
    // `animation-duration` and friends are harmless on their own: only the
    // NAME binding (shorthand or `animation-name`) has to sit next to the
    // `@keyframes` it names.
    const css = [
      "@layer soribashi.recipes {",
      "  /* animation: spin 1s; */",
      "  .root { animation-duration: var(--sb-x-period); transition: opacity 1s; }",
      "}",
      "",
    ].join("\n");
    expect(findMotionInModule(css, "fixture.module.css")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bunx vitest run --project node test/no-hardcoded-values.test.ts`
Expected: FAIL, `findMotionInModule is not defined`.

- [ ] **Step 3: Implement the detector**

In `test/no-hardcoded-values.test.ts`:

Extend the `Violation` kind union:

```ts
interface Violation {
  path: string;
  line: number;
  token: string;
  kind: "layer" | "color" | "length" | "motion";
}
```

Add, directly above `scanCssModule`:

```ts
/**
 * A `@keyframes` block or an `animation` / `animation-name` declaration
 * inside a CSS MODULE. Bun hashes a module's `@keyframes` ident without
 * rewriting the `animation` that names it (oven-sh/bun#18921), and Vite
 * hashes the `animation` ident whether or not the module declares the
 * keyframe, so the only layout both bundlers get right keeps both halves in
 * the plain `<Recipe>.keyframes.css` sibling (docs/decisions.md).
 */
const MOTION_IN_MODULE = /@keyframes\b|(?<![\w-])animation(?:-name)?\s*:/g;

function findMotionInModule(source: string, path: string): Violation[] {
  const scanned = stripCommentsPreservingLines(source);
  const violations: Violation[] = [];
  for (const m of scanned.matchAll(MOTION_IN_MODULE)) {
    const token = m[0].startsWith("@") ? "@keyframes" : m[0].replace(/\s+/g, "");
    violations.push({ path, line: lineOf(scanned, m.index), token, kind: "motion" });
  }
  return violations;
}
```

Update `formatViolations` so a motion row reads sensibly:

```ts
function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "";
  return violations
    .map((v) =>
      v.kind === "motion"
        ? `${v.path}:${v.line}: "${v.token}" belongs in the recipe's *.keyframes.css, not its CSS module (docs/decisions.md)`
        : `${v.path}:${v.line}: hardcoded ${v.kind} literal "${v.token}"`,
    )
    .join("\n");
}
```

- [ ] **Step 4: Run the unit rows**

Run: `bunx vitest run --project node test/no-hardcoded-values.test.ts`
Expected: the three `findMotionInModule` rows PASS.

- [ ] **Step 5: Add the real-file row**

Inside `describe("no hardcoded values: real recipe stylesheets", ...)`, after the `it.each([...moduleFiles, ...keyframesFiles])` row, add:

```ts
  it.each(moduleFiles.map((f) => [toPosix(f), f] as const))(
    "%s keeps @keyframes and animation declarations out of the CSS module",
    (_label, file) => {
      const violations = findMotionInModule(readFileSync(file, "utf8"), toPosix(file));
      expect(violations, formatViolations(violations)).toEqual([]);
    },
  );
```

Also update the file's header doc comment: add a rule 6 to the numbered list:

```
 *   6. A CSS MODULE may declare no `@keyframes` block and no `animation` /
 *      `animation-name`. Those live in the recipe's `<Name>.keyframes.css`
 *      sibling, which this file sweeps with rules 1 to 5 as well
 *      (docs/decisions.md, "Keyframes live outside the CSS module").
```

- [ ] **Step 6: Prove the ban bites, then restore**

Temporarily append `animation: sb-spinner-spin 1s;` to `.root` in `src/recipes/Spinner/Spinner.module.css`, run `bunx vitest run --project node test/no-hardcoded-values.test.ts`, and confirm the `Spinner/Spinner.module.css keeps @keyframes ...` row FAILS with the `belongs in the recipe's *.keyframes.css` message. Then `git checkout src/recipes/Spinner/Spinner.module.css` and re-run: all rows PASS.

- [ ] **Step 7: Add the two new gates to `bun run gates`**

In `package.json`, the `gates` script becomes:

```json
    "gates": "vitest run --project node test/no-hardcoded-values.test.ts test/token-existence.test.ts test/no-node-builtins.test.ts test/copy-recipe-css.test.ts test/bun-build-keyframes.test.ts && bun run codegen && git diff --exit-code src/generated/theme.css",
```

Run: `bun run gates`
Expected: all five test files pass, codegen runs, `theme.css` diff is empty.

- [ ] **Step 8: Record the decision**

Append to `docs/decisions.md` (after the `## Per-recipe box-sizing: border-box` section, before `## Why src/provider.ts exists`):

```markdown
## Keyframes live outside the CSS module

Every `@keyframes` block, together with the `animation` / `animation-name`
declaration that names it (and any `prefers-reduced-motion` override of that
declaration), lives in a plain `<Recipe>.keyframes.css` sibling of the
recipe's `.module.css`, still inside `@layer soribashi.recipes`, selected by
the recipe's public `data-part`, and side-effect-imported from the recipe
TSX. Five recipes carry one: Spinner (`sb-spinner-spin`), Chip
(`chip-pulse`), Drawer (`drawer-slide-in`), ContextMenu (`contextmenu-in`),
ToastHost (`toasthost-in`).

Two bundlers disagree about a keyframe inside a CSS module, in opposite
directions, and no single-file layout satisfies both:

- Bun through 1.3.14 hashes the `@keyframes` ident but emits `animation` /
  `animation-name` verbatim (oven-sh/bun#18921). In a `Bun.build` consumer
  the ring painted its first frame and never moved: `animation:
  sb-spinner-spin` next to `@keyframes sb-spinner-spin_UXKcrg`. The upstream
  fix is not in a released Bun that consumers pin, and the kit has to animate
  on the ones that still have the bug.
- Vite hashes the `animation` ident whether or not the module declares that
  keyframe. Moving only the `@keyframes` out would have frozen the workshop
  and the browser test tier instead.

`:global()` is not an escape hatch: `@keyframes :global(name)` is a parse
error in Bun.

Consequences a later change must keep:

- The idents are global now, so their uniqueness is the collision avoidance
  (ContextMenu's `contextmenu-in` rather than mr-board's `tui-menu-in`). The
  hash never protected them in Bun, and no longer exists to protect them
  anywhere.
- The `[data-part]` rule applies even under `unstyled`, which suppresses the
  module class but still stamps the part. An `unstyled` Spinner still spins;
  an `unstyled` Chip with `pulse` still pulses. Nothing in the kit relies on
  `unstyled` silencing motion.
- `scripts/copy-recipe-css.ts` ships `*.keyframes.css` next to
  `*.module.css`, `scripts/derive.ts` scrapes both for `tokenDependencies`,
  and `test/no-hardcoded-values.test.ts` sweeps both with the same rules and
  rejects any `@keyframes` / `animation` that reappears inside a module.
- `test/bun-build-keyframes.test.ts` bundles the barrel with the local `bun`
  and reads the emitted CSS; the browser tiers assert the computed
  `animationName` matches a real `CSSKeyframesRule` (`test/keyframes.ts`).
  Computed styles and `animationName !== "none"` alone cannot see this bug,
  and the visual tiers freeze motion on purpose.

Do not fold the two halves back into the module "to keep the recipe in one
file". That is the layout that froze deck.
```

- [ ] **Step 9: Full verification**

Run, in order:

```bash
bun run typecheck
bun run test
bun run gates
bun run build && ls dist/src/recipes/Spinner dist/src/recipes/Chip dist/src/recipes/Drawer dist/src/recipes/ContextMenu dist/src/recipes/ToastHost | grep keyframes
grep -n "keyframes.css" dist/src/recipes/Spinner/Spinner.js
```

Expected:
- typecheck clean.
- `bun run test`: node tier and browser tier both green, screenshots unchanged (no new files under any `__screenshots__/`; check with `git status --porcelain src/recipes/**/__screenshots__`, expected empty).
- `bun run gates` green.
- build log says `copied 28 recipe stylesheet(s)`; the `ls | grep` prints the five `<Name>.keyframes.css`; the `grep` on `Spinner.js` shows `import "./Spinner.keyframes.css";`.

- [ ] **Step 10: Commit**

```bash
git add test/no-hardcoded-values.test.ts package.json docs/decisions.md
git commit -m "test: reject keyframes/animation inside CSS modules; gate Bun bundle and copy listing"
```

- [ ] **Step 11: Hand back the workshop check (do NOT open a browser)**

Report to the human that the last "done when" bullet still open is the visual workshop confirmation: `bun run dev:workshop`, then check that Spinner spins, a `pulse` Chip pulses, a Drawer's content slides in, a ContextMenu opens with its scale-in, and a toast slides in. The human decides whether to run it or to have you run it.

---

## Self-review

**Spec coverage**

| Issue requirement | Task |
|---|---|
| Lift `@keyframes` AND `animation` out of the five modules into a sibling non-module CSS, in `@layer soribashi.recipes`, keyed on `data-part`, side-effect-imported | 3, 4, 5, 6, 7 |
| Keep the five idents unchanged | Global constraint; Bun gate rows pin each name (Task 1) |
| Do not leave `animation` in the module with keyframes elsewhere | Task 3 steps 4 to 6 demonstrate the failure; Task 8 bans it mechanically |
| Packaging: extend `copy-recipe-css`, no second script | Task 2 |
| Scanner covers whatever file holds the keyframes | Task 3 step 9 |
| `docs/decisions.md` entry | Task 8 step 8 |
| Browser-tier `CSSKeyframesRule` assertion on Spinner, Chip pulse, Drawer content, ContextMenu, ToastHost | Tasks 3 to 7 |
| `Bun.build` emits matching idents | Task 1 gate, green at Task 7 step 11 |
| Vite workshop still animates | Browser tier (Vite) green throughout; manual workshop check handed back in Task 8 step 11 |
| Out of scope: Bun bump, timing changes, renames, deck's copy | Untouched |

**Placeholder scan:** every code step carries the full content. No "similar to Task N" references; the per-recipe tasks repeat the import and assertion shapes in full.

**Type consistency:** `animationResolution(el: Element): { name: string; found: boolean }` is used identically in Tasks 3 to 7. `listShippedCss(root?: string): string[]` is defined in Task 2 and consumed by `test/copy-recipe-css.test.ts` only. `findCssFiles(dir, suffix)` and `toPosix(file)` are defined in Task 3 step 9 and reused in Task 8 step 5. `Violation.kind` gains `"motion"` in Task 8 before `findMotionInModule` returns it.
