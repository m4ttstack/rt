import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createTestHome, rt } from "../harness.ts";

let home: { path: string; cleanup: () => void };
let repo: string;

const IDENT = ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false"];

function g(args: string[]): string {
  return execFileSync("git", [...IDENT, ...args], { cwd: repo, encoding: "utf8" });
}

beforeAll(() => {
  home = createTestHome();
  repo = join(home.path, "scratch-repo");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
  writeFileSync(join(repo, "a.txt"), "one\n");
  g(["add", "."]);
  g(["commit", "-m", "first commit"]);
  writeFileSync(join(repo, "a.txt"), "two\n");
  writeFileSync(join(repo, "new.txt"), "hello\n");
});

afterAll(() => home.cleanup());

// e2e/harness.ts's rt() has no `cwd` option: `opts.home` doubles as both the
// spawned process's cwd and its default HOME. Passing `home: repo` puts the
// process in the scratch repo; `env.HOME` is layered back on top (the spread
// in harness.ts's run() applies opts.env after its own HOME default) so rt
// still sees the real test HOME with its .gitconfig/.zshrc.
async function rtJson(args: string[]): Promise<any> {
  const res = await rt(args, { home: repo, env: { HOME: home.path } });
  expect(res.exitCode).toBe(0);
  return JSON.parse(res.stdout);
}

describe("rt git read verbs", () => {
  test("status --json carries the snapshot", async () => {
    const out = await rtJson(["git", "status", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.branch).toBe("main");
    expect(out.detached).toBe(false);
    expect(out.clean).toBe(false);
    expect(out.files).toEqual([
      { path: "a.txt", kind: "modified", staged: false, unstaged: true },
      { path: "new.txt", kind: "untracked", staged: false, unstaged: true },
    ]);
  });

  test("log --json lists entries newest first", async () => {
    const out = await rtJson(["git", "log", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.entries.length).toBe(1);
    expect(out.entries[0].subject).toBe("first commit");
    expect(out.entries[0].parents).toEqual([]);
  });

  test("branches --json lists main as current", async () => {
    const out = await rtJson(["git", "branches", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.branches.length).toBe(1);
    expect(out.branches[0].name).toBe("main");
    expect(out.branches[0].current).toBe(true);
    expect(out.branches[0].upstream).toBeNull();
  });
});

describe("rt git diff", () => {
  test("diff --json returns hunks for a modified file", async () => {
    const out = await rtJson(["git", "diff", "a.txt", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.diff.path).toBe("a.txt");
    expect(out.diff.kind).toBe("text");
    expect(out.diff.hunks.length).toBe(1);
    const lines = out.diff.hunks[0].lines.map((l: any) => [l.type, l.content]);
    expect(lines).toEqual([["del", "one"], ["add", "two"]]);
  });

  test("omitted path in non-TTY json mode is a usage error", async () => {
    const res = await rt(["git", "diff", "--json"], { home: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: "usage: rt git diff <path> [--staged] [--json]",
    });
  });

  test("a value-flag lookalike does not swallow the positional", async () => {
    const out = await rtJson(["git", "diff", "--file", "a.txt", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.diff.path).toBe("a.txt");
  });
});

describe("rt git amend and undo", () => {
  test("amend --json amends staged content and keeps the message", async () => {
    writeFileSync(join(repo, "amended.txt"), "x\n");
    g(["add", "amended.txt"]);
    const before = g(["rev-list", "--count", "HEAD"]).trim();
    const out = await rtJson(["git", "amend", "--json"]);
    expect(out.ok).toBe(true);
    expect(typeof out.summary).toBe("string");
    expect(g(["rev-list", "--count", "HEAD"]).trim()).toBe(before);
    expect(g(["log", "-1", "--format=%s"]).trim()).toBe("first commit");
  });

  test("undo --json on a single-commit repo refuses with initial", async () => {
    const res = await rt(["git", "undo", "--json"], { home: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ ok: false, error: "refused: initial" });
  });

  test("undo --json removes the last commit and keeps its changes", async () => {
    writeFileSync(join(repo, "second.txt"), "y\n");
    g(["add", "second.txt"]);
    g(["commit", "-m", "second commit"]);
    const sha = g(["rev-parse", "HEAD"]).trim();
    const out = await rtJson(["git", "undo", "--json"]);
    expect(out.ok).toBe(true);
    expect(out.undoneSha).toBe(sha);
    expect(g(["rev-list", "--count", "HEAD"]).trim()).toBe("1");
    expect(g(["status", "--porcelain"])).toContain("second.txt");
  });

  test("amend --json on a zero-commit repo surfaces git's own error, not a guard crash", async () => {
    const unbornRepo = join(home.path, "unborn-repo");
    mkdirSync(unbornRepo, { recursive: true });
    execFileSync("git", ["init", "-b", "main", unbornRepo], { encoding: "utf8" });
    const res = await rt(["git", "amend", "--json"], { home: unbornRepo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe("string");
    expect(out.error.length).toBeGreaterThan(0);
  });
});
