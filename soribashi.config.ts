import type { CssVariablesResolver } from "@soribashi/codegen";
import { tuiTheme } from "./src/theme.ts";

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
  },
});

export default {
  theme: tuiTheme,
  output: { css: "src/generated/theme.css" },
  watch: ["src/theme.ts", "src/intent-resolver.ts"],
  emit: { cssVariablesResolver: aliases },
};
