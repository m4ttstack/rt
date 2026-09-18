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

  test("log --max with no value surfaces a JSON usage error, not a raw throw", async () => {
    const res = await rt(["git", "log", "--max", "--json"], { home: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.ok).toBe(false);
    expect(typeof out.error).toBe("string");
    expect(out.error.length).toBeGreaterThan(0);
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

describe("rt git stash", () => {
  test("push, list, pop round-trip", async () => {
    writeFileSync(join(repo, "a.txt"), "stashme\n");
    const pushed = await rtJson(["git", "stash", "push", "--message", "wip test", "--json"]);
    expect(pushed).toEqual({ ok: true, created: true });
    const listed = await rtJson(["git", "stash", "list", "--json"]);
    expect(listed.ok).toBe(true);
    expect(listed.stashes.length).toBe(1);
    expect(listed.stashes[0].message).toContain("wip test");
    expect(listed.stashes[0].index).toBe(0);
    const popped = await rtJson(["git", "stash", "pop", "--json"]);
    expect(popped).toEqual({ ok: true, index: 0 });
    const after = await rtJson(["git", "stash", "list", "--json"]);
    expect(after.stashes).toEqual([]);
  });

  test("drop without an index in non-TTY json mode is a usage error", async () => {
    const res = await rt(["git", "stash", "drop", "--json"], { home: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: "usage: rt git stash drop <index> [--json]",
    });
  });
});

describe("rt git tag", () => {
  test("create, list, delete round-trip", async () => {
    const created = await rtJson(["git", "tag", "create", "v0.0.1-test", "--message", "test tag", "--json"]);
    expect(created).toEqual({ ok: true, name: "v0.0.1-test", pushed: false });
    const listed = await rtJson(["git", "tag", "list", "--json"]);
    expect(listed.ok).toBe(true);
    const tag = listed.tags.find((t: any) => t.name === "v0.0.1-test");
    expect(tag.annotated).toBe(true);
    expect(tag.targetSha).toBe(g(["rev-parse", "HEAD"]).trim());
    const deleted = await rtJson(["git", "tag", "delete", "v0.0.1-test", "--json"]);
    expect(deleted).toEqual({ ok: true, name: "v0.0.1-test" });
    const after = await rtJson(["git", "tag", "list", "--json"]);
    expect(after.tags.find((t: any) => t.name === "v0.0.1-test")).toBeUndefined();
  });

  test("a flag-like token is never accepted as a tag name", async () => {
    const res = await rt(["git", "tag", "create", "-D", "--json"], { home: repo, env: { HOME: home.path } });
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({
      ok: false,
      error: "usage: rt git tag create <name> [--message <m>] [--at <sha>] [--push] [--json]",
    });
  });

  test("create with positional extracted correctly when matching flag value", async () => {
    const created = await rtJson(["git", "tag", "create", "vpin-a", "--message", "vpin-a", "--json"]);
    expect(created).toEqual({ ok: true, name: "vpin-a", pushed: false });
    await rtJson(["git", "tag", "delete", "vpin-a", "--json"]);
  });

  test("create with positional extracted correctly after flag value", async () => {
    const created = await rtJson(["git", "tag", "create", "--message", "hello", "vpin-b", "--json"]);
    expect(created).toEqual({ ok: true, name: "vpin-b", pushed: false });
    await rtJson(["git", "tag", "delete", "vpin-b", "--json"]);
  });
});
