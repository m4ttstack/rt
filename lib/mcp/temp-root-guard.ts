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
import { basename, dirname, isAbsolute, join, normalize } from "path";
import { claudeTempRoots, isInsideRoot } from "../daemon/upload-guard.ts";
import { discoverPacks } from "../skills/packs.ts";
import { resolvePluginRoots } from "../skills/sources.ts";

type PathCheck = { ok: true } | { ok: false; error: string };

export function tempRootsForThisProcess(): string[] {
  return claudeTempRoots(typeof process.getuid === "function" ? process.getuid() : null);
}

function installedPluginRoots(): string[] {
  try {
    return Object.values(resolvePluginRoots().byName).map((p) => p.dir);
  } catch {
    return [];
  }
}

function installedPackRoots(): string[] {
  try {
    return discoverPacks().map((p) => p.dir);
  } catch {
    return [];
  }
}

/**
 * The temp root plus every installed plugin and pack root. A root that is
 * the home directory or one of its ancestors is dropped: a marketplace entry
 * pointed that wide would turn the read guard into no guard.
 */
export function readRootsForThisProcess(): string[] {
  const home = homedir();
  const wide = (root: string) => root === home || isInsideRoot(home, root);
  return [...tempRootsForThisProcess(), ...installedPluginRoots().filter((r) => !wide(r)), ...installedPackRoots().filter((r) => !wide(r))];
}

function containedInAnyRoot(real: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    if (typeof root !== "string" || !isAbsolute(root)) return false;
    if (isInsideRoot(real, root)) return true;
    try {
      return isInsideRoot(real, realpathSync(root));
    } catch {
      return false;
    }
  });
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
 * outside every root.
 */
export function checkReadRootPath(path: unknown, roots: readonly string[]): PathCheck {
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
  if (!containedInAnyRoot(real, roots)) {
    return { ok: false, error: `path must be inside ${allowed} (got "${path}")` };
  }

  const stat = statSync(real, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) {
    return { ok: false, error: `path must be a regular file (got "${path}")` };
  }
  if (stat.nlink !== 1) {
    return { ok: false, error: `path must not be a hardlinked file (got "${path}")` };
  }
  return { ok: true };
}
