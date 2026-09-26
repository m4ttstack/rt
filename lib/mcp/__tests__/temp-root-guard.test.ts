import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { tmpdir } from "os";
import { checkReadRootPath, checkTempRootPath } from "../temp-root-guard.ts";

const createdDirs: string[] = [];

function realTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  createdDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

describe("checkTempRootPath", () => {
  test("a not-yet-existing target under the root is ok", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const r = checkTempRootPath(join(root, "brief.md"), [root]);
    expect(r).toEqual({ ok: true });
  });

  test("a target outside every root is refused, naming the allowed root", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const outside = realTempDir("rt-temp-root-guard-outside-");
    const r = checkTempRootPath(join(outside, "brief.md"), [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain(root);
  });

  test("a relative path is refused", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const r = checkTempRootPath("brief.md", [root]);
    expect(r.ok).toBe(false);
  });

  test("a parent directory that does not exist is refused", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const r = checkTempRootPath(join(root, "no-such-dir", "brief.md"), [root]);
    expect(r.ok).toBe(false);
  });

  test("a final component that already exists as a symlink is refused, even pointing inside the root", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const real = join(root, "real.md");
    writeFileSync(real, "body");
    const link = join(root, "link.md");
    symlinkSync(real, link);
    const r = checkTempRootPath(link, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("symlink");
  });

  test("a hardlinked existing file is refused even though it is a plain regular file (the same-device escape: a hardlink shares its inode with a file that can sit anywhere else on that device)", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const victimDir = realTempDir("rt-temp-root-guard-victim-");
    const victim = join(victimDir, "zshrc");
    writeFileSync(victim, "original content");
    const hardlink = join(root, "b.md");
    linkSync(victim, hardlink);
    const r = checkTempRootPath(hardlink, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("hardlinked");
  });

  test("a directory at the final component is refused (not a regular file)", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const dirTarget = join(root, "adir");
    mkdirSync(dirTarget);
    const r = checkTempRootPath(dirTarget, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("non-regular file");
  });

  test("a FIFO at the final component is refused (would hang the child's write)", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const fifo = join(root, "pipe");
    execFileSync("mkfifo", [fifo]);
    const r = checkTempRootPath(fifo, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("non-regular file");
  });

  test("a `..` traversal through a symlinked component lands outside the root and is refused, pinning today's realpath behavior", () => {
    const root = realTempDir("rt-temp-root-guard-");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    symlinkSync(join(root, "a", "b"), join(root, "L"));
    const outsideSibling = realTempDir("rt-temp-root-guard-sibling-");
    // Built by string concatenation, not path.join/resolve, so the literal
    // "L/../.." components survive to reach checkTempRootPath's own
    // dirname()+realpathSync() -- path.join would collapse them first and
    // the trap would never be exercised.
    const trap = `${root}/L/../../${basename(outsideSibling)}/pwn.md`;
    expect(dirname(trap)).toBe(`${root}/L/../../${basename(outsideSibling)}`);
    const r = checkTempRootPath(trap, [root]);
    expect(r.ok).toBe(false);
  });

  test("a symlinked PARENT directory that resolves inside a root is ok (macOS's /tmp -> /private/tmp shape)", () => {
    const real = realTempDir("rt-temp-root-guard-real-");
    const linkRoot = join(tmpdir(), `rt-temp-root-guard-link-${process.pid}`);
    symlinkSync(real, linkRoot);
    try {
      const r = checkTempRootPath(join(linkRoot, "brief.md"), [real, linkRoot]);
      expect(r).toEqual({ ok: true });
    } finally {
      rmSync(linkRoot, { force: true });
    }
  });

  test("a symlinked parent directory that escapes every root is refused", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const outside = realTempDir("rt-temp-root-guard-outside-");
    const escapeLink = join(root, "escape");
    symlinkSync(outside, escapeLink);
    const r = checkTempRootPath(join(escapeLink, "brief.md"), [root]);
    expect(r.ok).toBe(false);
  });

  test("no roots resolved for this process is a refusal, not a silent pass", () => {
    const root = realTempDir("rt-temp-root-guard-");
    const r = checkTempRootPath(join(root, "brief.md"), []);
    expect(r.ok).toBe(false);
  });
});

describe("checkReadRootPath", () => {
  function fileIn(dir: string, name: string, body = "body"): string {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  test("an existing regular file inside any root passes", () => {
    const tempRoot = realTempDir("rt-read-root-temp-");
    const pluginRoot = realTempDir("rt-read-root-plugin-");
    expect(checkReadRootPath(fileIn(tempRoot, "t.md"), [tempRoot, pluginRoot])).toEqual({ ok: true });
    expect(checkReadRootPath(fileIn(pluginRoot, "s.md"), [tempRoot, pluginRoot])).toEqual({ ok: true });
  });

  test("a file outside every root is refused", () => {
    const root = realTempDir("rt-read-root-");
    const outside = realTempDir("rt-read-root-outside-");
    const r = checkReadRootPath(fileIn(outside, "id_ed25519"), [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("plugin or pack root");
  });

  test("a relative path is refused", () => {
    const root = realTempDir("rt-read-root-");
    fileIn(root, "t.md");
    const r = checkReadRootPath("t.md", [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("absolute");
  });

  test("a symlink inside a root that points outside it is refused, because its realpath lands outside", () => {
    const root = realTempDir("rt-read-root-");
    const outside = realTempDir("rt-read-root-outside-");
    const secret = fileIn(outside, "id_ed25519", "PRIVATE KEY");
    const link = join(root, "template.md");
    symlinkSync(secret, link);
    const r = checkReadRootPath(link, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("plugin or pack root");
  });

  test("a symlink inside a root that points elsewhere inside a root passes", () => {
    const root = realTempDir("rt-read-root-");
    const real = fileIn(root, "real.md");
    const link = join(root, "link.md");
    symlinkSync(real, link);
    expect(checkReadRootPath(link, [root])).toEqual({ ok: true });
  });

  test("a missing file is refused", () => {
    const root = realTempDir("rt-read-root-");
    const r = checkReadRootPath(join(root, "absent.md"), [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("does not exist");
  });

  test("a directory or a FIFO is refused (not a regular file)", () => {
    const root = realTempDir("rt-read-root-");
    const dir = join(root, "adir");
    mkdirSync(dir);
    const fifo = join(root, "pipe");
    execFileSync("mkfifo", [fifo]);
    for (const p of [dir, fifo]) {
      const r = checkReadRootPath(p, [root]);
      expect(r.ok, p).toBe(false);
      expect(r.ok ? "" : r.error).toContain("regular file");
    }
  });

  test("a hardlinked file is refused (its inode can be shared with a file outside every root)", () => {
    const root = realTempDir("rt-read-root-");
    const outside = realTempDir("rt-read-root-outside-");
    const secret = fileIn(outside, "id_ed25519", "PRIVATE KEY");
    const hardlink = join(root, "t.md");
    linkSync(secret, hardlink);
    const r = checkReadRootPath(hardlink, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("hardlinked");
  });

  test("a path with a `..` segment is refused before any resolution", () => {
    const root = realTempDir("rt-read-root-");
    mkdirSync(join(root, "sub"));
    fileIn(root, "t.md");
    const r = checkReadRootPath(`${root}/sub/../t.md`, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("normalized");
  });

  test("no roots is a refusal, not a silent pass", () => {
    const root = realTempDir("rt-read-root-");
    const r = checkReadRootPath(fileIn(root, "t.md"), []);
    expect(r.ok).toBe(false);
  });
});
