/**
 * The kit's app-entry wiring — `@mattstack/tui-kit/provider`.
 *
 * Two re-exports, no new code. Both come straight from `@soribashi/core`
 * under their own names, exactly as `src/theme.ts`'s `tuiTheme` is re-exported
 * by the barrel — no renaming, no wrapper.
 *
 * WHY THIS FILE EXISTS: bundlers key module identity by RESOLVED PATH.
 *
 * Without it, an adopter had to import these two from `@soribashi/core`
 * directly, which forced a direct `file:` dependency on soribashi's internals
 * (three of them, plus an `overrides` block — `core` and `factory` declare
 * their own deps as `workspace:*`, which only resolves inside the soribashi
 * monorepo). That wiring installs, type-checks, and boots — and is silently
 * wrong.
 *
 * The reason is that the two import paths do not meet:
 *
 *   - From the ADOPTER's own source, `@soribashi/core` resolves through the
 *     adopter's `node_modules` to the canonical `soribashi/packages/*`
 *     checkout, and `@soribashi/factory` is resolved onward from there.
 *   - From a file inside THIS KIT, the adopter's leaf symlink is realpathed to
 *     this checkout FIRST, so `@soribashi/*` resolves from
 *     `tui-kit/node_modules/` — a different path.
 *
 * Same package, same version, byte-identical files (they are usually
 * hardlinked to one inode), but two paths, and therefore two module records in
 * the bundle: two `SoribashiContext` objects, two vocabulary registries, two
 * `createTheme` implementations. `registerTheme()` then writes one registry
 * while recipes read the other, and a recipe's `useTheme()` finds no Provider
 * above it and falls back to the DEFAULT theme — emitting token refs the real
 * theme never defines. No error, no warning; just wrong colours.
 *
 * Measured on mr-board's bundle before this export existed: 2x
 * `provider/context.ts`, 2x `vocabulary-registry.ts`, 2x `create-theme.ts`.
 *
 * Importing them from the kit collapses that to one identity by construction:
 * these symbols now resolve along the SAME path as `tuiTheme` and every
 * recipe, because they are reached through this file, which lives here. An
 * adopter needs no `@soribashi/*` dependency at all.
 *
 * SUBPATH RATHER THAN BARREL-ONLY: the barrel re-exports these too (see
 * `src/index.ts`), but an app entry usually wants only the wiring, and the
 * barrel drags every recipe's module graph — and every `.module.css` — in with
 * it. This subpath is `@soribashi/core` and nothing else. Note what it does
 * NOT buy you: factory ships its types as source, so its `@ts-expect-error`
 * suppressions are re-checked under the CONSUMER's tsconfig either way. A
 * consumer whose tsconfig declares `import.meta.env` (any `types: ["bun"]`
 * project) still sees factory's two TS2578s through this subpath, and still
 * needs the same answer the barrel needed: check factory the way factory's own
 * repo does, with `types: ["node"]`.
 */
export { registerTheme, SoribashiProvider } from "@soribashi/core";
