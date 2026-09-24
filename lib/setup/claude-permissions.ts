/**
 * The one description of "Claude Code's settings.json permissions.allow
 * list" the `claude.permissions` step needs: read it the same three ways
 * `linear-mcp.ts` reads `.claude.json` (parsed, unparsable, unreadable),
 * union `BASE_PERMISSIONS` into `allow` without touching any other key, and
 * write it back atomically. Kept apart from the step so the read/union/write
 * logic can be exercised per config-dir without going through `ApplyContext`.
 */
import { dirname, isAbsolute, join } from "path";
import { BASE_PERMISSIONS } from "./base-permissions.ts";
import type { Probes } from "./probes.ts";

export interface ClaudeSettings {
  permissions?: { allow?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}

export type SettingsRead =
  | { ok: true; settings: ClaudeSettings }
  | { ok: false; reason: "absent" }
  | { ok: false; reason: "unreadable" }
  | { ok: false; reason: "unparsable" };

/**
 * `absent` is the one reason a caller may answer by writing the path, so it
 * must be proven, not assumed: the readFile probe collapses EVERY error into
 * null, which without the exists check is indistinguishable from no file at
 * all, and the file being replaced is Claude Code's own settings.
 */
export function readClaudeSettings(p: Pick<Probes, "readFile" | "exists">, path: string): SettingsRead {
  const raw = p.readFile(path);
  if (raw === null) return { ok: false, reason: p.exists(path) ? "unreadable" : "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "unparsable" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "unparsable" };
  const permissions = (parsed as ClaudeSettings).permissions;
  if (permissions !== undefined && (typeof permissions !== "object" || permissions === null || Array.isArray(permissions))) {
    return { ok: false, reason: "unparsable" };
  }
  const allow = permissions?.allow;
  if (allow !== undefined && !Array.isArray(allow)) return { ok: false, reason: "unparsable" };
  // Every entry must be a string, not just the array itself. Filtering a
  // non-string out and writing the remainder back would drop a value rt
  // cannot interpret but Claude Code may.
  if (Array.isArray(allow) && allow.some((v) => typeof v !== "string")) return { ok: false, reason: "unparsable" };
  return { ok: true, settings: parsed as ClaudeSettings };
}

function currentAllow(settings: ClaudeSettings): string[] {
  const allow = settings.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((v): v is string => typeof v === "string") : [];
}

/** BASE_PERMISSIONS entries not already present, in BASE_PERMISSIONS order. */
export function missingPermissions(settings: ClaudeSettings): string[] {
  const existing = new Set(currentAllow(settings));
  return BASE_PERMISSIONS.filter((entry) => !existing.has(entry));
}

/**
 * Claude Code starts in auto mode by itself only on the Pro, Max and Team
 * plans; an Enterprise plan or a Console key starts in manual mode, where
 * every git and rt call in an unattended pane prompts. So a config dir with
 * no `defaultMode` of its own gets this one. A value the user set, whatever
 * it is, is never touched.
 */
export const SEEDED_DEFAULT_MODE = "auto";

export function missingDefaultMode(settings: ClaudeSettings): boolean {
  return settings.permissions?.defaultMode === undefined;
}

/**
 * Appends `toAdd` to `permissions.allow` and seeds `defaultMode` when it is
 * absent, preserving every other key on `settings` and every other key
 * under `permissions` (deny, ask, anything unknown) byte-for-byte.
 */
export function withPermissions(settings: ClaudeSettings, toAdd: string[]): ClaudeSettings {
  return {
    ...settings,
    permissions: {
      ...(settings.permissions ?? {}),
      ...(missingDefaultMode(settings) ? { defaultMode: SEEDED_DEFAULT_MODE } : {}),
      allow: [...currentAllow(settings), ...toAdd],
    },
  };
}

/**
 * Atomic replace, mode-preserving: settings.json is Claude Code's own live
 * config, so a partial write over it must never happen, and it is not a
 * secrets file the way `.claude.json` is. An existing file's mode is
 * carried forward rather than tightened, and only a file that did not exist
 * gets rt's own 0600 default. Unlink-before-write plus a trailing explicit
 * chmod (the same double-guard `linear-mcp.ts`'s writeClaudeConfig uses)
 * because `writeFile`'s `mode` argument only lands on a freshly-created
 * inode: a temp file left behind by an earlier failed rename would
 * otherwise be reused at whatever mode it already had.
 *
 * Atomic for readers, deliberately not crash-durable: no fsync of the temp
 * file or its directory, so power loss in the instant around the rename can
 * lose the new content. Every atomic writer in rt shares this contract, on
 * purpose... each of these files is re-derivable by re-running an idempotent
 * step or reconnecting an integration, and one writer carrying a stronger
 * guarantee than its neighbours would be indistinguishable from an accident.
 * Strengthen all of them together or none.
 */
export function writeClaudeSettings(
  p: Pick<Probes, "mkdirp" | "writeFile" | "rename" | "chmod" | "removeFile" | "fileMode" | "readlink">,
  linkPath: string,
  settings: ClaudeSettings,
): void {
  // rename() replaces a symlink's own directory entry rather than writing
  // through it, so a settings.json managed out of a dotfiles repo would be
  // detached from its source with the real file left untouched.
  const link = p.readlink(linkPath);
  const path = link === null ? linkPath : isAbsolute(link) ? link : join(dirname(linkPath), link);
  const tmp = `${path}.rt-tmp`;
  const mode = p.fileMode(path) ?? 0o600;
  p.mkdirp(dirname(path));
  p.removeFile(tmp);
  p.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", mode);
  p.chmod(tmp, mode);
  try {
    p.rename(tmp, path);
  } catch (err) {
    p.removeFile(tmp);
    throw err;
  }
}
