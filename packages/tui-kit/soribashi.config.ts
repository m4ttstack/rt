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
    // `--muted` is the FILL half of tokyo's fill/text split: raw
    // `--color-gray-muted`, not the AA-darkened text chain. Washes, dots and
    // the Switch thumb read this one; text roles read `--muted-text` below.
    "--muted": "var(--color-gray-muted)",
    // emitSemanticLines always prefixes a semanticTokens.text key with
    // `--text-`, so these three (mirroring tokyo's --tk-muted-text /
    // --tk-accent-text / --tk-red-text) cannot be produced as semantic vars
    // and are aliased here instead, the same way --chrome is.
    "--muted-text": "var(--text-muted)",
    "--accent-text": "var(--text-accentText)",
    "--red-text": "var(--text-badText)",
    "--border": "var(--border-default)",
    "--page": "var(--surface-canvas)",
    "--raised": "var(--surface-raised)",
    "--surface-1": "var(--color-ground-1)",
    "--surface-2": "var(--color-ground-2)",
    "--surface-3": "var(--color-ground-3)",
    "--surface-4": "var(--color-ground-4)",
    "--text-1": "var(--color-ink-1)",
    "--text-2": "var(--color-ink-2)",
    "--text-3": "var(--color-ink-3)",
    "--text-4": "var(--color-ink-4)",
    "--line-1": "var(--color-rule-1)",
    "--line-2": "var(--color-rule-2)",
    "--line-3": "var(--color-rule-3)",
    "--fill-accent": "var(--color-blue-500)",
    "--fill-accent-hover": "var(--color-blue-hover)",
    "--fill-ok": "var(--color-green-500)",
    "--fill-ok-hover": "var(--color-green-hover)",
    "--fill-bad": "var(--color-red-500)",
    "--fill-bad-hover": "var(--color-red-hover)",
    "--fill-warn": "var(--color-amber-500)",
    "--fill-warn-hover": "var(--color-amber-hover)",
    "--fill-purple": "var(--color-purple-500)",
    "--fill-purple-hover": "var(--color-purple-hover)",
    "--fill-cyan": "var(--color-cyan-500)",
    "--fill-cyan-hover": "var(--color-cyan-hover)",
    "--fill-gold": "var(--color-gold-500)",
    "--fill-gold-hover": "var(--color-gold-hover)",
    "--on-fill-accent": "var(--color-blue-onFill)",
    "--on-fill-ok": "var(--color-green-onFill)",
    "--on-fill-bad": "var(--color-red-onFill)",
    "--on-fill-warn": "var(--color-amber-onFill)",
    "--on-fill-purple": "var(--color-purple-onFill)",
    "--on-fill-cyan": "var(--color-cyan-onFill)",
    "--on-fill-gold": "var(--color-gold-onFill)",
    "--text-accent": "var(--color-blue-text)",
    "--text-accent-small": "var(--color-blue-textSmall)",
    "--text-accent-vivid": "var(--color-blue-textVivid)",
    "--text-ok": "var(--color-green-text)",
    "--text-ok-small": "var(--color-green-textSmall)",
    "--text-ok-vivid": "var(--color-green-textVivid)",
    "--text-bad": "var(--color-red-text)",
    "--text-bad-small": "var(--color-red-textSmall)",
    "--text-bad-vivid": "var(--color-red-textVivid)",
    "--text-warn": "var(--color-amber-text)",
    "--text-warn-small": "var(--color-amber-textSmall)",
    "--text-warn-vivid": "var(--color-amber-textVivid)",
    "--text-purple": "var(--color-purple-text)",
    "--text-purple-small": "var(--color-purple-textSmall)",
    "--text-purple-vivid": "var(--color-purple-textVivid)",
    "--text-cyan": "var(--color-cyan-text)",
    "--text-cyan-small": "var(--color-cyan-textSmall)",
    "--text-cyan-vivid": "var(--color-cyan-textVivid)",
    "--text-gold": "var(--color-gold-text)",
    "--text-gold-small": "var(--color-gold-textSmall)",
    "--text-gold-vivid": "var(--color-gold-textVivid)",
    "--accent": "var(--color-blue-500)",
    "--green": "var(--color-green-500)",
    "--red": "var(--color-red-500)",
    "--amber": "var(--color-amber-500)",
    "--purple": "var(--color-purple-500)",
    "--cyan": "var(--color-cyan-500)",
    "--gold": "var(--color-gold-500)",
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
    // Type roles: the six-size ladder the decision-queue surfaces read
    // (display > title > body > meta > small > micro). Aliases, not new
    // sizes: each points at the canonical fontSize rung.
    "--type-display": "var(--font-size-rem100)",
    "--type-title": "var(--font-size-rem90)",
    "--type-body": "var(--font-size-lg)",
    "--type-meta": "var(--font-size-rem78)",
    "--type-small": "var(--font-size-sm)",
    "--type-micro": "var(--font-size-rem62)",
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
