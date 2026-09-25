/**
 * checkUploadPath: the network-free half of mr:upload. Every refusal the
 * spec lists is pinned here against real files under a temp root, so the
 * handler test can trust the guard and cover only the POST.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { UPLOAD_MAX_BYTES, checkUploadPath, claudeTempRoots, isInsideRoot } from "../upload-guard.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const GIF = Buffer.from("GIF89a\0\0\0\0\0\0\0\0\0\0", "latin1");
const WEBP = Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1");
const MP4 = Buffer.from("\0\0\0\x18ftypisom\0\0\0\0", "latin1");
const MOV = Buffer.from("\0\0\0\x14ftypqt  \0\0\0\0", "latin1");
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("checkUploadPath", () => {
  let root: string;
  let rootReal: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rt-upload-root-"));
    rootReal = realpathSync(root);
    outside = realpathSync(mkdtempSync(join(tmpdir(), "rt-upload-outside-")));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  function file(dir: string, name: string, bytes: Buffer): string {
    const p = join(dir, name);
    writeFileSync(p, bytes);
    return p;
  }

  test("a png under a root passes and reports its realpath, name, mime, size and bytes", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({ ok: true, realpath: join(rootReal, "shot.png"), filename: "shot.png", mime: "image/png", size: PNG.length, bytes: PNG });
  });

  test("a root given through a symlinked alias still contains the file (tmpdir is such an alias on macOS)", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(join(rootReal, "shot.png"), [root]).ok).toBe(true);
    expect(checkUploadPath(p, [rootReal]).ok).toBe(true);
  });

  test("every allowed type passes when its bytes match, and .PNG is read case-insensitively", () => {
    for (const [name, bytes, mime] of [
      ["a.jpg", JPG, "image/jpeg"], ["a.jpeg", JPG, "image/jpeg"], ["a.gif", GIF, "image/gif"], ["a.webp", WEBP, "image/webp"],
      ["a.mp4", MP4, "video/mp4"], ["a.mov", MOV, "video/quicktime"], ["a.webm", WEBM, "video/webm"], ["a.PNG", PNG, "image/png"],
    ] as const) {
      const res = checkUploadPath(file(root, name, bytes), [root]);
      expect(res.ok, name).toBe(true);
      if (res.ok) expect(res.mime, name).toBe(mime);
    }
  });

  test("a relative path is refused", () => {
    expect(checkUploadPath("shot.png", [root])).toEqual({ ok: false, error: "path must be absolute" });
  });

  test("a non-string path is refused", () => {
    expect(checkUploadPath(5, [root])).toEqual({ ok: false, error: "path must be absolute" });
  });

  test("a missing file is refused", () => {
    const res = checkUploadPath(join(root, "nope.png"), [root]);
    expect(res).toEqual({ ok: false, error: `file not found: ${join(root, "nope.png")}` });
  });

  test("a directory is refused", () => {
    mkdirSync(join(root, "dir.png"));
    expect(checkUploadPath(join(root, "dir.png"), [root])).toEqual({ ok: false, error: "path is not a regular file" });
  });

  test("a symlink inside a root that points outside it is refused without reading the target", () => {
    const target = file(outside, "secret.png", PNG);
    symlinkSync(target, join(root, "link.png"));
    const res = checkUploadPath(join(root, "link.png"), [root]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("outside the allowed upload roots");
  });

  test("a file outside every root is refused naming the root classes", () => {
    const p = file(outside, "shot.png", PNG);
    expect(checkUploadPath(p, [root])).toEqual({
      ok: false,
      error: "path is outside the allowed upload roots (a worktree of the target repo, the Claude Code temp root, or an rt.mcp.uploadRoots entry)",
    });
  });

  test("an empty roots list refuses everything", () => {
    expect(checkUploadPath(file(root, "shot.png", PNG), []).ok).toBe(false);
  });

  test("a disallowed extension is refused before the bytes are read", () => {
    expect(checkUploadPath(file(root, "notes.txt", PNG), [root])).toEqual({
      ok: false,
      error: "extension must be one of png, jpg, jpeg, gif, webp, mp4, mov, webm",
    });
    expect(checkUploadPath(file(root, "noext", PNG), [root]).ok).toBe(false);
  });

  test("a file renamed to .png whose bytes are not a PNG is refused", () => {
    expect(checkUploadPath(file(root, "fake.png", Buffer.from("hello world, not a png")), [root])).toEqual({
      ok: false,
      error: "file bytes do not match a .png signature",
    });
    expect(checkUploadPath(file(root, "fake.mp4", PNG), [root])).toEqual({ ok: false, error: "file bytes do not match a .mp4 signature" });
  });

  test("a file over the cap is refused, and the cap defaults to 50 MB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024);
    const p = file(root, "big.png", Buffer.concat([PNG, Buffer.alloc(32)]));
    const res = checkUploadPath(p, [root], { maxBytes: 16 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("cap is 50 MB");
  });

  test("a root that does not exist on disk is skipped, not an error", () => {
    expect(checkUploadPath(file(root, "shot.png", PNG), ["/nonexistent/root", root]).ok).toBe(true);
  });

  test("a FIFO under a root with a .png name is refused and does not block", () => {
    const p = join(root, "pipe.png");
    execSync(`mkfifo "${p}"`);
    const res = checkUploadPath(p, [root]);
    expect(res).toEqual({ ok: false, error: "path is not a regular file" });
  });

  test("an empty, relative or non-string root is skipped, never resolved against the daemon's cwd", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, [""]).ok).toBe(false);
    expect(checkUploadPath(p, ["."]).ok).toBe(false);
    expect(checkUploadPath(p, ["relative/dir"]).ok).toBe(false);
    expect(checkUploadPath(p, [5 as unknown as string]).ok).toBe(false);
  });

  test("a bad root entry beside a valid one does not stop the valid root from admitting", () => {
    const p = file(root, "shot.png", PNG);
    expect(checkUploadPath(p, ["", ".", "relative/dir", root]).ok).toBe(true);
  });
});

describe("root helpers", () => {
  test("isInsideRoot needs a real descendant, not a prefix match or the root itself", () => {
    expect(isInsideRoot("/a/b/c.png", "/a/b")).toBe(true);
    expect(isInsideRoot("/a/bc/c.png", "/a/b")).toBe(false);
    expect(isInsideRoot("/a/b", "/a/b")).toBe(false);
    expect(isInsideRoot("/a/b/../c.png", "/a/b")).toBe(false);
  });

  test("claudeTempRoots names the private root and its /tmp alias, or nothing without a uid", () => {
    expect(claudeTempRoots(501)).toEqual(["/private/tmp/claude-501", "/tmp/claude-501"]);
    expect(claudeTempRoots(null)).toEqual([]);
  });
});
