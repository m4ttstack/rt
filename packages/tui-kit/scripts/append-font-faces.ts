import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Appends the kit's `@font-face` declaration to the codegen output.
 *
 * `soribashi build` fully OVERWRITES src/generated/theme.css from theme.ts's
 * tokens alone -- it has no concept of font assets. Font URLs live here
 * instead, and this script runs as the second half of the `codegen` script so
 * `bun run codegen` stays a single reproducible command: `bun run gates`'s
 * `git diff --exit-code` on the generated file depends on that, same as every
 * token it emits.
 *
 * Paths are relative to THIS FILE'S DESTINATION (src/generated/theme.css),
 * not to this script. Bun's bundler realpaths a kit file before resolving its
 * own relative references (see mr-board's src/server.ts reactSingleton
 * comment), so a plain relative path here reaches tui-kit/assets/fonts/
 * straight through the file: dependency symlink tree, no mirroring required.
 */
const REPO_ROOT = join(import.meta.dirname, "..");
const THEME_CSS = join(REPO_ROOT, "src", "generated", "theme.css");


/**
 * One face, not one per weight: JetBrains Mono ships as a variable font, so a
 * single woff2 carries the whole 100-800 axis and the browser interpolates
 * every weight the kit asks for from it.
 */
const fontFaces = `@font-face {
  font-family: "JetBrains Mono";
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: url("../../assets/fonts/jetbrains-mono.woff2") format("woff2");
}`;

const generated = readFileSync(THEME_CSS, "utf8");
writeFileSync(THEME_CSS, `${generated.trimEnd()}\n\n${fontFaces}\n`);
