/**
 * Confines the caller-named paths an MCP tool writes or reads. Every
 * mattstack MCP tool runs with no permission prompt, so this is what stops a
 * prompt-injected pane from writing an --out path onto a shell rc or a
 * committed doc, or reading a key back through a brief's template, via
 * herd_brief or rt_verb. Shares its containment rule with mr_upload's guard
 * (claudeTempRoots/isInsideRoot, lib/daemon/upload-guard.ts) rather than
 * defining a second one.
 */
import { lstatSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from "path";
import { claudeTempRoots, isInsideRoot } from "../daemon/upload-guard.ts";
import { discoverPacks } from "../skills/packs.ts";
import { buildPluginRoots, listInstalledPlugins } from "../skills/sources.ts";

type PathCheck = { ok: true } | { ok: false; error: string };

export function tempRootsForThisProcess(): string[] {
  return claudeTempRoots(typeof process.getuid === "function" ? process.getuid() : null);
}

/** The plugin listing is a synchronous subprocess inside `rt mcp serve`: unbounded, one hang would stall every tool on the server. */
export const PLUGIN_LIST_TIMEOUT_MS = 10_000;
export const READ_ROOTS_TTL_MS = 60_000;

/** pluginListError is set when the plugin listing failed; roots then holds no plugin root, so the read guard fails closed. */
export type ReadRoots = { roots: string[]; pluginListError?: string };

export interface ReadRootSources {
  tempRoots: () => string[];
  /** Throws when the installed plugins cannot be listed. */
  pluginRoots: () => string[];
  packRoots: () => string[];
  now: () => number;
}

function pluginListCause(e: unknown): string {
  if ((e as { code?: unknown } | null)?.code === "ETIMEDOUT") return `claude plugin list timed out after ${PLUGIN_LIST_TIMEOUT_MS / 1000}s`;
  const message = e instanceof Error ? e.message : String(e);
  return `claude plugin list failed: ${message.split("\n")[0]}`;
}

/**
 * The temp root plus every installed plugin and pack root, cached for ttlMs.
 * A root that is the home directory or one of its ancestors is dropped: a
 * marketplace entry pointed that wide would turn the read guard into no
 * guard. A failed listing is cached too, so a hung `claude` costs one
 * timeout per TTL rather than one per call.
 */
export function cachedReadRoots(src: ReadRootSources, ttlMs = READ_ROOTS_TTL_MS): () => ReadRoots {
  let cache: { at: number; value: ReadRoots } | null = null;
  return () => {
    const now = src.now();
    if (cache && now - cache.at < ttlMs) return cache.value;
    const home = homedir();
    const narrow = (root: string) => root !== home && !isInsideRoot(home, root);
    let plugins: string[] = [];
    let pluginListError: string | undefined;
    try {
      plugins = src.pluginRoots();
    } catch (e) {
      pluginListError = pluginListCause(e);
    }
    let packs: string[] = [];
    try {
      packs = src.packRoots();
    } catch {
      packs = [];
    }
    const value: ReadRoots = { roots: [...src.tempRoots(), ...plugins.filter(narrow), ...packs.filter(narrow)] };
    if (pluginListError) value.pluginListError = pluginListError;
    cache = { at: now, value };
    return value;
  };
}

/** One per process, so herd_brief's handler and rt_verb's real deps share a resolution. */
export const readRootsForThisProcess = cachedReadRoots({
  tempRoots: tempRootsForThisProcess,
  pluginRoots: () => Object.values(buildPluginRoots(listInstalledPlugins({ timeoutMs: PLUGIN_LIST_TIMEOUT_MS })).byName).map((p) => p.dir),
  packRoots: () => discoverPacks().map((p) => p.dir),
  now: Date.now,
});

function matchingRoot(real: string, roots: readonly string[]): string | null {
  for (const root of roots) {
    if (typeof root !== "string" || !isAbsolute(root)) continue;
    if (isInsideRoot(real, root)) return root;
    try {
      const rootReal = realpathSync(root);
      if (isInsideRoot(real, rootReal)) return rootReal;
    } catch {
      // a root that does not exist contains nothing
    }
  }
  return null;
}

function containedInAnyRoot(real: string, roots: readonly string[]): boolean {
  return matchingRoot(real, roots) !== null;
}

/**
 * Refused before any resolution: a resolver that walks `..` physically (the
 * kernel's open(2), libc realpath) and one that collapses it textually
 * (path.resolve, Node's realpathSync) land `L/..` in different places when L
 * is a symlink, so the guard and the child that later opens the path could
 * otherwise check one file and touch another.
 */
function nonCanonical(path: string): boolean {
  return normalize(path) !== path || path.split("/").some((s) => s === "." || s === "..");
}

/**
 * The target usually does not exist yet, so containment compares the
 * realpath of its PARENT (which must exist) joined with its basename,
 * never the target itself. An existing final component is refused unless
 * it is a plain regular file with nlink 1: a symlink resolves through to
 * wherever it points; a hardlink (nlink > 1, same device as any root under
 * /private/tmp) shares its inode with a file that can sit anywhere else on
 * that device, /private/tmp and the home dir included, so a write through
 * one path lands through the other; a FIFO or device node would hang the
 * child's write instead of creating a file.
 */
export function checkTempRootPath(path: unknown, roots: readonly string[]): PathCheck {
  const allowed = roots.length > 0
    ? `the Claude Code temp root (${roots.join(" or ")})`
    : "a Claude Code temp root (none resolved for this process)";
  if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
    return { ok: false, error: `path must be an absolute path inside ${allowed}` };
  }
  if (nonCanonical(path)) {
    return { ok: false, error: `path must be normalized, with no "." or ".." segments (got "${path}")` };
  }

  let finalStat;
  try {
    finalStat = lstatSync(path);
  } catch {
    finalStat = null;
  }
  if (finalStat) {
    if (finalStat.isSymbolicLink()) {
      return { ok: false, error: `path must not be an existing symlink (got "${path}")` };
    }
    if (!finalStat.isFile() || finalStat.nlink !== 1) {
      return { ok: false, error: `path must not already exist as a non-regular file or a hardlinked file (got "${path}")` };
    }
  }

  const parent = dirname(path);
  let parentReal: string;
  try {
    parentReal = realpathSync(parent);
  } catch {
    return { ok: false, error: `parent directory does not exist: ${parent}` };
  }

  const candidate = join(parentReal, basename(path));
  if (!containedInAnyRoot(candidate, roots)) {
    return { ok: false, error: `path must be inside ${allowed}` };
  }
  return { ok: true };
}

/**
 * The file must already exist, and containment compares its full realpath,
 * so a symlink inside a root that points outside every root is refused. The
 * realpath must be a regular file with nlink 1: a FIFO would hang the
 * child's read, and a hardlink shares its inode with a file that can sit
 * outside every root. Below the matched root no component may start with a
 * dot and the file must be .md: plugin and pack roots are whole checkouts,
 * and their .git, .env and other dotfiles are not briefs. The root's own
 * path is exempt, since plugin roots live under ~/.claude.
 */
export function checkReadRootPath(path: unknown, roots: readonly string[], pluginListError?: string): { ok: true; realpath: string } | { ok: false; error: string } {
  const allowed = roots.length > 0
    ? "the Claude Code temp root or an installed plugin or pack root"
    : "the Claude Code temp root or an installed plugin or pack root (none resolved for this process)";
  if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
    return { ok: false, error: `path must be an absolute path to an existing file inside ${allowed}` };
  }
  if (nonCanonical(path)) {
    return { ok: false, error: `path must be normalized, with no "." or ".." segments (got "${path}")` };
  }

  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return { ok: false, error: `file does not exist: ${path}` };
  }
  const root = matchingRoot(real, roots);
  if (root === null) {
    if (pluginListError) {
      return { ok: false, error: `path is not inside the Claude Code temp root or an installed pack root, and the installed plugins could not be listed (${pluginListError}), so a plugin root cannot be checked (got "${path}")` };
    }
    return { ok: false, error: `path must be inside ${allowed} (got "${path}")` };
  }
  if (relative(root, real).split(sep).some((c) => c.startsWith("."))) {
    return { ok: false, error: `a path component below the root starts with a dot (got "${path}")` };
  }
  if (extname(real) !== ".md") {
    return { ok: false, error: `path must name a .md file (got "${path}")` };
  }

  const stat = statSync(real, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) {
    return { ok: false, error: `path must be a regular file (got "${path}")` };
  }
  if (stat.nlink !== 1) {
    return { ok: false, error: `path must not be a hardlinked file (got "${path}")` };
  }
  return { ok: true, realpath: real };
}
