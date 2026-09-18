import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../state/db.ts";
import { createGitBadges } from "../git-badges-store.ts";
import type { GitWorktreeBadge } from "../../../packages/rt-client/src/commands.ts";

function badge(overrides: Partial<GitWorktreeBadge> = {}): GitWorktreeBadge {
  return {
    worktree: "/tmp/a", branch: "main", detached: false,
    staged: 0, unstaged: 1, untracked: 0, conflicted: 0, clean: false,
    ahead: 2, behind: 0, upstream: "origin/main",
    lastFetchedAt: null, updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

function freshDb() {
  return openStateDb(join(mkdtempSync(join(tmpdir(), "badges-")), "state.db"), "daemon");
}

describe("git badges store", () => {
  test("replaceRepo persists and readAll round-trips across a reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "badges-")), "state.db");
    const store = createGitBadges(openStateDb(path, "daemon"));
    const changed = store.replaceRepo("remote:example.com%2Fa%2Fb", [badge()]);
    expect(changed.changed).toBe(true);
    const reopened = createGitBadges(openStateDb(path, "daemon"));
    expect(reopened.readAll().get("remote:example.com%2Fa%2Fb")).toEqual([badge()]);
  });

  test("identical badges except updatedAt report changed: false", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("remote:example.com%2Fa%2Fb", [badge()]);
    const second = store.replaceRepo("remote:example.com%2Fa%2Fb", [
      badge({ updatedAt: "2026-09-17T00:05:00.000Z" }),
    ]);
    expect(second.changed).toBe(false);
  });

  test("a badge field change reports changed: true", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("remote:example.com%2Fa%2Fb", [badge()]);
    const second = store.replaceRepo("remote:example.com%2Fa%2Fb", [badge({ ahead: 3 })]);
    expect(second.changed).toBe(true);
  });

  test("a removed worktree's row is deleted by replaceRepo", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("r", [badge({ worktree: "/tmp/a" }), badge({ worktree: "/tmp/b" })]);
    store.replaceRepo("r", [badge({ worktree: "/tmp/a" })]);
    expect(store.readAll().get("r")!.map((b) => b.worktree)).toEqual(["/tmp/a"]);
  });

  test("dropRepos removes repos absent from the live set and returns them", () => {
    const store = createGitBadges(freshDb());
    store.replaceRepo("keep", [badge()]);
    store.replaceRepo("gone", [badge()]);
    expect(store.dropRepos(new Set(["keep"]))).toEqual(["gone"]);
    expect([...store.readAll().keys()]).toEqual(["keep"]);
  });

  // Mirrors lib/state/__tests__/busy.test.ts's real-conflict setup: a second
  // connection holds the write lock past the daemon flavor's 250ms
  // busy_timeout, so the store's own DELETE throws SQLITE_BUSY for real
  // rather than through a stub.
  test("a BUSY-deferred delete keeps the entry so the next pass retries", () => {
    const path = join(mkdtempSync(join(tmpdir(), "badges-busy-")), "state.db");
    const db = openStateDb(path, "daemon");
    const store = createGitBadges(db);
    store.replaceRepo("gone", [badge()]);

    const blocker = new Database(path);
    blocker.exec("PRAGMA busy_timeout = 0;");
    blocker.exec("BEGIN IMMEDIATE;");
    try {
      expect(store.dropRepos(new Set())).toEqual([]);
      expect([...store.readAll().keys()]).toEqual(["gone"]);
    } finally {
      blocker.exec("ROLLBACK;");
      blocker.close();
    }

    // Lock released: the next pass's delete lands and the repo is reported gone.
    expect(store.dropRepos(new Set())).toEqual(["gone"]);
    expect([...store.readAll().keys()]).toEqual([]);
  });
});
