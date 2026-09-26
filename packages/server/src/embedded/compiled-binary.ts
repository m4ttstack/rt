/**
 * Bun compiles the entrypoint itself into its virtual filesystem, at
 * `/$bunfs/root/<binary-name>` -- verified empirically (`bun build
 * --compile`, then run: `Bun.main` carries that prefix; `bun run` of the
 * same source does not). This holds even with zero `with { type: 'file' }`
 * imports anywhere in the build, which is exactly why it's used here rather
 * than `Bun.embeddedFiles`: that array reads empty both when nothing got
 * embedded AND when the process isn't compiled at all, so it can't tell
 * "compiled binary, codegen didn't run" apart from "not compiled" -- the one
 * distinction this needs.
 */
export function isCompiledBinaryMain(main: string): boolean {
  return main.startsWith('/$bunfs/');
}

/** Bun-touching wrapper -- exercised by actually running the compiled
    binary, not vitest (no `Bun` global there). */
export function isCompiledBinary(): boolean {
  return isCompiledBinaryMain(Bun.main);
}
