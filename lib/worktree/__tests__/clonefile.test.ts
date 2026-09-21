import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { clonePath, cloneExitCode, CLONE_EXIT } from "../clonefile.ts";

function fixture(): { dir: string; src: string } {
  const dir = mkdtempSync(join(tmpdir(), "rtclone-"));
  const src = join(dir, "src");
  mkdirSync(join(src, "nested", "deep"), { recursive: true });
  writeFileSync(join(src, "nested", "deep", "a.txt"), "alpha\n");
  writeFileSync(join(src, "b.txt"), "beta\n");
  return { dir, src };
}

describe("clonePath", () => {
  test("clones a directory tree; contents match, inodes differ, writes do not leak back", () => {
    const { dir, src } = fixture();
    const dst = join(dir, "dst");
    const r = clonePath(src, dst);
    expect(r).toEqual({ ok: true });
    expect(readFileSync(join(dst, "nested", "deep", "a.txt"), "utf8")).toBe("alpha\n");
    expect(statSync(join(dst, "b.txt")).ino).not.toBe(statSync(join(src, "b.txt")).ino);
    writeFileSync(join(dst, "b.txt"), "changed\n");
    expect(readFileSync(join(src, "b.txt"), "utf8")).toBe("beta\n");
  });

  test("clones a single file", () => {
    const { dir, src } = fixture();
    const r = clonePath(join(src, "b.txt"), join(dir, "b-copy.txt"));
    expect(r).toEqual({ ok: true });
    expect(readFileSync(join(dir, "b-copy.txt"), "utf8")).toBe("beta\n");
  });

  test("an existing destination is EEXIST and maps to exit 5", () => {
    const { dir, src } = fixture();
    const dst = join(dir, "dst");
    mkdirSync(dst);
    const r = clonePath(src, dst);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errno).toBe(17);
    expect(cloneExitCode(r)).toBe(CLONE_EXIT.exist);
  });

  test("a missing source is ENOENT and maps to exit 1", () => {
    const { dir } = fixture();
    const r = clonePath(join(dir, "nope"), join(dir, "dst"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errno).toBe(2);
    expect(r.message.length).toBeGreaterThan(0);
    expect(cloneExitCode(r)).toBe(CLONE_EXIT.other);
    expect(existsSync(join(dir, "dst"))).toBe(false);
  });

  test("exit code table", () => {
    expect(cloneExitCode({ ok: true })).toBe(0);
    expect(cloneExitCode({ ok: false, errno: 18, message: "x" })).toBe(CLONE_EXIT.exdev);
    expect(cloneExitCode({ ok: false, errno: 45, message: "x" })).toBe(CLONE_EXIT.notsup);
  });
});
