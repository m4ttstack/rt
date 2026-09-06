import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { gitProvenance, untrackedEnvPresent } from "./source.ts";

let dir: string;

function git(args: string[]): void {
  Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "source-test-"));
  git(["init", "-q"]);
  git(["config", "user.email", "t@t.dev"]);
  git(["config", "user.name", "t"]);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("gitProvenance returns the short sha and dirty:false on a clean commit", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);

  const p = gitProvenance(dir);
  expect(p.sha).toMatch(/^[0-9a-f]{7,}$/);
  expect(p.dirty).toBe(false);
});

test("gitProvenance flags dirty when the worktree has an uncommitted edit", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, "a.txt"), "2");

  expect(gitProvenance(dir).dirty).toBe(true);
});

test("gitProvenance throws on a directory with no commits (no HEAD)", () => {
  expect(() => gitProvenance(dir)).toThrow();
});

test("untrackedEnvPresent is false with a clean worktree", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);

  expect(untrackedEnvPresent(dir)).toBe(false);
});

test("untrackedEnvPresent is true for an untracked .env at the root", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, ".env"), "SECRET=1");

  expect(untrackedEnvPresent(dir)).toBe(true);
});

test("untrackedEnvPresent is true for an untracked .env nested in a subdirectory", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);
  const sub = join(dir, "config");
  Bun.spawnSync(["mkdir", "-p", sub]);
  writeFileSync(join(sub, ".env.local"), "SECRET=1");

  expect(untrackedEnvPresent(dir)).toBe(true);
});

test("untrackedEnvPresent ignores a tracked .env (already committed)", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  writeFileSync(join(dir, ".env"), "SECRET=1");
  git(["add", "a.txt", ".env"]);
  git(["commit", "-q", "-m", "init"]);

  expect(untrackedEnvPresent(dir)).toBe(false);
});

test("untrackedEnvPresent ignores unrelated untracked files", () => {
  writeFileSync(join(dir, "a.txt"), "1");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, "notes.md"), "hi");

  expect(untrackedEnvPresent(dir)).toBe(false);
});
