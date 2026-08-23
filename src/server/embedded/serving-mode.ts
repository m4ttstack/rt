export type ServingModeDecision =
  { mode: 'embedded' } | { mode: 'disk' } | { mode: 'fatal'; message: string };

/**
 * A compiled binary with no manifest means `bun build --compile` ran
 * without `generate:embedded` first (`build:binary` runs both, in order,
 * but nothing stops a bare `bun build --compile` from skipping the first
 * step) -- there is no `dist/` on a user's machine for that binary to fall
 * back to, so this combination must refuse to serve rather than silently
 * 404 everything. Every other combination is a normal, expected mode.
 */
export function decideServingMode(params: {
  manifestLoaded: boolean;
  isCompiledBinary: boolean;
}): ServingModeDecision {
  if (params.manifestLoaded) return { mode: 'embedded' };
  if (params.isCompiledBinary) {
    return {
      mode: 'fatal',
      message:
        'FATAL: this compiled binary has no embedded static assets. ' +
        'src/server/embedded/generated/manifest.ts (written by ' +
        '`bun run generate:embedded`) did not exist when `bun build --compile` ' +
        'ran, so no static assets were embedded and this binary cannot serve ' +
        'the app. Build with `bun run build:binary`, which runs codegen and ' +
        'the compile step in order -- do not run `bun build --compile` on ' +
        'src/server/index.ts directly.',
    };
  }
  return { mode: 'disk' };
}
