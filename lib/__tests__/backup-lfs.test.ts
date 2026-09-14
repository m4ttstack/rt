import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { lfsFilterCommands, writeLfsFilterConfig } from "../state/backup-lfs.ts";

const BIN = "/Applications/mattstack.app/Contents/Helpers/git-lfs";

function git(repoDir: string, ...args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd: repoDir });
  return proc.stdout.toString().trim();
}

describe("lfsFilterCommands", () => {
  test("each key names the binary and git-lfs's own arguments", () => {
    const cmds = lfsFilterCommands(BIN);
    expect(cmds["filter.lfs.clean"]).toBe(`"${BIN}" clean -- %f`);
    expect(cmds["filter.lfs.smudge"]).toBe(`"${BIN}" smudge -- %f`);
    expect(cmds["filter.lfs.process"]).toBe(`"${BIN}" filter-process`);
  });

  // git hands a filter command to the shell, so an unquoted bundle under a
  // home directory with a space in it would split into two arguments.
  test("a path with a space stays one argument", () => {
    const cmds = lfsFilterCommands("/Users/ada lovelace/Applications/mattstack.app/Contents/Helpers/git-lfs");
    expect(cmds["filter.lfs.process"]).toBe('"/Users/ada lovelace/Applications/mattstack.app/Contents/Helpers/git-lfs" filter-process');
  });
});

describe("writeLfsFilterConfig", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "rt-lfs-config-"));
    Bun.spawnSync(["git", "init", "-q", "."], { cwd: repo });
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** What `git lfs install --local` leaves behind: PATH-relative commands. */
  function seedPathRelativeFilters(): void {
    git(repo, "config", "--local", "filter.lfs.clean", "git-lfs clean -- %f");
    git(repo, "config", "--local", "filter.lfs.smudge", "git-lfs smudge -- %f");
    git(repo, "config", "--local", "filter.lfs.process", "git-lfs filter-process");
  }

  test("repoints every filter key at the resolved binary", () => {
    seedPathRelativeFilters();
    const result = writeLfsFilterConfig(repo, BIN);
    expect(result.changed.sort()).toEqual(["filter.lfs.clean", "filter.lfs.process", "filter.lfs.smudge"]);
    expect(git(repo, "config", "--local", "--get", "filter.lfs.clean")).toBe(`"${BIN}" clean -- %f`);
    expect(git(repo, "config", "--local", "--get", "filter.lfs.process")).toBe(`"${BIN}" filter-process`);
  });

  // The sweep calls this every cycle; a no-op has to stay a no-op or every
  // four hours would report a repair that did not happen.
  test("a second call changes nothing", () => {
    seedPathRelativeFilters();
    writeLfsFilterConfig(repo, BIN);
    expect(writeLfsFilterConfig(repo, BIN).changed).toEqual([]);
  });

  // An app that moved (~/Applications to /Applications, prod to dev) or a
  // Homebrew copy that went away leaves an absolute path nothing can run.
  test("a stale absolute path is replaced", () => {
    git(repo, "config", "--local", "filter.lfs.clean", "/opt/homebrew/bin/git-lfs clean -- %f");
    git(repo, "config", "--local", "filter.lfs.smudge", "/opt/homebrew/bin/git-lfs smudge -- %f");
    git(repo, "config", "--local", "filter.lfs.process", "/opt/homebrew/bin/git-lfs filter-process");
    expect(writeLfsFilterConfig(repo, BIN).changed.length).toBe(3);
    expect(git(repo, "config", "--local", "--get", "filter.lfs.smudge")).toBe(`"${BIN}" smudge -- %f`);
  });

  // Repair, never install: a repo with no LFS filters is a repo that does not
  // use LFS, and writing them would enable a filter nothing asked for.
  test("a repo with no lfs filters is left alone", () => {
    const result = writeLfsFilterConfig(repo, BIN);
    expect(result.changed).toEqual([]);
    expect(git(repo, "config", "--local", "--get", "filter.lfs.clean")).toBe("");
  });

  test("no resolvable git-lfs leaves the existing config untouched", () => {
    seedPathRelativeFilters();
    const result = writeLfsFilterConfig(repo, null);
    expect(result.bin).toBeNull();
    expect(result.changed).toEqual([]);
    expect(git(repo, "config", "--local", "--get", "filter.lfs.clean")).toBe("git-lfs clean -- %f");
  });

  test("a path that is not a git repo is a no-op", () => {
    const plain = mkdtempSync(join(tmpdir(), "rt-lfs-plain-"));
    try {
      expect(writeLfsFilterConfig(plain, BIN).changed).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
