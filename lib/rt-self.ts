import { fileURLToPath } from "url";

/** Every module of the compiled binary is served from /$bunfs; execPath's basename cannot tell (it is `bun` from source and anything a user renames). */
export function isCompiledRt(moduleUrl: string = import.meta.url): boolean {
  return fileURLToPath(moduleUrl).startsWith("/$bunfs");
}

/** Argv prefix that runs this same rt: from source, execPath is bun and Bun.main is cli.ts. */
export function rtSelfArgv(opts: { compiled?: boolean; execPath?: string; main?: string } = {}): string[] {
  const execPath = opts.execPath ?? process.execPath;
  return (opts.compiled ?? isCompiledRt()) ? [execPath] : [execPath, opts.main ?? Bun.main];
}
