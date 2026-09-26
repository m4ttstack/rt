import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { tmpdir } from "os";
import { checkTempRootPath } from "../temp-root-guard.ts";

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
