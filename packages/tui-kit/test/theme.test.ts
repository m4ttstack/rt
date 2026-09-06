import { test, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createTheme,
  defineVocabulary,
  registerTheme,
  SoribashiProvider,
  useTheme,
} from "@soribashi/core";
import {
  defineCompound,
  defineComponent,
  defineGenericComponent,
  definePolymorphicComponent,
} from "../src/builders.ts";
import { tuiTheme } from "../src/theme.ts";
import { tuiIntentResolver } from "../src/intent-resolver.ts";

const REPO = join(import.meta.dirname, "..");
const css = readFileSync(join(REPO, "src", "generated", "theme.css"), "utf8");
const census = readFileSync(join(REPO, "docs", "token-census.md"), "utf8");

// ── census parsing ────────────────────────────────────────────────────
// The suite reads docs/token-census.md rather than restating its numbers: a
// transcription of the census can drift from the census, and then the tests
// pin the transcription instead of the board. Section (a)'s two tables are the
// authority for every colour and font value the kit claims parity on, and
// section (c)'s table for every wash.

function censusTable(heading: string, endMarker: string): Map<string, string> {
  const start = census.indexOf(heading);
  if (start === -1) throw new Error(`census section not found: ${heading}`);
  const end = census.indexOf(endMarker, start);
  const body = census.slice(start, end === -1 ? undefined : end);
  const rows = new Map<string, string>();
  for (const m of body.matchAll(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`(.+?)`\s*\|\s*$/gm)) {
    rows.set(m[1]!, m[2]!);
  }
  return rows;
}

const LIGHT = censusTable("### Light (`:root`)", "### Dark");
const DARK = censusTable("### Dark (`:root.dark`)", "## (b)");

/** Where each board variable's value lives in the theme's token tree. */
type Slot =
  | { kind: "color"; family: string; shade: string }
  | { kind: "font"; key: string };

const SLOT: Record<string, Slot> = {
  "--font-mono": { kind: "font", key: "mono" },
  "--font-sans": { kind: "font", key: "sans" },
  "--bg": { kind: "color", family: "surface", shade: "bg" },
  "--panel": { kind: "color", family: "surface", shade: "panel" },
  "--card": { kind: "color", family: "surface", shade: "card" },
  "--border": { kind: "color", family: "line", shade: "border" },
  "--border-soft": { kind: "color", family: "line", shade: "soft" },
  "--grid-line": { kind: "color", family: "line", shade: "grid" },
  "--fg": { kind: "color", family: "gray", shade: "fg" },
  "--muted": { kind: "color", family: "gray", shade: "muted" },
  "--accent": { kind: "color", family: "blue", shade: "500" },
  "--green": { kind: "color", family: "green", shade: "500" },
  "--red": { kind: "color", family: "red", shade: "500" },
  "--amber": { kind: "color", family: "amber", shade: "500" },
  "--purple": { kind: "color", family: "purple", shade: "500" },
  "--cyan": { kind: "color", family: "cyan", shade: "500" },
  "--dot-ok": { kind: "color", family: "dot", shade: "ok" },
  "--dot-warn": { kind: "color", family: "dot", shade: "warn" },
  "--dot-bad": { kind: "color", family: "dot", shade: "bad" },
};

// ── generated-CSS parsing ─────────────────────────────────────────────

/** Every `--name: value;` declaration in the file. */
function declarations(): Map<string, string> {
  const decls = new Map<string, string>();
  for (const m of css.matchAll(/^\s*(--[\w-]+):\s*(.+);\s*$/gm)) {
    decls.set(m[1]!, m[2]!);
  }
  return decls;
}

const DECLS = declarations();

/** Splits `a, b` at top level, ignoring commas nested inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/**
 * Resolves a custom property to the literal it ends at in one colour scheme,
 * walking `var()` indirection and taking the right branch of any `light-dark()`
 * on the way. This is the whole chain the board's short names ride:
 * `--bg` → `var(--surface-canvas)` → `var(--color-surface-bg)` →
 * `light-dark(#e1e2e7, #16161e)` → `#e1e2e7`.
 */
function resolve(name: string, scheme: "light" | "dark", seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`cyclic custom property: ${name}`);
  seen.add(name);

  const raw = DECLS.get(name);
  if (raw === undefined) throw new Error(`undeclared custom property: ${name}`);

  const varOnly = raw.match(/^var\((--[\w-]+)\)$/);
  if (varOnly) return resolve(varOnly[1]!, scheme, seen);

  const lightDark = raw.match(/^light-dark\((.*)\)$/);
  if (lightDark) {
    const [light, dark] = splitTopLevel(lightDark[1]!);
    const branch = (scheme === "light" ? light : dark)!;
    const nested = branch.match(/^var\((--[\w-]+)\)$/);
    return nested ? resolve(nested[1]!, scheme, seen) : branch;
  }

  return raw;
}

// ── tests ─────────────────────────────────────────────────────────────

// ── wiring ──────────────────────────────────────────────────────────────
// Folded in from the deleted src/wiring.test.ts, which existed under `bun
// test` before this repo had a vitest rig. Same purpose: @soribashi/* is
// consumed through `file:` deps plus `overrides`, a wiring that has already
// failed once in this repo (SORI-4: a nested `workspace:*` dep never linked),
// and when it fails the symptom is an import that resolves to undefined rather
// than an error. Strengthened on the way in: the four builders are now taken
// from src/builders.ts, so this also covers `makeBuilders<typeof tuiTheme>()`
// destructuring correctly, and the provider surface test/test-utils.tsx
// depends on is asserted alongside it.

test("the soribashi surface the kit is built on resolves through file:+overrides wiring", () => {
  for (const fn of [createTheme, defineVocabulary, registerTheme, useTheme]) {
    expect(typeof fn).toBe("function");
  }
  // SoribashiProvider is a component, not necessarily a plain function.
  expect(SoribashiProvider).toBeDefined();
  for (const builder of [
    defineComponent,
    definePolymorphicComponent,
    defineCompound,
    defineGenericComponent,
  ]) {
    expect(typeof builder).toBe("function");
  }
});

test("registerTheme accepts the kit's theme", () => {
  // The call test/test-utils.tsx makes at module top for every browser test.
  // Asserted here too because it is the node tier that runs on every commit,
  // and a throw from it would otherwise only surface in the browser tier.
  expect(() => registerTheme(tuiTheme)).not.toThrow();
});

test("the census tables are the shape this suite expects", () => {
  // Guards the parser itself: a census edit that breaks the table format has to
  // fail loudly here rather than silently shrink every table-driven case below.
  expect(LIGHT.size).toBe(19);
  expect(DARK.size).toBe(17);
  // The established fact the theme is built on: mr-board's dark block never
  // redeclares the font stacks, which is why they live in base tokens only.
  expect(DARK.has("--font-mono")).toBe(false);
  expect(DARK.has("--font-sans")).toBe(false);
  for (const name of [...LIGHT.keys(), ...DARK.keys()]) {
    expect(SLOT[name]).toBeDefined();
  }
});

// Font rows are excluded from the census-parity sweep below: both font slots
// are a deliberate, one-directional departure from the census (the kit leads
// its consumers on font, not the reverse). See the "fonts" block further down
// for their own coverage.
//
// `--bg`/`--panel`/`--card` are excluded from the LIGHT sweep for the same
// reason: the split-chrome ruling retuned the light surface ramp away from
// mr-board's census snapshot. Dark is untouched by the ruling, so the DARK
// sweep below still holds these three to census parity. See the "surface
// ramp" block further down for their own coverage.
const SURFACE_RAMP_RULING = new Set(["--bg", "--panel", "--card"]);
// `--fg`/`--muted` are excluded from BOTH sweeps: the value-conformance
// ruling (SORI-36) retunes `fg` to #222 in every scheme and repoints the
// `muted` TEXT role onto the AA-compliant mutedText value, so neither still
// carries its census literal through `resolve()`. See the "text conformance"
// block further down for their own coverage.
const TEXT_CONFORMANCE_RULING = new Set(["--fg", "--muted"]);
const LIGHT_COLORS = [...LIGHT].filter(
  ([name]) =>
    SLOT[name]!.kind === "color" &&
    !SURFACE_RAMP_RULING.has(name) &&
    !TEXT_CONFORMANCE_RULING.has(name),
);
const DARK_COLORS = [...DARK].filter(([name]) => !TEXT_CONFORMANCE_RULING.has(name));

test.each(LIGHT_COLORS)(
  "light %s carries the census value verbatim, in the theme and through the generated CSS",
  (name: string, value: string) => {
    const slot = SLOT[name]! as { kind: "color"; family: string; shade: string };
    const themeValue = tuiTheme.tokens.colors[slot.family]![slot.shade];
    expect(themeValue).toBe(value);
    // …and the board's short name still reaches that exact literal after
    // codegen, through the alias → semantic → token → light-dark() chain.
    expect(resolve(name, "light")).toBe(value);
  },
);

test.each(DARK_COLORS)(
  "dark %s carries the census value verbatim, in the theme and through the generated CSS",
  (name: string, value: string) => {
    const slot = SLOT[name]!;
    if (slot.kind !== "color") throw new Error(`dark ${name} should be a colour`);
    expect(tuiTheme.dark!.colors![slot.family]![slot.shade]).toBe(value);
    expect(resolve(name, "dark")).toBe(value);
  },
);

test("light and dark differ everywhere the census says they differ", () => {
  // Without this, a theme that lost its whole `dark` block would still satisfy
  // the two tables above if resolution silently fell back to the light value.
  for (const [name, darkValue] of DARK) {
    expect(resolve(name, "light")).not.toBe(darkValue);
  }
});

// ── fonts ───────────────────────────────────────────────────────────────
// A deliberate departure from census parity (see the LIGHT_COLORS filter
// above): `mono` ships vendored JetBrains Mono; `sans` carries UI/body text in
// the system sans stack (an all-monospace body was fatiguing for long prose).

const JETBRAINS_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const SYSTEM_SANS_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

test("mono is the vendored JetBrains Mono stack, sans is the system sans", () => {
  expect(tuiTheme.tokens.fontFamily!.mono).toBe(JETBRAINS_STACK);
  expect(tuiTheme.tokens.fontFamily!.sans).toBe(SYSTEM_SANS_STACK);
  expect(resolve("--font-mono", "light")).toBe(JETBRAINS_STACK);
  expect(resolve("--font-sans", "light")).toBe(SYSTEM_SANS_STACK);
});

test("the variable woff2 is declared as one @font-face spanning the whole weight axis", () => {
  // A single face, not one per weight: a static-per-weight emitter would still
  // satisfy a `toContain` on the family name while shipping four requests and
  // silently losing every weight in between.
  expect(css.match(/@font-face/g)).toHaveLength(1);
  expect(css).toContain('font-family: "JetBrains Mono";');
  expect(css).toContain("font-weight: 100 800;");
  expect(css).toContain('url("../../assets/fonts/jetbrains-mono.woff2")');
  expect(css).toContain("font-display: swap;");
});

test("--font-numeric aliases to tabular-nums", () => {
  expect(css).toContain("--font-numeric: tabular-nums;");
});

// ── surface ramp ────────────────────────────────────────────────────────
// A departure from census parity (see the LIGHT_COLORS filter above): the
// split-chrome ruling retuned the light bg/panel/card ramp to conform to
// app-kit's, and added `chrome` as a wholly new surface slot the census
// (mr-board's stylesheet at generation time) never had.

test("the light surface ramp carries the split-chrome ruling's values, ordered bg < panel < card", () => {
  expect(tuiTheme.tokens.colors.surface!.bg).toBe("#f7f8fa");
  expect(tuiTheme.tokens.colors.surface!.panel).toBe("#fbfbfc");
  expect(tuiTheme.tokens.colors.surface!.card).toBe("#ffffff");
  expect(resolve("--bg", "light")).toBe("#f7f8fa");
  expect(resolve("--panel", "light")).toBe("#fbfbfc");
  expect(resolve("--card", "light")).toBe("#ffffff");
});

test("chrome carries the ruling's value in both schemes", () => {
  expect(tuiTheme.tokens.colors.surface!.chrome).toBe("#f3f4f7");
  expect(tuiTheme.dark!.colors!.surface!.chrome).toBe("#232a47");
  expect(resolve("--chrome", "light")).toBe("#f3f4f7");
  expect(resolve("--chrome", "dark")).toBe("#232a47");
});

// ── text conformance ─────────────────────────────────────────────────────
// A departure from census parity (see the TEXT_CONFORMANCE_RULING filter
// above): SORI-36 retunes `fg` to #222 estate-wide and repoints the `muted`
// TEXT role onto the AA-compliant mutedText value, keeping the raw census
// muted hex on `colors.gray.muted` for non-text consumers (StatusDot/Badge's
// muted intent via intent-resolver.ts, washes).

test("fg carries the value-conformance ruling's #222 in light, unchanged in dark", () => {
  expect(tuiTheme.tokens.colors.gray!.fg).toBe("#222");
  expect(tuiTheme.dark!.colors!.gray!.fg).toBe("#e3e7f6");
  expect(resolve("--fg", "light")).toBe("#222");
  expect(resolve("--fg", "dark")).toBe("#e3e7f6");
});

test("muted TEXT reads the AA-compliant mutedText value; the raw census muted hex survives on colors.gray.muted", () => {
  expect(tuiTheme.tokens.colors.gray!.mutedText).toBe("#565d80");
  expect(tuiTheme.dark!.colors!.gray!.mutedText).toBe("#969ec2");
  expect(resolve("--muted", "light")).toBe("#565d80");
  expect(resolve("--muted", "dark")).toBe("#969ec2");
  expect(tuiTheme.tokens.colors.gray!.muted).toBe("#8990b3");
  expect(tuiTheme.dark!.colors!.gray!.muted).toBe("#7e86ad");
});

test("accentText and badText resolve to their AA-compliant literals in both schemes", () => {
  expect(tuiTheme.tokens.colors.gray!.accentText).toBe("#1c5fbf");
  expect(tuiTheme.dark!.colors!.gray!.accentText).toBe("#7aa2f7");
  expect(resolve("--accent-text", "light")).toBe("#1c5fbf");
  expect(resolve("--accent-text", "dark")).toBe("#7aa2f7");

  expect(tuiTheme.tokens.colors.gray!.redText).toBe("#c8214f");
  expect(tuiTheme.dark!.colors!.gray!.redText).toBe("#f7768e");
  expect(resolve("--red-text", "light")).toBe("#c8214f");
  expect(resolve("--red-text", "dark")).toBe("#f7768e");
});

// Bun's CSS bundler inlines a `url()`-referenced asset under this file's
// bundled CSS as a base64 data URI (verified empirically: the observed cutoff
// sits between 120KB and 150KB); past it, the asset is copied out to a
// separate, content-hashed file instead and the CSS `url()` is rewritten to
// point at it. Neither consumer build (mr-board's src/server.ts,
// local-apps/scripts/build-board.ts) collects or serves any output besides
// the JS entry-point and the one CSS asset chunk, so a woff2 that crossed
// that line would silently 404 in a consumer app rather than fail here. 100KB
// is comfortably under the observed cutoff, with headroom for a future
// weight or subset swap.
test("the vendored woff2 stays under Bun's CSS asset-inlining threshold", () => {
  const INLINE_SAFE_BOUND_BYTES = 100 * 1024;
  const path = join(REPO, "assets", "fonts", "jetbrains-mono.woff2");
  const { size } = statSync(path);
  expect(size, `${path} is ${size} bytes`).toBeLessThan(INLINE_SAFE_BOUND_BYTES);
});

test("generated css exposes the alias contract with verbatim values reachable", () => {
  for (const alias of ["--bg:", "--panel:", "--card:", "--chrome:", "--fg:", "--muted:", "--muted-text:", "--accent-text:", "--red-text:", "--border:", "--border-soft:", "--accent:", "--green:", "--red:", "--amber:", "--purple:", "--cyan:", "--grid-line:", "--dot-ok:", "--dot-warn:", "--dot-bad:", "--font-mono:", "--font-sans:", "--font-numeric:"]) {
    expect(css).toContain(alias);
  }
  expect(css).toContain("#2e7de9"); // light accent, verbatim
  expect(css).toContain("#7aa2f7"); // dark accent, verbatim
  expect(css).toContain("#232a47"); // dark panel (the 2026-08-19 tuning), verbatim
  expect(css).toContain(".dark");   // darkMode selector
});

test("every var() reference in the generated css resolves to a declared property", () => {
  // Referential closure. The kit's wash tokens reference alias names that exist
  // only because soribashi.config.ts injects them, and the aliases in turn
  // reference semantic names the theme emits — three layers, any one of which a
  // rename can break. The property pinned is "nothing dangles", not a count.
  const referenced = new Set<string>();
  for (const m of css.matchAll(/var\((--[\w-]+)/g)) referenced.add(m[1]!);

  const unresolved = [...referenced].filter((name) => !DECLS.has(name));
  expect(unresolved).toEqual([]);
  // Sanity floor: a regex that stopped matching would make the check vacuous.
  expect(referenced.size).toBeGreaterThan(30);
  expect(DECLS.size).toBeGreaterThan(100);
});

test("intent resolver maps intent words onto the single-shade families", () => {
  expect(tuiIntentResolver({ intent: "ok", variant: "outline", theme: tuiTheme }).color).toContain(
    "--color-green-500",
  );
  expect(tuiIntentResolver({ intent: "muted", variant: "subtle", theme: tuiTheme }).color).toContain(
    "--color-gray-muted",
  );
  // `light`'s hover mixes the tone over `--surface-card` — singleShadeVariantColors'
  // own formula (Button.parity.test.tsx is the oracle that pins this exactly).
  expect(tuiIntentResolver({ intent: "accent", variant: "light", theme: tuiTheme }).hover).toBe(
    "color-mix(in srgb, var(--color-blue-500) 12%, var(--surface-card))",
  );
});

test("every wash expression from the census is emitted, verbatim", () => {
  // Section (c)'s 16 distinct color-mix() expressions, read from the census
  // rather than restated, same as the colour tables above.
  const washes = [...census.matchAll(/^\|\s*`(color-mix\(in srgb,.+?\))`\s*\|/gm)].map((m) => m[1]!);
  expect(washes.length).toBe(16);
  for (const wash of washes) expect(css).toContain(wash);
});

test("dark block flips color-scheme and carries no font redeclarations", () => {
  expect(css).toContain("color-scheme: light;");
  expect(css).toContain("color-scheme: dark;");
  // In soribashi every token carries both schemes via light-dark(), so the
  // dark block holds nothing but the color-scheme flip.
  const darkBlock = css.slice(css.indexOf(".dark {"));
  expect(darkBlock.slice(0, darkBlock.indexOf("}"))).not.toContain("--font-family-");
});

// ── canvas.css ──────────────────────────────────────────────────────────
// The optional graph-paper page ground (Task 4). Unlike theme.css this is
// hand-authored, not generated: it is a straight port of mr-board's
// body + `*` + .tui + .tui-wide rules with tokens swapped in for literals.
// Importing it is the opt-in — it styles `body` directly.

const CANVAS_PATH = join(REPO, "src", "canvas.css");

// The alias contract canvas.css is allowed to lean on — the same board short
// names the generated theme resolves, per the task-4 brief.
const CANVAS_ALIAS_CONTRACT = new Set([
  "--bg", "--panel", "--card", "--fg", "--muted", "--border", "--border-soft",
  "--accent", "--green", "--red", "--amber", "--purple", "--cyan",
  "--grid-line", "--dot-ok", "--dot-warn", "--dot-bad", "--font-mono", "--font-sans",
]);

test("canvas.css exists and defines the body ground, .tui, and .tui-wide", () => {
  const canvas = readFileSync(CANVAS_PATH, "utf8");
  expect(canvas).toContain("body {");
  expect(canvas).toContain(".tui {");
  expect(canvas).toContain(".tui-wide {");
  // The graph-paper grid: two crossed linear-gradients painted as the
  // background-image, sized to a fixed grid cell.
  expect(canvas).toContain("background-image:");
  expect(canvas).toMatch(/background-size:\s*28px 28px;/);
});

test("canvas.css references only var(--...) names from the alias contract", () => {
  const canvas = readFileSync(CANVAS_PATH, "utf8");
  const referenced = new Set<string>();
  for (const m of canvas.matchAll(/var\((--[\w-]+)\)/g)) referenced.add(m[1]!);
  expect(referenced.size).toBeGreaterThan(0);
  for (const name of referenced) {
    expect(CANVAS_ALIAS_CONTRACT.has(name)).toBe(true);
  }
});

test("canvas.css contains no hex or rgba color literals", () => {
  const canvas = readFileSync(CANVAS_PATH, "utf8");
  // Every color must ride the alias contract's var()s, not a literal —
  // canvas.css has no theme of its own to draw from.
  expect(canvas).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(canvas).not.toMatch(/\brgba?\(/);
});

test("canvas.css's 13.5px base and 28px grid are census-pinned canvas-identity constants", () => {
  // These two literals are allowlisted deliberately: the census (docs/
  // token-census.md) shows both are single-use in mr-board's style.css, so
  // they never became theme tokens. They're canvas identity, not a themeable
  // value — pin them here (and require they read as intentional, i.e.
  // commented) rather than let them silently drift.
  const canvas = readFileSync(CANVAS_PATH, "utf8");
  expect(canvas).toContain("13.5px");
  expect(canvas).toContain("28px 28px");
  expect(canvas.toLowerCase()).toContain("canvas-identity");
});
