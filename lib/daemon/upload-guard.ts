/**
 * The network-free half of mr:upload. Every mattstack MCP tool runs with no
 * permission check, so this is the only thing between an agent and sending an
 * arbitrary local file to a forge: the realpath must be a regular file under
 * one of the caller's roots, the extension must be an image or video type and
 * the leading bytes must agree with it, and the size is capped. Symlinks are
 * resolved before the containment check, so a link inside a root that points
 * outside it is refused without its target ever being read.
 */
import { closeSync, openSync, readSync, realpathSync, statSync } from "fs";
import { basename, extname, isAbsolute, relative } from "path";

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const UPLOAD_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "webm"] as const;

export type UploadCheck =
  | { ok: true; realpath: string; filename: string; mime: string; size: number }
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

function readHead(path: string): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const buf = new Uint8Array(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function checkUploadPath(path: unknown, roots: readonly string[], opts: { maxBytes?: number } = {}): UploadCheck {
  if (typeof path !== "string" || !isAbsolute(path)) return { ok: false, error: "path must be absolute" };
  const real = safeRealpath(path);
  if (real === null) return { ok: false, error: `file not found: ${path}` };
  const stat = statSync(real);
  if (!stat.isFile()) return { ok: false, error: "path is not a regular file" };

  const contained = roots.some((root) => {
    const rootReal = safeRealpath(root);
    return isInsideRoot(real, root) || (rootReal !== null && isInsideRoot(real, rootReal));
  });
  if (!contained) {
    return { ok: false, error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, or an rt.mcp.uploadRoots entry)" };
  }

  const ext = extname(real).slice(1).toLowerCase() as (typeof UPLOAD_EXTENSIONS)[number];
  const type = (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? TYPES[ext] : undefined;
  if (!type) return { ok: false, error: `extension must be one of ${UPLOAD_EXTENSIONS.join(", ")}` };

  const maxBytes = opts.maxBytes ?? UPLOAD_MAX_BYTES;
  if (stat.size > maxBytes) {
    return { ok: false, error: `file is ${(stat.size / (1024 * 1024)).toFixed(1)} MB; the upload cap is ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))} MB` };
  }

  if (!type.matches(readHead(real))) return { ok: false, error: `file bytes do not match a .${ext} signature` };
  return { ok: true, realpath: real, filename: basename(real), mime: type.mime, size: stat.size };
}
