import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listRecipeDirs } from "../scripts/derive.ts";

/**
 * Tier 1 conformance gate, ported verbatim from soribashi's
 * packages/ui/test/no-hardcoded-values.test.ts: every recipe's `.module.css`
 * must be fully re-skinnable through the theme alone, which this scanner
 * enforces mechanically by flagging any colour or length value that did not
 * come from a `var(...)` reference. The scanner lives in this file (no separate
 * module) because it has no other consumer; the real-file sweep at the bottom
 * is what actually gates the recipes.
 *
 * Rules:
 *   1. The first non-comment statement must be `@layer soribashi.recipes {`.
 *   2. Comments, then every `var(...)` expression INCLUDING its fallback, are
 *      stripped before scanning (a fallback is theme-reachable by definition:
 *      the var wins whenever it's defined).
 *   3. Any remaining colour literal is flagged: hex, the listed colour
 *      functions, and named colours outside the allowlist.
 *   4. Any remaining length literal is flagged, outside the allowlist.
 *      Unitless numbers and time values (ms/s) pass untouched.
 *
 * The two allowlists below are soribashi's, unchanged. Extensions happen
 * per-recipe, with a comment saying why — never by widening them casually.
 */

interface Violation {
  path: string;
  line: number;
  token: string;
  kind: "layer" | "color" | "length";
}

// The CSS Color Module Level 4 / SVG1.1 extended keyword set, plus the three
// non-colour keywords allowlisted alongside them (transparent, currentColor,
// inherit). Matched case-insensitively, then filtered through
// ALLOWED_NAMED_COLOR_KEYWORDS below, so those three flow through the same
// detect-then-allow path as every other name rather than being invisible to
// the scanner.
const NAMED_COLOR_KEYWORDS = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "grey",
  "green",
  "greenyellow",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
  "transparent",
  "currentcolor",
  "inherit",
  // Sorted longest-first so overlapping names (e.g. "white" inside
  // "whitesmoke") don't get matched by the shorter alternative first.
].sort((a, b) => b.length - a.length);

// `white` is deliberately NOT in this allowlist: a recipe should reach a
// surface-*/text-* token or the board's own alias instead of the raw literal,
// even though white is an extremely common "looks safe" value. Documented here,
// not just in the brief, so the decision travels with the constant.
const ALLOWED_NAMED_COLOR_KEYWORDS = new Set(["transparent", "currentcolor", "inherit"]);

const ALLOWED_LENGTH_LITERALS = new Set(["0", "1px", "2px", "100%"]);

const HEX_COLOR = /#[0-9a-f]{3,8}\b/gi;
const FUNCTIONAL_COLOR = /\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(/gi;
const NAMED_COLOR = new RegExp(`(${NAMED_COLOR_KEYWORDS.join("|")})`, "gi");
const LENGTH_LITERAL = /\d*\.?\d+(px|rem|em|vh|vw|vmin|vmax|ch|ex|%)/g;

/** True if `text[index]` would extend an identifier (letter/digit/_/-). */
function isIdentChar(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return false;
  return /[A-Za-z0-9_-]/.test(text[index] as string);
}

/** 1-based line number of `index` within `text`. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Replaces every comment with equal-length whitespace (newlines preserved) so
 * downstream regexes see clean text while line numbers stay accurate.
 */
function stripCommentsPreservingLines(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Replaces every `var(...)` expression, including its fallback, with
 * equal-length whitespace (newlines preserved). A plain regex like
 * `/var\([^)]*\)/` truncates at the FIRST `)`, which is wrong the moment a
 * fallback itself contains a nested `var(...)` (e.g. `var(--a, var(--b, 1rem))`):
 * a paren-counting scan is required to find the expression's real closing paren.
 */
function stripVarExpressionsPreservingLines(css: string): string {
  let result = "";
  let i = 0;
  for (;;) {
    const start = css.indexOf("var(", i);
    if (start === -1) {
      result += css.slice(i);
      break;
    }
    result += css.slice(i, start);
    let depth = 0;
    let j = start + 3; // index of the opening '(' in "var("
    for (; j < css.length; j++) {
      if (css[j] === "(") depth++;
      else if (css[j] === ")") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    result += css.slice(start, j).replace(/[^\n]/g, " ");
    i = j;
  }
  return result;
}

/** True if the first non-comment, non-whitespace statement opens the layer. */
function opensWithRecipesLayer(source: string): boolean {
  let rest = source;
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end === -1) {
        rest = "";
        break;
      }
      rest = trimmed.slice(end + 2);
      continue;
    }
    rest = trimmed;
    break;
  }
  return /^@layer\s+soribashi\.recipes\s*\{/.test(rest);
}

function scanCssModule(source: string, path: string): Violation[] {
  const violations: Violation[] = [];

  if (!opensWithRecipesLayer(source)) {
    const snippet = stripCommentsPreservingLines(source).trim().slice(0, 60);
    violations.push({ path, line: 1, token: snippet, kind: "layer" });
  }

  const scanned = stripVarExpressionsPreservingLines(stripCommentsPreservingLines(source));

  const raw: Array<{ index: number; token: string; kind: "color" | "length" }> = [];

  for (const m of scanned.matchAll(HEX_COLOR)) {
    raw.push({ index: m.index, token: m[0], kind: "color" });
  }
  for (const m of scanned.matchAll(FUNCTIONAL_COLOR)) {
    raw.push({ index: m.index, token: `${m[1]}(`, kind: "color" });
  }
  for (const m of scanned.matchAll(NAMED_COLOR)) {
    const before = m.index - 1;
    const after = m.index + m[0].length;
    if (isIdentChar(scanned, before) || isIdentChar(scanned, after)) continue;
    if (ALLOWED_NAMED_COLOR_KEYWORDS.has(m[0].toLowerCase())) continue;
    raw.push({ index: m.index, token: m[0], kind: "color" });
  }
  for (const m of scanned.matchAll(LENGTH_LITERAL)) {
    if (ALLOWED_LENGTH_LITERALS.has(m[0])) continue;
    raw.push({ index: m.index, token: m[0], kind: "length" });
  }

  raw.sort((a, b) => a.index - b.index);
  for (const r of raw) {
    violations.push({ path, line: lineOf(scanned, r.index), token: r.token, kind: r.kind });
  }

  return violations;
}

function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return "";
  return violations
    .map((v) => `${v.path}:${v.line}: hardcoded ${v.kind} literal "${v.token}"`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Part 1: the scanner itself, against inline CSS fixture strings. These rows
// are what keep this file honest while src/recipes/ is still filling up: they
// run and mean something at zero recipes.
// ---------------------------------------------------------------------------

describe("scanCssModule", () => {
  it("flags a file whose first statement is not the soribashi.recipes layer", () => {
    const violations = scanCssModule(".root { color: red; }", "fixture.module.css");
    expect(violations.some((v) => v.kind === "layer")).toBe(true);
  });

  it("passes a well-formed layer wrapper with only var()-backed declarations", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    color: var(--fg);",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("strips comments before scanning, including a commented-out violation", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  /* background: #fff; */",
      "  .root { color: var(--fg); }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("tolerates a leading comment before the layer statement", () => {
    const css = [
      "/* recipe stylesheet */",
      "@layer soribashi.recipes {",
      "  .root { color: var(--fg); }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css").some((v) => v.kind === "layer")).toBe(false);
  });

  it("flags a hex colour literal, reporting path/line/token", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    background: #ffffff;",
      "  }",
      "}",
      "",
    ].join("\n");
    const violations = scanCssModule(css, "fixture.module.css");
    expect(violations).toEqual([
      { path: "fixture.module.css", line: 3, token: "#ffffff", kind: "color" },
    ]);
  });

  it("flags every listed colour function: rgb/rgba/hsl/hsla/oklch/oklab/lab/lch/color()", () => {
    // Numeric args deliberately carry no units (no `%`/`px`/...) so this
    // fixture pins rule 3 in isolation, without also tripping rule 4.
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    a: rgb(0 0 0);",
      "    b: rgba(0 0 0 / 1);",
      "    c: hsl(0 0 0);",
      "    d: hsla(0 0 0 / 1);",
      "    e: oklch(0.5 0.1 200);",
      "    f: oklab(0.5 0.1 0.1);",
      "    g: lab(50 0 0);",
      "    h: lch(50 0 0);",
      "    i: color(display-p3 1 0 0);",
      "  }",
      "}",
      "",
    ].join("\n");
    const violations = scanCssModule(css, "fixture.module.css");
    expect(violations).toHaveLength(9);
    expect(violations.map((v) => v.token)).toEqual([
      "rgb(",
      "rgba(",
      "hsl(",
      "hsla(",
      "oklch(",
      "oklab(",
      "lab(",
      "lch(",
      "color(",
    ]);
    expect(violations.every((v) => v.kind === "color")).toBe(true);
  });

  it("flags a named colour outside the allowlist, including white", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    color: red;",
      "    background: white;",
      "  }",
      "}",
      "",
    ].join("\n");
    const violations = scanCssModule(css, "fixture.module.css");
    expect(violations.map((v) => v.token)).toEqual(["red", "white"]);
  });

  it('does not flag "white-space: nowrap" as the named colour "white"', () => {
    // Regression guard for a naive \b-only match: a hyphen is a non-word
    // character, so `\bwhite\b` alone would incorrectly match the "white" in
    // the property name "white-space".
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    white-space: nowrap;",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("does not flag the allowlisted keywords: transparent, currentColor, currentcolor, inherit", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    a: transparent;",
      "    b: currentColor;",
      "    c: currentcolor;",
      "    d: inherit;",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("flags a length literal outside the allowlist, reporting path/line/token", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    padding: 8px;",
      "  }",
      "}",
      "",
    ].join("\n");
    const violations = scanCssModule(css, "fixture.module.css");
    expect(violations).toEqual([
      { path: "fixture.module.css", line: 3, token: "8px", kind: "length" },
    ]);
  });

  it("does not flag the allowlisted length literals: 0, 1px, 2px, 100%", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    a: 1px;",
      "    b: 2px;",
      "    c: 100%;",
      "    d: 0;",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("does not flag unitless numbers or time values (ms/s)", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    opacity: 0.5;",
      "    line-height: 1.4;",
      "    transition: color 150ms, background 1s;",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("does not flag a colour/length literal that only appears inside a var() fallback", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    background: var(--probe-bg, #ffffff);",
      "    padding: var(--spacing-md, 12px);",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("correctly strips a nested var() fallback via paren-counting, not a truncating regex", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    width: var(--a, var(--b, 1rem));",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("does not leak trailing fallback content past a nested var() close paren", () => {
    // A regex that truncates at the first `)` (e.g. `/var\([^)]*\)/`) would
    // stop at the INNER var's close paren here, leaving " 2px solid red)"
    // unstripped in the scanned text and falsely flagging "red" even though it
    // is only reachable via the fallback.
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    border: var(--a, var(--b, 1rem) 2px solid red);",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(scanCssModule(css, "fixture.module.css")).toEqual([]);
  });

  it("still flags a genuine violation alongside a correctly stripped nested var()", () => {
    const css = [
      "@layer soribashi.recipes {",
      "  .root {",
      "    background: var(--a, var(--b, 1rem));",
      "    border-color: #fff;",
      "  }",
      "}",
      "",
    ].join("\n");
    const violations = scanCssModule(css, "fixture.module.css");
    expect(violations).toEqual([
      { path: "fixture.module.css", line: 4, token: "#fff", kind: "color" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Part 2: run the scanner over every real recipe stylesheet. Walks the
// directory rather than listing files by name, so a future recipe's CSS is
// automatically covered the moment it lands under src/recipes/.
// ---------------------------------------------------------------------------

const RECIPES_DIR = join(import.meta.dirname, "..", "src", "recipes");

function findModuleCssFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findModuleCssFiles(full));
    } else if (entry.endsWith(".module.css")) {
      out.push(full);
    }
  }
  return out;
}

describe("no hardcoded values: real recipe stylesheets", () => {
  const files = findModuleCssFiles(RECIPES_DIR).sort((a, b) => a.localeCompare(b));

  /**
   * soribashi's floor here is `files.length > 0`, which cannot hold in this
   * kit: the gate is committed before the first recipe exists (Icon lands
   * next), and a floor that has to be disabled for a while is a floor nobody
   * re-enables. The replacement is strictly stronger AND true at zero — it
   * pins the sweep to the directory listing, so a recipe folder whose
   * stylesheet is missing, misnamed, or in a subfolder the walker doesn't
   * reach fails here rather than being silently skipped.
   */
  it("sweeps exactly one stylesheet per recipe directory", () => {
    expect(files.map((f) => relative(RECIPES_DIR, f).split(/[\\/]/).join("/"))).toEqual(
      listRecipeDirs().map((name) => `${name}/${name}.module.css`),
    );
  });

  it.each(files.map((f) => [relative(RECIPES_DIR, f), f] as const))(
    "%s has no hardcoded colour/length values outside the allowlist",
    (_label, file) => {
      const source = readFileSync(file, "utf8");
      const violations = scanCssModule(source, relative(RECIPES_DIR, file));
      expect(violations, formatViolations(violations)).toEqual([]);
    },
  );
});
