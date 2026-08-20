import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, listRecipeDirs } from "../scripts/derive.ts";

/**
 * Token-existence gate, ported from soribashi's
 * packages/ui/test/token-existence.test.ts: every `--x` custom property a
 * recipe's stylesheet depends on (derive.ts's `tokenDependencies`, scraped from
 * `var(--x)` occurrences whose name is part of the theme contract) must be a
 * real custom property the kit actually emits. A `tokenDependencies` entry that
 * resolves to nothing at runtime is a recipe silently relying on the browser's
 * unregistered-custom-property behaviour (reads as `initial`/inherited, not a
 * real value) instead of on the theme.
 *
 * TWO deliberate departures from the soribashi original:
 *
 *  1. THE EMITTED SET IS READ FROM `src/generated/theme.css`, NOT FROM
 *     `emitCss(theme)`. This is not a shortcut, it is a correctness fix for
 *     this kit: a third of the contract — the 19 board alias names (`--bg`,
 *     `--fg`, `--accent`, ...) — is injected by soribashi.config.ts's
 *     `cssVariablesResolver`, which is a CODEGEN CONFIG concern that
 *     `emitCss(tuiTheme)` knows nothing about. Calling emitCss here would
 *     declare every alias missing and fail the gate on correct recipes. The
 *     generated file is the artifact recipes actually render against, and
 *     `bun run gates` regenerates it and diffs it in the same breath, so
 *     reading it cannot go stale behind the gate's back.
 *  2. THE BARE-THEME ROW IS DROPPED. soribashi's second row re-runs the check
 *     against `createTheme({ tokens, dark })` with no `semanticTokens`, because
 *     its recipes ship through a shadcn registry into apps that bring their own
 *     theme, and a token only `uiTheme` declared shipped broken. This kit has
 *     exactly one theme and ships it WITH the recipes (`@mattstack/tui-kit/theme.css`
 *     is a package export); there is no "consumer with no semanticTokens" to
 *     protect. Reinstate the row the day the kit grows a second theme.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const GENERATED_CSS = join(REPO_ROOT, "src", "generated", "theme.css");

/**
 * Deliberate var-fallback dependencies: names a recipe reaches for knowing the
 * theme does not emit them, because the `var(--x, fallback)` path is the real,
 * working behaviour.
 *
 * Empty, and an entry here is a decision rather than a formality: adding one
 * says "this recipe renders correctly with this property undefined, and the
 * fallback is the intended value". The default answer is instead to add the
 * token to src/theme.ts (or the alias contract in soribashi.config.ts). Each
 * entry needs its own comment saying why the recipe stays correct without it.
 */
const ALLOWLIST: ReadonlySet<string> = new Set<string>();

/**
 * Every custom-property NAME declared (given a value) in emitted CSS text, as
 * opposed to merely referenced via `var(--x)`. Declarations in the generated
 * file always start a line with `--name:` (after leading whitespace); a
 * `var(--x)` reference never appears that way, since it is always the
 * right-hand side of some other declaration or nested inside a `var(...)` call.
 */
function extractEmittedVarNames(css: string): Set<string> {
  const names = new Set<string>();
  const re = /^[ \t]*(--[a-zA-Z0-9-]+)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1];
    if (name) names.add(name);
  }
  return names;
}

const EMITTED = extractEmittedVarNames(readFileSync(GENERATED_CSS, "utf8"));

describe("token existence: recipe tokenDependencies resolve against emitted CSS", () => {
  it("the emitted set is non-empty and carries the alias contract", () => {
    // Guards the extractor, not the recipes: a regex that stopped matching
    // would make every row below vacuously green. Deliberately asserts the
    // alias names too, since departure (1) above exists precisely because
    // those are the ones `emitCss` would have missed.
    expect(EMITTED.size).toBeGreaterThan(100);
    for (const alias of ["--bg", "--fg", "--accent", "--font-mono", "--grid-line"]) {
      expect(EMITTED.has(alias), `${alias} missing from ${GENERATED_CSS}`).toBe(true);
    }
  });

  it("the manifest names every recipe directory", async () => {
    // soribashi's floor is `recipes.length > 0`, which cannot hold before the
    // first recipe lands. This is the stronger form and is true at zero: if
    // derive.ts ever silently resolved to fewer recipes than exist on disk,
    // the sweep below would go quiet and this row would fail.
    const manifest = await buildManifest();
    expect(manifest.recipes.map((r) => r.name)).toEqual(listRecipeDirs());
  });

  it("every recipe tokenDependency is an emitted custom property, or allowlisted", async () => {
    const manifest = await buildManifest();

    const missing: string[] = [];
    for (const recipe of manifest.recipes) {
      const cssFile = recipe.files.find((f) => f.endsWith(".module.css"));
      for (const dep of recipe.tokenDependencies) {
        if (ALLOWLIST.has(dep)) continue;
        if (!EMITTED.has(dep)) missing.push(`${recipe.name}: ${dep} (${cssFile})`);
      }
    }

    expect(
      missing,
      missing.length === 0
        ? undefined
        : `These recipe tokenDependencies are not declared anywhere in src/generated/theme.css: ${missing.join(
            ", ",
          )}. Either add the token to src/theme.ts (or the alias contract in soribashi.config.ts) ` +
            "and re-run `bun run codegen`, fix the recipe stylesheet to reference a real token, or " +
            "add it to ALLOWLIST in test/token-existence.test.ts with a comment explaining the " +
            "deliberate fallback.",
    ).toEqual([]);
  });
});
