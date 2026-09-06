import type { CssVariablesResolver } from "@soribashi/core/codegen";
import { tuiTheme, TUI_DARK_COLORS } from "./src/theme.ts";

/**
 * The public alias contract.
 *
 * mr-board's stylesheet reaches for these short names ~234 times
 * (docs/token-census.md section (d)), and gitq is to get the same words. They
 * are the kit's stable, board-domain surface: `--bg`, `--fg`, `--accent`, not
 * `--surface-canvas`, `--text-primary`, `--color-blue-500`. Keeping them means
 * the adoption in mr-board is a stylesheet swap, not a 234-site rewrite.
 *
 * Every right-hand side below was read off the REAL generated file, not
 * predicted: `--surface-*` for surfaces, `--text-*` for text, `--border-*` for
 * borders, `--color-{family}-{shade}` for raw families, `--font-family-*` for
 * fonts (see emit-css.ts's emitTokenLines / emitSemanticLines).
 *
 * Emitted into `:root` only. Every underlying token already carries both
 * schemes through light-dark(), so an alias resolves per scheme without being
 * restated in the `.dark` block — which is exactly why mr-board's own dark
 * block never needed the font stacks either.
 *
 * DO NOT RENAME OR REMOVE THESE ALIASES. They are not a convenience layer over
 * the "real" names — the theme itself depends on them. All 16 wash tokens in
 * src/theme.ts (`--surface-wash-*`) are raw `color-mix()` strings that mix
 * `var(--panel)`, `var(--accent)`, `var(--fg)`, `var(--bg)`, `var(--cyan)`,
 * `var(--amber)` and `var(--border)` BY NAME, and those seven properties exist
 * only because this resolver injects them. Drop or rename one and every wash
 * mixing it resolves to nothing: invalid CSS, emitted silently, with no codegen
 * error — a raw string is passed through unvalidated by design (validateRef
 * skips anything that is not a dotted token path). test/theme.test.ts's
 * referential-closure test is the guard: it fails the moment a `var()` in the
 * generated file has no matching declaration.
 *
 * NOTE the two deliberate absences: `--border-soft` and (for the same reason)
 * anything else whose alias name would collide with an emitted semantic name.
 * The semantic key `border.soft` already emits precisely `--border-soft`;
 * resolver additions are appended LATER in the same block, so re-declaring it
 * here as `var(--border-soft)` would overwrite the real declaration with a
 * self-reference and resolve to nothing.
 */
const aliases: CssVariablesResolver = () => ({
  root: {
    "--bg": "var(--surface-canvas)",
    "--panel": "var(--surface-panel)",
    "--card": "var(--surface-card)",
    "--chrome": "var(--surface-chrome)",
    "--fg": "var(--text-primary)",
    "--muted": "var(--text-muted)",
    "--border": "var(--border-default)",
    "--accent": "var(--color-blue-500)",
    "--green": "var(--color-green-500)",
    "--red": "var(--color-red-500)",
    "--amber": "var(--color-amber-500)",
    "--purple": "var(--color-purple-500)",
    "--cyan": "var(--color-cyan-500)",
    "--grid-line": "var(--color-line-grid)",
    "--dot-ok": "var(--color-dot-ok)",
    "--dot-warn": "var(--color-dot-warn)",
    "--dot-bad": "var(--color-dot-bad)",
    "--font-mono": "var(--font-family-mono)",
    "--font-sans": "var(--font-family-sans)",
    // A literal, not a `var()` indirection: `font-variant-numeric` has no
    // theme token category to alias (ThemeTokens has no such family), and
    // "tabular-nums" is the whole value space this ever needs.
    "--font-numeric": "tabular-nums",
    // Scheme-INVARIANT terminal surface, aliased straight off the night
    // palette object (not through --surface-*/--text-*): every
    // scheme-varying token collapses its light-dark() once at :root, so a
    // var() chain can never pin a leaf element dark while the page is in
    // day scheme. Terminal/log boxes stay night-dark in both schemes.
    "--terminal-bg": TUI_DARK_COLORS.surface.bg,
    "--terminal-fg": TUI_DARK_COLORS.gray.fg,
    "--terminal-border": TUI_DARK_COLORS.line.border,
  },
});

export default {
  theme: tuiTheme,
  output: { css: "src/generated/theme.css" },
  watch: ["src/theme.ts", "src/intent-resolver.ts"],
  // `utilities: false` drops the `soribashi.utilities` layer -- the
  // `.sb-hidden-from-*` / `.sb-visible-from-*` / `.sb-light-hidden` /
  // `.sb-dark-hidden` visibility classes. Nothing in this kit emits or
  // documents those class names (`grep -r "sb-hidden\|sb-visible\|sb-light-hidden\|sb-dark-hidden" src`
  // is empty), so shipping them only added inert rules to every adopter's
  // stylesheet.
  //
  // They were not merely unused, they were harmful: mr-board's screenshot
  // harness caught a 111-pixel regression in two captures traced to this layer
  // (controller ruling R15). The rules match no element in that app, but their
  // bulk tips Chromium's re-rasterisation during Playwright's `fullPage`
  // screenshot path, which snaps the anti-alias fringe off a
  // `text-decoration: underline dotted` rule. Verified by bisect: removing
  // this layer -- and nothing else -- restores byte-identical pixels.
  //
  // The `@layer soribashi.tokens, soribashi.recipes, soribashi.utilities;`
  // ordering statement is still emitted unconditionally (emit-layer.ts), so
  // the layer name keeps its slot in the cascade order and a consumer that
  // writes its own `@layer soribashi.utilities { ... }` still lands where the
  // kit intends. Declaring a layer with no rules in it costs nothing.
  emit: { cssVariablesResolver: aliases, utilities: false },
};
