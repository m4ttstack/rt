import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { homedir, tmpdir } from "os";
import { cachedReadRoots, checkReadRootPath, checkTempRootPath, PLUGIN_LIST_TIMEOUT_MS, type ReadRootSources } from "../temp-root-guard.ts";

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

  test("a `..` traversal through a symlinked component is refused as non-normalized, whichever way a resolver walks it", () => {
    const root = realTempDir("rt-temp-root-guard-");
    mkdirSync(join(root, "a", "b"), { recursive: true });
    symlinkSync(join(root, "a", "b"), join(root, "L"));
    const outsideSibling = realTempDir("rt-temp-root-guard-sibling-");
    // A physical walk of L/../.. lands back in root, so this directory makes
    // the trap's parent exist INSIDE the root for a physical resolver while a
    // textual one lands on outsideSibling: the two disagree.
    mkdirSync(join(root, basename(outsideSibling)));
    // Concatenated, not path.join'd: join would collapse the `..` segments.
    const trap = `${root}/L/../../${basename(outsideSibling)}/pwn.md`;
    expect(dirname(trap)).toBe(`${root}/L/../../${basename(outsideSibling)}`);
    const r = checkTempRootPath(trap, [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("must be normalized");
  });

  test("a `.` segment or a doubled slash is refused as non-normalized", () => {
    const root = realTempDir("rt-temp-root-guard-");
    for (const p of [`${root}/./brief.md`, `${root}//brief.md`]) {
      const r = checkTempRootPath(p, [root]);
      expect(r.ok, p).toBe(false);
      expect(r.ok ? "" : r.error).toContain("must be normalized");
    }
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
    expect(checkReadRootPath(fileIn(tempRoot, "t.md"), [tempRoot, pluginRoot])).toEqual({ ok: true, realpath: join(tempRoot, "t.md") });
    expect(checkReadRootPath(fileIn(pluginRoot, "s.md"), [tempRoot, pluginRoot])).toEqual({ ok: true, realpath: join(pluginRoot, "s.md") });
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
    expect(checkReadRootPath(link, [root])).toEqual({ ok: true, realpath: real });
  });

  test("a missing file is refused", () => {
    const root = realTempDir("rt-read-root-");
    const r = checkReadRootPath(join(root, "absent.md"), [root]);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("does not exist");
  });

  test("a directory or a FIFO is refused (not a regular file)", () => {
    const root = realTempDir("rt-read-root-");
    const dir = join(root, "adir.md");
    mkdirSync(dir);
    const fifo = join(root, "pipe.md");
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

  test("a dot-leading component below the matched root is refused", () => {
    const root = realTempDir("rt-read-root-");
    mkdirSync(join(root, ".git"));
    for (const p of [fileIn(join(root, ".git"), "config.md"), fileIn(root, ".env.md")]) {
      const r = checkReadRootPath(p, [root]);
      expect(r.ok, p).toBe(false);
      expect(r.ok ? "" : r.error).toContain("starts with a dot");
    }
  });

  test("a symlink whose realpath lands in a dot-leading directory below the root is refused", () => {
    const root = realTempDir("rt-read-root-");
    mkdirSync(join(root, ".hidden"));
    const real = fileIn(join(root, ".hidden"), "t.md");
    const link = join(root, "t.md");
    symlinkSync(real, link);
    const r = checkReadRootPath(link, [root]);
    expect(r.ok ? "" : r.error).toContain("starts with a dot");
  });

  test("a file without a .md extension is refused", () => {
    const root = realTempDir("rt-read-root-");
    for (const name of ["t.txt", "id_ed25519", "brief.MD.bak"]) {
      const r = checkReadRootPath(fileIn(root, name), [root]);
      expect(r.ok, name).toBe(false);
      expect(r.ok ? "" : r.error).toContain(".md");
    }
  });

  test("a root that itself sits under a dot-leading directory still works", () => {
    const base = realTempDir("rt-read-root-home-");
    const root = join(base, ".claude", "plugins", "cache", "mattstack");
    mkdirSync(join(root, "references"), { recursive: true });
    const p = fileIn(join(root, "references"), "job-template.md");
    expect(checkReadRootPath(p, [root])).toEqual({ ok: true, realpath: p });
  });

  test("when the installed plugins could not be listed, a path outside the other roots is refused naming that cause", () => {
    const root = realTempDir("rt-read-root-");
    const outside = realTempDir("rt-read-root-outside-");
    const r = checkReadRootPath(fileIn(outside, "t.md"), [root], "claude plugin list timed out after 10s");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("installed plugins could not be listed");
    expect(r.ok ? "" : r.error).toContain("timed out after 10s");
  });

  test("when the installed plugins could not be listed, a file inside the temp root still passes", () => {
    const root = realTempDir("rt-read-root-");
    const p = fileIn(root, "t.md");
    expect(checkReadRootPath(p, [root], "claude plugin list failed: boom")).toEqual({ ok: true, realpath: p });
  });
});

describe("cachedReadRoots", () => {
  function sources(overrides: Partial<ReadRootSources> = {}) {
    let clock = 1_000;
    const counts = { plugins: 0, packs: 0 };
    const src: ReadRootSources = {
      tempRoots: () => ["/private/tmp/claude-501"],
      pluginRoots: () => { counts.plugins++; return ["/opt/plugins/mattstack"]; },
      packRoots: () => { counts.packs++; return ["/opt/packs/acme"]; },
      now: () => clock,
      ...overrides,
    };
    return { src, counts, advance: (ms: number) => { clock += ms; } };
  }

  test("a second call within the TTL is served from the cache; after it, the roots are resolved again", () => {
    const { src, counts, advance } = sources();
    const resolve = cachedReadRoots(src, 60_000);
    const first = resolve();
    expect(first).toEqual({ roots: ["/private/tmp/claude-501", "/opt/plugins/mattstack", "/opt/packs/acme"] });
    advance(59_000);
    expect(resolve()).toBe(first);
    expect(counts).toEqual({ plugins: 1, packs: 1 });
    advance(2_000);
    resolve();
    expect(counts).toEqual({ plugins: 2, packs: 2 });
  });

  test("a failing listing yields no plugin roots and a cause naming the failure", () => {
    const { src } = sources({ pluginRoots: () => { throw new Error("claude: command not found\nmore"); } });
    const r = cachedReadRoots(src)();
    expect(r.roots).toEqual(["/private/tmp/claude-501", "/opt/packs/acme"]);
    expect(r.pluginListError).toBe("claude plugin list failed: claude: command not found");
  });

  test("a timed-out listing yields a cause naming the timeout", () => {
    const { src } = sources({ pluginRoots: () => { throw Object.assign(new Error("spawnSync claude ETIMEDOUT"), { code: "ETIMEDOUT" }); } });
    const r = cachedReadRoots(src)();
    expect(r.pluginListError).toBe(`claude plugin list timed out after ${PLUGIN_LIST_TIMEOUT_MS / 1000}s`);
  });

  test("a plugin or pack root that is the home directory or one of its ancestors is dropped", () => {
    const { src } = sources({ pluginRoots: () => [homedir(), "/"], packRoots: () => [dirname(homedir())] });
    expect(cachedReadRoots(src)().roots).toEqual(["/private/tmp/claude-501"]);
  });

  test("a failed listing refuses a plugin file end to end, naming the cause", () => {
    const pluginRoot = realTempDir("rt-read-root-plugin-");
    const p = join(pluginRoot, "job-template.md");
    writeFileSync(p, "body");
    const { src } = sources({ pluginRoots: () => { throw Object.assign(new Error("x"), { code: "ETIMEDOUT" }); } });
    const rr = cachedReadRoots(src)();
    const r = checkReadRootPath(p, rr.roots, rr.pluginListError);
    expect(r.ok ? "" : r.error).toContain("installed plugins could not be listed (claude plugin list timed out");
  });
});
