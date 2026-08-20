import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getRecipeMeta, type RecipeMeta } from "@soribashi/core";
import { tuiVocabulary } from "../src/theme.ts";

/**
 * Derivation for the kit's recipe manifest. Ported from soribashi's
 * packages/ui/scripts/derive.ts, which is where the `tokenDependencies`
 * scraper the token-existence gate runs on comes from.
 *
 * Nothing here is hand-authored: every field is read off a recipe's frozen
 * `RecipeMeta` (attached by @soribashi/factory's builders), scraped from its
 * source files, or copied from the kit's own `tuiVocabulary`.
 *
 * THREE deliberate departures from the soribashi original:
 *
 *  1. RECIPE DISCOVERY WALKS `src/recipes/`, IT DOES NOT WALK A BARREL.
 *     soribashi's version imports `../src/index.ts` and keeps every export
 *     carrying RecipeMeta. This kit has no `src/index.ts` yet — the barrel
 *     arrives with the first real recipe (Icon) — so a barrel walk would make
 *     the gates unrunnable in exactly the window they were written to cover.
 *     The directory walk is also strictly harder to fool: soribashi needed a
 *     `recipes.length > 0` floor because a silently-resolving-to-empty barrel
 *     would make its sweep vacuous, whereas here the gate can assert that the
 *     manifest names EVERY directory on disk (see both gate files), which is a
 *     real assertion even at zero recipes.
 *  2. NO `baseUi` FIELD. soribashi's ManifestEntry carries
 *     `baseUi: tsxSource.includes("from '@base-ui/react")`, because its recipes
 *     may or may not wrap a Base UI primitive and its registry needs to know.
 *     This kit has no @base-ui/react dependency and is not planned to grow one
 *     (its recipes are ports of mr-board's own hand-written markup), so the
 *     field would be `false` on every entry forever. Reinstate it verbatim the
 *     day a recipe reaches for a headless primitive library.
 *  3. NO `toJsonFile`. soribashi runs the serialized manifest through the
 *     monorepo's biome binary so a generated file is byte-identical to what
 *     biome would format; the kit has no biome and commits no manifest.json,
 *     so the only consumer of this module is test/token-existence.test.ts.
 */

const SCRIPT_DIR = import.meta.dirname;
const REPO_ROOT = join(SCRIPT_DIR, "..");
const RECIPES_DIR = join(REPO_ROOT, "src", "recipes");

export interface ManifestEntry {
  name: string;
  category: 1 | 2 | 3 | 4;
  builder: string;
  slots: readonly string[];
  /** Compound part names; empty for the three single-component builders. */
  parts: readonly string[];
  vocabularyAxes: readonly string[];
  variants: readonly string[];
  defaults: Record<string, unknown>;
  /** The four recipe files (tsx, module.css, test.tsx, visual.test.tsx), repo-relative. */
  files: string[];
  /** Sorted, deduped theme CSS custom-property names the recipe's stylesheet depends on. */
  tokenDependencies: string[];
  /** Registry-item names of sibling recipes this recipe's .tsx imports (empty for most). */
  registryDependencies: string[];
}

export interface Manifest {
  vocabulary: Record<string, string[]>;
  recipes: ManifestEntry[];
}

/**
 * Theme CSS custom-property PREFIXES: everything a recipe's stylesheet may
 * depend on as a theme contract, matched as `--<prefix>` or `--<prefix>-…`.
 * Straight from soribashi's list (see @soribashi/theme's ThemeTokens and
 * codegen's emit-css.ts). A recipe's own local vars (`--sb-*`) and its
 * autoVars-derived vars (`--{lowercased recipe name}-*`, e.g. `--icon-*`)
 * never match one of these, so they fall out without a separate exclusion.
 */
const THEME_VAR_PREFIXES = [
  "color",
  "radius",
  "spacing",
  "font-size",
  "font-family",
  "font-weight",
  "line-height",
  "shadow",
  "breakpoint",
  "z-index",
  "text",
  "surface",
  "border",
  "accent",
  "heading",
] as const;

/**
 * The kit's alias contract (soribashi.config.ts's `cssVariablesResolver`), as
 * EXACT names rather than prefixes. This is the addition soribashi's list has
 * no equivalent of, and it is the reason it must not be folded into
 * THEME_VAR_PREFIXES: these short board words collide head-on with the
 * autoVars namespace. A recipe named `Card` derives `--card-bg`/`--card-color`;
 * as a *prefix*, `card` would swallow both and the gate would demand the theme
 * emit them. Matched exactly, `--card` is a theme dependency and `--card-bg` is
 * the recipe's own var, which is the truth.
 *
 * `--border`, `--border-soft` and `--accent` are already covered by the
 * `border`/`accent` prefixes above and are listed for completeness only;
 * membership in either structure has the same effect.
 */
const THEME_ALIAS_NAMES: ReadonlySet<string> = new Set([
  "--bg",
  "--panel",
  "--card",
  "--fg",
  "--muted",
  "--border",
  "--border-soft",
  "--accent",
  "--green",
  "--red",
  "--amber",
  "--purple",
  "--cyan",
  "--grid-line",
  "--dot-ok",
  "--dot-warn",
  "--dot-bad",
  "--font-mono",
  "--font-sans",
]);

const THEME_VAR_RE = new RegExp(`^--(?:${THEME_VAR_PREFIXES.join("|")})(?:-|$)`);

function isThemeVar(name: string): boolean {
  return THEME_ALIAS_NAMES.has(name) || THEME_VAR_RE.test(name);
}

/**
 * Every `var(--x)` occurrence in `css`, including ones nested in fallback
 * position (`var(--a, var(--b))`), filtered to theme-contract names, sorted and
 * deduped. A plain global regex over the whole source (rather than a
 * parenthesis-balancing parser) is sufficient: a nested fallback var() is still
 * a literal `var(--name` substring wherever it appears, so the same scan picks
 * it up as it would a top-level reference.
 */
export function extractTokenDependencies(css: string): string[] {
  const found = new Set<string>();
  const varRefRe = /var\(\s*(--[a-zA-Z0-9-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = varRefRe.exec(css)) !== null) {
    const name = match[1];
    if (name && isThemeVar(name)) {
      found.add(name);
    }
  }
  return [...found].sort();
}

/**
 * Recipe names this recipe's .tsx imports from sibling recipe directories (the
 * mandated cross-recipe form `'../<Name>/...'`), lowercased to registry-item
 * names, sorted and deduped. The uppercase first letter is what distinguishes a
 * sibling recipe directory from `'../../builders.ts'` and other relative paths.
 *
 * Double-quoted as well as single-quoted, unlike the soribashi original: that
 * repo is biome-formatted to single quotes throughout, this one is not.
 */
export function extractRecipeDependencies(tsxSource: string): string[] {
  const found = new Set<string>();
  const re = /from\s+["']\.\.\/([A-Z][A-Za-z0-9]*)\//g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tsxSource)) !== null) {
    found.add(match[1]!.toLowerCase());
  }
  return [...found].sort();
}

function toRepoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split(sep).join("/");
}

interface VocabularyLike {
  values: readonly string[];
}

function extractVocabulary(vocabulary: Record<string, VocabularyLike>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [axis, vocab] of Object.entries(vocabulary)) {
    out[axis] = [...vocab.values];
  }
  return out;
}

/**
 * Directory names under `src/recipes/`, sorted. `[]` — not a throw — when the
 * directory is absent or empty, which is the state between this task and the
 * first real recipe.
 */
export function listRecipeDirs(): string[] {
  if (!existsSync(RECIPES_DIR)) return [];
  return readdirSync(RECIPES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

const VALID_CATEGORIES = new Set([1, 2, 3, 4]);

async function buildManifestEntry(name: string): Promise<ManifestEntry> {
  const recipeDir = join(RECIPES_DIR, name);
  const tsxPath = join(recipeDir, `${name}.tsx`);
  const cssPath = join(recipeDir, `${name}.module.css`);
  const testPath = join(recipeDir, `${name}.test.tsx`);
  const visualTestPath = join(recipeDir, `${name}.visual.test.tsx`);

  const tsxSource = readFileSync(tsxPath, "utf-8");
  const cssSource = readFileSync(cssPath, "utf-8");

  // The module's own namespace: `recipeCategory` is a per-module constant that
  // no barrel re-exports, and RecipeMeta is read off whichever export the
  // builders attached it to.
  const recipeModule = (await import(pathToFileURL(tsxPath).href)) as Record<string, unknown>;

  let meta: RecipeMeta | undefined;
  for (const value of Object.values(recipeModule)) {
    const candidate = getRecipeMeta(value);
    // `Recipe.extend({})` results carry no RecipeMeta, so the named component
    // is the only export that can match; the name check pins the convention
    // that a recipe directory holds exactly one recipe, named after it.
    if (candidate && candidate.name === name) {
      meta = candidate;
      break;
    }
  }
  if (!meta) {
    throw new Error(
      `[derive] ${toRepoRelative(tsxPath)} exports no component named "${name}" carrying ` +
        "RecipeMeta. Every recipe directory must export one component, built with a builder " +
        "from src/builders.ts and named after the directory.",
    );
  }

  const category = recipeModule.recipeCategory;
  if (typeof category !== "number" || !VALID_CATEGORIES.has(category)) {
    throw new Error(
      `[derive] Recipe "${name}" (${toRepoRelative(tsxPath)}) is missing a valid ` +
        "`export const recipeCategory = <1|2|3|4> as const;`. Every recipe module must declare " +
        "its authoring category before it can be derived into the manifest.",
    );
  }

  return {
    name: meta.name,
    category: category as 1 | 2 | 3 | 4,
    builder: meta.builder,
    slots: meta.slots,
    parts: meta.parts,
    vocabularyAxes: meta.vocabularyAxes,
    variants: meta.variants,
    defaults: { ...meta.defaults },
    files: [tsxPath, cssPath, testPath, visualTestPath].map(toRepoRelative),
    tokenDependencies: extractTokenDependencies(cssSource),
    registryDependencies: extractRecipeDependencies(tsxSource),
  };
}

/**
 * One manifest entry per directory under `src/recipes/`, paired with the kit's
 * own vocabulary declaration.
 */
export async function buildManifest(): Promise<Manifest> {
  const names = listRecipeDirs();
  const recipes = await Promise.all(names.map((name) => buildManifestEntry(name)));
  recipes.sort((a, b) => a.name.localeCompare(b.name));

  return {
    vocabulary: extractVocabulary(tuiVocabulary as unknown as Record<string, VocabularyLike>),
    recipes,
  };
}
