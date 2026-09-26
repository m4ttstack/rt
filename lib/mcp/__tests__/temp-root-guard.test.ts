import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkTempRootPath } from "../temp-root-guard.ts";

function realTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

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
