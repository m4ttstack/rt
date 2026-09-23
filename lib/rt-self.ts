import { dirname, join } from "path";
import { fileURLToPath } from "url";

/** Every module of the compiled binary is served from /$bunfs; execPath's basename cannot tell (it is `bun` from source and anything a user renames). */
export function isCompiledRt(moduleUrl: string = import.meta.url): boolean {
  return fileURLToPath(moduleUrl).startsWith("/$bunfs");
}

/**
 * Argv prefix that runs this same rt: from source, execPath is bun and Bun.main is cli.ts.
 * Bun reads bunfig.toml (whose `preload` runs code before cli.ts) and .env from the
 * child's cwd, which a caller may choose; the source child is pinned to rt's own
 * bunfig.toml and reads no .env so a hostile directory cannot run code or set env.
 */
export function rtSelfArgv(opts: { compiled?: boolean; execPath?: string; main?: string } = {}): string[] {
  const execPath = opts.execPath ?? process.execPath;
  if (opts.compiled ?? isCompiledRt()) return [execPath];
  const main = opts.main ?? Bun.main;
  return [execPath, "--no-env-file", `--config=${join(dirname(main), "bunfig.toml")}`, main];
}
