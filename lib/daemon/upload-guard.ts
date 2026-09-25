/**
 * The network-free half of mr:upload. Every mattstack MCP tool runs with no
 * permission check, so this is the only thing between an agent and sending an
 * arbitrary local file to a forge: the realpath must be a regular file under
 * one of the caller's roots (a non-empty absolute string; anything else is
 * skipped rather than resolved against the daemon's own cwd), the extension
 * must be an image or video type, and the size is capped. Symlinks resolve
 * before the containment check, so a link inside a root that points outside
 * it is refused without its target ever being read. The bytes returned on
 * success are read from one descriptor opened O_NOFOLLOW|O_NONBLOCK (refuses
 * a final-component symlink or a FIFO swapped in after the earlier stat,
 * without blocking on it) and verified against that stat's dev/ino and
 * against its own fstat size (refuses a file that grew past what was
 * checked), so the bytes uploaded are the bytes the magic-number check ran
 * against. A parent-directory swap between the realpath resolution and the
 * open is not defended against: that already requires a writer inside an
 * allowed root, which can defeat the byte check by other means too.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync, type Stats } from "fs";
import { basename, extname, isAbsolute, relative } from "path";

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const UPLOAD_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm"] as const;

export type UploadCheck =
  | { ok: true; realpath: string; filename: string; mime: string; size: number; bytes: Uint8Array }
  | { ok: false; error: string };

const HEAD_BYTES = 12;

function startsWith(head: Uint8Array, bytes: number[]): boolean {
  return bytes.every((b, i) => head[i] === b);
}

function ascii(head: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (head[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

const TYPES: Record<(typeof UPLOAD_EXTENSIONS)[number], { mime: string; matches: (head: Uint8Array) => boolean }> = {
  png:  { mime: "image/png",       matches: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg:  { mime: "image/jpeg",      matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg",      matches: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  gif:  { mime: "image/gif",       matches: (h) => ascii(h, 0, "GIF87a") || ascii(h, 0, "GIF89a") },
  webp: { mime: "image/webp",      matches: (h) => ascii(h, 0, "RIFF") && ascii(h, 8, "WEBP") },
  mp4:  { mime: "video/mp4",       matches: (h) => ascii(h, 4, "ftyp") },
  mov:  { mime: "video/quicktime", matches: (h) => ["ftyp", "moov", "mdat", "free", "wide", "skip"].some((atom) => ascii(h, 4, atom)) },
  webm: { mime: "video/webm",      matches: (h) => startsWith(h, [0x1a, 0x45, 0xdf, 0xa3]) },
};

export function claudeTempRoots(uid: number | null): string[] {
  if (uid === null) return [];
  return [`/private/tmp/claude-${uid}`, `/tmp/claude-${uid}`];
}

export function isInsideRoot(realpath: string, root: string): boolean {
  const rel = relative(root, realpath);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function safeStat(p: string): Stats | null {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/** path.relative resolves a relative or empty root against the daemon's own cwd instead of throwing, so a root must be filtered to a non-empty absolute string before it ever reaches isInsideRoot. */
function isValidRoot(root: unknown): root is string {
  return typeof root === "string" && root.length > 0 && isAbsolute(root);
}

function contained(real: string, roots: readonly unknown[]): boolean {
  return roots.some((root) => {
    if (!isValidRoot(root)) return false;
    if (isInsideRoot(real, root)) return true;
    const rootReal = safeRealpath(root);
    return rootReal !== null && isInsideRoot(real, rootReal);
  });
}

/**
 * Reads the whole file from one descriptor, verified against `expect` (the
 * stat taken before this open) so the bytes returned are the bytes that were
 * checked, not whatever a later, separate open would follow or a file that
 * grew past its checked size. Never throws.
 */
function readVerified(real: string, expect: Stats, maxBytes: number): { bytes: Uint8Array } | { error: string } {
  let fd: number;
  try {
    fd = openSync(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return { error: `cannot open file: ${(err as NodeJS.ErrnoException).code ?? String(err)}` };
  }
  try {
    let fstat: Stats;
    try {
      fstat = fstatSync(fd);
    } catch (err) {
      return { error: `cannot stat open file: ${(err as NodeJS.ErrnoException).code ?? String(err)}` };
    }
    if (!fstat.isFile()) return { error: "path is not a regular file" };
    if (fstat.dev !== expect.dev || fstat.ino !== expect.ino) {
      return { error: "file changed identity between check and read" };
    }
    if (fstat.size > maxBytes) {
      return { error: `file is ${(fstat.size / (1024 * 1024)).toFixed(1)} MB; the upload cap is ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))} MB` };
    }

    const buf = Buffer.alloc(fstat.size);
    let offset = 0;
    while (offset < buf.length) {
      const n = readSync(fd, buf, offset, buf.length - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    if (offset < buf.length) return { error: "file read short of its reported size" };

    const probe = Buffer.alloc(1);
    const extra = readSync(fd, probe, 0, 1, offset);
    if (extra > 0) return { error: "file grew during read" };

    return { bytes: buf };
  } catch (err) {
    return { error: String(err) };
  } finally {
    // The bytes are already read and verified; a close failure must not turn this never-throw function into a throw.
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
  }
}

export function checkUploadPath(path: unknown, roots: readonly string[], opts: { maxBytes?: number } = {}): UploadCheck {
  if (typeof path !== "string" || !isAbsolute(path)) return { ok: false, error: "path must be absolute" };
  const real = safeRealpath(path);
  if (real === null) return { ok: false, error: "file not found" };
  const stat = safeStat(real);
  if (stat === null) return { ok: false, error: "file not found" };
  if (!stat.isFile()) return { ok: false, error: "path is not a regular file" };

  if (!contained(real, roots)) {
    return { ok: false, error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, or an rt.mcp.uploadRoots entry)" };
  }

  const ext = extname(real).slice(1).toLowerCase() as (typeof UPLOAD_EXTENSIONS)[number];
  const type = (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? TYPES[ext] : undefined;
  if (!type) return { ok: false, error: `extension must be one of ${UPLOAD_EXTENSIONS.join(", ")}` };

  const maxBytes = opts.maxBytes ?? UPLOAD_MAX_BYTES;
  const read = readVerified(real, stat, maxBytes);
  if ("error" in read) return { ok: false, error: read.error };

  if (!type.matches(read.bytes.subarray(0, HEAD_BYTES))) return { ok: false, error: `file bytes do not match a .${ext} signature` };
  return { ok: true, realpath: real, filename: basename(real), mime: type.mime, size: read.bytes.length, bytes: read.bytes };
}
