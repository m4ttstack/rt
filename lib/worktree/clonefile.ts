/**
 * One clonefile(2) call. On APFS the kernel clones a whole directory
 * subtree copy-on-write in a single syscall; `cp -c` walks and clones file
 * by file and was measured 12x slower on 580k inodes. The call blocks the
 * calling thread for the duration, so it only ever runs in the child
 * process behind `rt worktree hydrate-clone`, never on the daemon thread.
 */
import { dlopen, FFIType, ptr, read } from "bun:ffi";

export type CloneResult = { ok: true } | { ok: false; errno: number; message: string };

export const CLONE_EXIT = { ok: 0, other: 1, usage: 2, exdev: 3, notsup: 4, exist: 5 } as const;

const EEXIST = 17;
const EXDEV = 18;
const ENOTSUP = 45;

let lib: ReturnType<typeof open> | null = null;
function open() {
  return dlopen("/usr/lib/libSystem.B.dylib", {
    clonefile: { args: [FFIType.cstring, FFIType.cstring, FFIType.u32], returns: FFIType.i32 },
    __error: { args: [], returns: FFIType.ptr },
    strerror: { args: [FFIType.i32], returns: FFIType.cstring },
  });
}

function cstr(s: string): Buffer {
  return Buffer.from(`${s}\0`);
}

export function clonePath(src: string, dst: string): CloneResult {
  lib ??= open();
  // bun:ffi's ptr() does not root the buffer it points into, so the Buffer
  // must be held in a local that outlives the call, not just the pointer:
  // a GC between cstr() returning and clonefile running could otherwise
  // free the bytes clonefile reads.
  const srcBuf = cstr(src);
  const dstBuf = cstr(dst);
  const rc = lib.symbols.clonefile(ptr(srcBuf), ptr(dstBuf), 0);
  if (rc === 0) return { ok: true };
  const errno = read.i32(lib.symbols.__error()!, 0);
  const message = String(lib.symbols.strerror(errno) ?? `errno ${errno}`);
  return { ok: false, errno, message };
}

export function cloneExitCode(r: CloneResult): number {
  if (r.ok) return CLONE_EXIT.ok;
  if (r.errno === EXDEV) return CLONE_EXIT.exdev;
  if (r.errno === ENOTSUP) return CLONE_EXIT.notsup;
  if (r.errno === EEXIST) return CLONE_EXIT.exist;
  return CLONE_EXIT.other;
}
