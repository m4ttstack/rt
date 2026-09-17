import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getChangedFiles,
  discardChanges,
  syncStagingArea,
  commitStaged,
  amendStaged,
  numstatCounts,
} from "../commit-ops.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
}

/** Fresh repo with one commit containing tracked.txt */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-commit-ops-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  writeFileSync(join(dir, "tracked.txt"), "base\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

/** Fresh unborn repo with no commits */
function makeUnbornRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rt-commit-ops-unborn-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@test");
  git(dir, "config", "user.name", "test");
  return dir;
}

function porcelain(cwd: string): string {
  return git(cwd, "status", "--porcelain");
}

describe("getChangedFiles", () => {
  test("parses modified, staged-new, and untracked files", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    writeFileSync(join(dir, "added.txt"), "new\n");
    git(dir, "add", "added.txt");
    writeFileSync(join(dir, "untracked.txt"), "loose\n");

    const files = getChangedFiles(dir);
    const byPath = new Map(files.map((f) => [f.path, f]));

    expect(byPath.get("tracked.txt")).toMatchObject({ isStaged: false, hasUnstaged: true });
    expect(byPath.get("added.txt")).toMatchObject({ isStaged: true, hasUnstaged: false });
    expect(byPath.get("untracked.txt")).toMatchObject({ isStaged: false, hasUnstaged: true });
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns real paths for names with spaces and unicode (no porcelain quoting)", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "café Ω.txt"), "x\n");
    writeFileSync(join(dir, "with space.txt"), "y\n");

    const paths = getChangedFiles(dir).map((f) => f.path).sort();
    expect(paths).toEqual(["café Ω.txt", "with space.txt"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("captures both sides of a rename", () => {
    const dir = makeRepo();
    git(dir, "mv", "tracked.txt", "renamed.txt");

    const files = getChangedFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "renamed.txt", origPath: "tracked.txt", isStaged: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("discardChanges", () => {
  test("reverts a mixed batch: staged-new, modified, untracked, rename", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "extra.txt"), "keep-history\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "second");

    writeFileSync(join(dir, "added.txt"), "new\n");
    git(dir, "add", "added.txt");
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    writeFileSync(join(dir, "untracked.txt"), "loose\n");
    git(dir, "mv", "extra.txt", "moved.txt");

    const files = getChangedFiles(dir);
    discardChanges(dir, files, files.map((f) => f.path));

    expect(porcelain(dir)).toBe("");
    expect(existsSync(join(dir, "added.txt"))).toBe(false);
    expect(existsSync(join(dir, "untracked.txt"))).toBe(false);
    expect(existsSync(join(dir, "moved.txt"))).toBe(false);
    expect(existsSync(join(dir, "extra.txt"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("reverts only the selected paths", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    writeFileSync(join(dir, "untracked.txt"), "loose\n");

    const files = getChangedFiles(dir);
    discardChanges(dir, files, ["tracked.txt"]);

    expect(porcelain(dir).trim()).toBe("?? untracked.txt");
    rmSync(dir, { recursive: true, force: true });
  });

  test("reverts paths with spaces and unicode", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "café Ω.txt"), "x\n");

    const files = getChangedFiles(dir);
    discardChanges(dir, files, files.map((f) => f.path));

    expect(porcelain(dir)).toBe("");
    expect(existsSync(join(dir, "café Ω.txt"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("syncStagingArea", () => {
  test("deselecting an untracked file does not throw and leaves it untracked", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    writeFileSync(join(dir, "untracked.txt"), "loose\n");

    const files = getChangedFiles(dir);
    syncStagingArea(dir, files, new Set(["tracked.txt"]));

    expect(porcelain(dir)).toBe("M  tracked.txt\n?? untracked.txt\n");
    rmSync(dir, { recursive: true, force: true });
  });

  test("stages selected files and unstages deselected staged files", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", "a.txt", "b.txt");
    writeFileSync(join(dir, "tracked.txt"), "changed\n");

    const files = getChangedFiles(dir);
    syncStagingArea(dir, files, new Set(["a.txt", "tracked.txt"]));

    expect(porcelain(dir)).toBe("A  a.txt\nM  tracked.txt\n?? b.txt\n");
    rmSync(dir, { recursive: true, force: true });
  });

  test("deselecting a rename unstages both sides", () => {
    const dir = makeRepo();
    git(dir, "mv", "tracked.txt", "renamed.txt");
    writeFileSync(join(dir, "other.txt"), "o\n");

    const files = getChangedFiles(dir);
    syncStagingArea(dir, files, new Set(["other.txt"]));

    const status = porcelain(dir);
    expect(status).toContain("A  other.txt");
    expect(status).toContain("?? renamed.txt");
    expect(status).toContain(" D tracked.txt");
    expect(status).not.toContain("R ");
    rmSync(dir, { recursive: true, force: true });
  });

  test("re-adds partially staged files so the full content is committed", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "staged half\n");
    git(dir, "add", "tracked.txt");
    writeFileSync(join(dir, "tracked.txt"), "newest content\n");

    const files = getChangedFiles(dir);
    syncStagingArea(dir, files, new Set(["tracked.txt"]));

    expect(porcelain(dir)).toBe("M  tracked.txt\n");
    expect(git(dir, "show", ":tracked.txt")).toBe("newest content\n");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("fresh repo with no commits yet", () => {
  test("syncStagingArea can unstage before the first commit", () => {
    const dir = makeUnbornRepo();
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    git(dir, "add", "a.txt", "b.txt");

    const files = getChangedFiles(dir);
    syncStagingArea(dir, files, new Set(["a.txt"]));

    expect(porcelain(dir)).toBe("A  a.txt\n?? b.txt\n");
    rmSync(dir, { recursive: true, force: true });
  });

  test("discardChanges removes a staged-new file before the first commit", () => {
    const dir = makeUnbornRepo();
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(dir, "add", "a.txt");

    const files = getChangedFiles(dir);
    discardChanges(dir, files, ["a.txt"]);

    expect(porcelain(dir)).toBe("");
    expect(existsSync(join(dir, "a.txt"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("commitStaged", () => {
  test("commits the message verbatim: no shell expansion, quotes and newlines survive", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const message = 'fix: $(touch INJECTED) `touch INJ2` "quoted" \'single\'\n\nbody line';
    const summary = commitStaged(dir, message);

    expect(existsSync(join(dir, "INJECTED"))).toBe(false);
    expect(existsSync(join(dir, "INJ2"))).toBe(false);
    expect(git(dir, "log", "--format=%B", "-1").trim()).toBe(message);
    expect(summary).toContain("fix:");
    rmSync(dir, { recursive: true, force: true });
  });

  test("throws with git's stderr when there is nothing to commit", () => {
    const dir = makeRepo();
    expect(() => commitStaged(dir, "empty")).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  test("multi-line message with blank line commits verbatim", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const message = "fix: multi-line\n\nbody paragraph";
    commitStaged(dir, message);

    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe(message);
    rmSync(dir, { recursive: true, force: true });
  });

  test("coAuthors option produces trailers separated by blank line", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const message = "feat: new feature";
    const coAuthors = ["Alice Smith <alice@example.com>", "Bob Jones <bob@example.com>"];
    commitStaged(dir, message, { coAuthors });

    const fullLog = git(dir, "log", "-1", "--format=%B");
    expect(fullLog).toContain("feat: new feature");
    expect(fullLog).toContain("Co-Authored-By: Alice Smith <alice@example.com>");
    expect(fullLog).toContain("Co-Authored-By: Bob Jones <bob@example.com>");
    expect(fullLog).toMatch(/feat: new feature\n\nCo-Authored-By:/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("amend option replaces previous commit without changing log count", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed1\n");
    git(dir, "add", "tracked.txt");
    commitStaged(dir, "first commit");

    writeFileSync(join(dir, "tracked.txt"), "changed2\n");
    git(dir, "add", "tracked.txt");
    commitStaged(dir, "amended commit", { amend: true });

    const logCount = git(dir, "log", "--oneline").trim().split("\n").length;
    expect(logCount).toBe(2);
    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe("amended commit");
    rmSync(dir, { recursive: true, force: true });
  });

  test("allowEmpty option commits with clean index", () => {
    const dir = makeRepo();

    const message = "chore: empty commit";
    commitStaged(dir, message, { allowEmpty: true });

    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe("chore: empty commit");
    rmSync(dir, { recursive: true, force: true });
  });

  test("noVerify option commits despite pre-commit hook that exits 1", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "changed\n");
    git(dir, "add", "tracked.txt");

    const hooksDir = join(dir, ".git", "hooks");
    const preCommitHook = join(hooksDir, "pre-commit");
    writeFileSync(preCommitHook, "#!/bin/sh\nexit 1\n");
    chmodSync(preCommitHook, 0o755);

    const message = "feat: with no-verify";

    // Assert that commit without noVerify throws
    expect(() => commitStaged(dir, message)).toThrow();

    // Assert that commit with noVerify succeeds
    const summary = commitStaged(dir, message, { noVerify: true });
    expect(summary).toContain("feat: with no-verify");
    expect(git(dir, "log", "-1", "--format=%B").trim()).toBe("feat: with no-verify");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("numstatCounts", () => {
  test("parses adds/dels for a modified tracked file", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "tracked.txt"), "base\nextra\n");

    const counts = numstatCounts(dir);

    expect(counts.get("tracked.txt")).toEqual({ adds: 1, dels: 0 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("maps a binary file's numstat row (- -) to 0/0", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    git(dir, "add", "bin.dat");
    git(dir, "commit", "-qm", "add binary");
    writeFileSync(join(dir, "bin.dat"), Buffer.from([4, 5, 6, 7, 8]));

    const counts = numstatCounts(dir);

    expect(counts.get("bin.dat")).toEqual({ adds: 0, dels: 0 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("does not report untracked files — they never appear in `git diff HEAD`", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "loose.txt"), "x\n");

    const counts = numstatCounts(dir);

    expect(counts.has("loose.txt")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns an empty map before the first commit (no HEAD to diff against)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rt-commit-ops-unborn-numstat-"));
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "test@test");
    git(dir, "config", "user.name", "test");
    writeFileSync(join(dir, "a.txt"), "a\n");
    git(dir, "add", "a.txt");

    expect(numstatCounts(dir)).toEqual(new Map());
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("amendStaged", () => {
  test("amend without a message keeps the original message", () => {
    const cwd = makeUnbornRepo();
    writeFileSync(join(cwd, "a.txt"), "one\n");
    git(cwd, "add", ".");
    commitStaged(cwd, "original message");
    writeFileSync(join(cwd, "a.txt"), "two\n");
    git(cwd, "add", ".");
    amendStaged(cwd);
    const msg = git(cwd, "log", "-1", "--format=%s").trim();
    expect(msg).toBe("original message");
    const count = git(cwd, "rev-list", "--count", "HEAD").trim();
    expect(count).toBe("1");
    rmSync(cwd, { recursive: true, force: true });
  });

  test("amend with a message replaces it", () => {
    const cwd = makeUnbornRepo();
    writeFileSync(join(cwd, "a.txt"), "one\n");
    git(cwd, "add", ".");
    commitStaged(cwd, "original message");
    amendStaged(cwd, { message: "rewritten" });
    const msg = git(cwd, "log", "-1", "--format=%s").trim();
    expect(msg).toBe("rewritten");
    rmSync(cwd, { recursive: true, force: true });
  });
});
