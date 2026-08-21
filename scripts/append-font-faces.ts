import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Appends the kit's `@font-face` declarations to the codegen output.
 *
 * `soribashi build` fully OVERWRITES src/generated/theme.css from theme.ts's
 * tokens alone -- it has no concept of font assets (ThemeTokens.fontFamily is
 * just name strings). Font URLs live here instead, and this script runs as
 * the second half of the `codegen` script so `bun run codegen` stays a single
 * reproducible command: `bun run gates`'s `git diff --exit-code` on the
 * generated file depends on that, same as every token it emits.
 *
 * Paths are relative to THIS FILE'S DESTINATION (src/generated/theme.css),
 * not to this script. Bun's bundler realpaths a kit file before resolving its
 * own relative references (see mr-board's src/server.ts reactSingleton
 * comment), so a plain relative path here reaches tui-kit/assets/fonts/
 * straight through the file: dependency symlink tree, no mirroring required.
 * Woff2 files this small (~8KB) also fall under Bun's CSS asset inlining
 * threshold, so a consumer's bundle embeds them as base64 data URIs directly
 * in the CSS chunk -- no separate font file for a consumer's server to serve.
 */
const REPO_ROOT = join(import.meta.dirname, "..");
const THEME_CSS = join(REPO_ROOT, "src", "generated", "theme.css");

const WEIGHTS = [400, 500, 600, 700] as const;

const fontFaces = WEIGHTS.map(
  (weight) => `@font-face {
  font-family: "Tomorrow";
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url("../../assets/fonts/tomorrow-${weight}.woff2") format("woff2");
}`,
).join("\n\n");

const generated = readFileSync(THEME_CSS, "utf8");
writeFileSync(THEME_CSS, `${generated.trimEnd()}\n\n${fontFaces}\n`);
