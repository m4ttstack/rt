/**
 * Confines an MCP-writable output path to the Claude Code temp root. Every
 * mattstack MCP tool runs with no permission prompt, so this is what stops a
 * prompt-injected pane from writing an --out path onto a shell rc or a
 * committed doc through herd_brief or rt_verb. Shares its containment rule
 * with mr_upload's guard (claudeTempRoots/isInsideRoot, lib/daemon/
 * upload-guard.ts) rather than defining a second one.
 */
import { lstatSync, realpathSync } from "fs";
import { basename, dirname, isAbsolute, join } from "path";
import { claudeTempRoots, isInsideRoot } from "../daemon/upload-guard.ts";

export function tempRootsForThisProcess(): string[] {
  return claudeTempRoots(typeof process.getuid === "function" ? process.getuid() : null);
}

function containedInAnyRoot(real: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    if (isInsideRoot(real, root)) return true;
    try {
      return isInsideRoot(real, realpathSync(root));
    } catch {
      return false;
    }
  });
}

/**
 * The target usually does not exist yet, so containment compares the
 * realpath of its PARENT (which must exist) joined with its basename,
 * never the target itself. A final component that is already a symlink is
 * refused outright: resolving through it would check one path and let a
 * write land through another.
 */
export function checkTempRootPath(path: unknown, roots: readonly string[]): { ok: true } | { ok: false; error: string } {
  const allowed = roots.length > 0
    ? `the Claude Code temp root (${roots.join(" or ")})`
    : "a Claude Code temp root (none resolved for this process)";
  if (typeof path !== "string" || path.length === 0 || !isAbsolute(path)) {
    return { ok: false, error: `path must be an absolute path inside ${allowed}` };
  }

  let finalStat;
  try {
    finalStat = lstatSync(path);
  } catch {
    finalStat = null;
  }
  if (finalStat?.isSymbolicLink()) {
    return { ok: false, error: `path must not be an existing symlink (got "${path}")` };
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
