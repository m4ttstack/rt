#!/usr/bin/env bun
/**
 * Rewrites relative `.ts` / `.tsx` module specifiers to `.js`, and drops
 * stylesheet side-effect imports, inside emitted `.d.ts` files.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repo's source imports carry explicit `.ts`/`.tsx` extensions
 * (`allowImportingTsExtensions`), and tsconfig.build.json sets
 * `rewriteRelativeImportExtensions: true` so the emitted JavaScript points at
 * the emitted `.js` files. As of TypeScript 7.0.2 that rewrite is applied to
 * the JavaScript emit ONLY — declaration (`.d.ts`) emit still carries the
 * original `.ts`/`.tsx` specifiers through verbatim.
 *
 * Shipping those unrewritten specifiers breaks every consumer: a `.ts`
 * extension in an import is an error (TS5097) unless the *consumer* enables
 * `allowImportingTsExtensions`, and the referenced `.ts` file does not exist in
 * `dist/` anyway. That is precisely the "consumers must deal with our source"
 * failure mode that publishing built artifacts is meant to end, so the fix runs
 * as a mandatory step of every package build rather than as an optional tidy-up.
 *
 * After rewriting, the script re-scans and exits non-zero if any relative
 * `.ts`/`.tsx` specifier survived, so a regression fails the build instead of
 * reaching a tarball.
 *
 * Vendored from soribashi/scripts/fix-dts-extensions.ts: tui-kit is not part
 * of that monorepo, so this copy is self-contained rather than referenced
 * across repos. Delete once TypeScript applies
 * `rewriteRelativeImportExtensions` to declaration emit.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Matches the module specifier of a relative import/export whose path ends in
 * `.ts` or `.tsx`. Deliberately anchored on `from '...'` / `import('...')` so
 * that string literals in doc comments or type positions are left alone.
 */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*?)\.tsx?\2/g;

/**
 * A side-effect stylesheet import (`import "./X.keyframes.css";`) on its own
 * line. tsc keeps these in declaration emit even though a .d.ts declares no
 * runtime, so without this a consumer type-checking the package needs an
 * ambient `*.css` module just to read the types.
 */
const CSS_SIDE_EFFECT_IMPORT = /^[ \t]*import\s*(['"])[^'"]*\.css\1\s*;?[ \t]*\r?\n?/gm;

export function rewriteDeclarationSource(source: string): string {
  return source
    .replace(SPECIFIER, (_match, prefix, quote, path) => `${prefix}${quote}${path}.js${quote}`)
    .replace(CSS_SIDE_EFFECT_IMPORT, "");
}

function* walkDeclarationFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkDeclarationFiles(full);
    } else if (full.endsWith(".d.ts")) {
      yield full;
    }
  }
}

function main(): void {
  const target = resolve(process.argv[2] ?? "dist");
  let rewritten = 0;
  const offenders: string[] = [];

  for (const file of walkDeclarationFiles(target)) {
    const original = readFileSync(file, "utf-8");
    const fixed = rewriteDeclarationSource(original);
    if (fixed !== original) {
      writeFileSync(file, fixed);
      rewritten += 1;
    }
    // Re-scan the written content: anything still carrying a relative .ts
    // specifier is a shape this script's regex does not understand, and would
    // ship a broken declaration file.
    SPECIFIER.lastIndex = 0;
    CSS_SIDE_EFFECT_IMPORT.lastIndex = 0;
    if (SPECIFIER.test(fixed) || CSS_SIDE_EFFECT_IMPORT.test(fixed)) offenders.push(file);
  }

  if (offenders.length > 0) {
    console.error(
      `[tui-kit] fix-dts-extensions: ${offenders.length} declaration file(s) still carry relative .ts/.tsx specifiers or stylesheet side-effect imports:\n  ${offenders.join("\n  ")}`,
    );
    process.exit(1);
  }

  if (!process.env.TUI_KIT_BUILD_SILENT) {
    console.log(
      `[tui-kit] fix-dts-extensions: rewrote ${rewritten} declaration file(s) in ${target}`,
    );
  }
}

if (import.meta.main) {
  main();
}
