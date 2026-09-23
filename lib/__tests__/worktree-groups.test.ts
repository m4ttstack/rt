import { describe, expect, test } from "bun:test";
import { groupWorktrees, recencyGroup, type WorktreeGroupSeams } from "../worktree-groups.ts";
import type { TreeRecord } from "../worktree/registry.ts";

const NOW = new Date(2026, 8, 23, 15, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function rec(path: string, fields: Partial<TreeRecord>): TreeRecord {
  return { name: path, path, kind: "ephemeral", branch: null, createdAt: "2026-09-01T00:00:00Z", ...fields };
}

function seams(records: TreeRecord[], headMs: Record<string, number>): WorktreeGroupSeams {
  return { registry: () => records, headMovedMs: (p) => headMs[p] ?? NaN, now: () => NOW };
}

describe("recencyGroup", () => {
  test("same calendar day is today, even more than a few hours back", () => {
    expect(recencyGroup(NOW - 14 * HOUR, NOW)).toBe("today");
  });
  test("yesterday is this week", () => {
    expect(recencyGroup(NOW - 16 * HOUR, NOW)).toBe("this week");
  });
  test("seven days or more is idle", () => {
    expect(recencyGroup(NOW - 7 * DAY, NOW)).toBe("idle 7d+");
  });
  test("unknown activity is idle", () => {
    expect(recencyGroup(NaN, NOW)).toBe("idle 7d+");
  });
});

describe("groupWorktrees", () => {
  const main = { path: "/r/main" };
  const a = { path: "/r/a" };
  const b = { path: "/r/b" };
  const c = { path: "/r/c" };
  const d = { path: "/r/d" };

  test("keeps the lead ungrouped first and orders groups today, this week, idle", () => {
    const out = groupWorktrees("repo", [main, a, b, c], seams([], {
      "/r/main": NOW - 30 * DAY,
      "/r/a": NOW - 20 * DAY,
      "/r/b": NOW - 2 * DAY,
      "/r/c": NOW - HOUR,
    }));
    expect(out.worktrees.map((w) => w.path)).toEqual(["/r/main", "/r/c", "/r/b", "/r/a"]);
    expect(out.groupOf.has("/r/main")).toBe(false);
    expect(out.groupOf.get("/r/c")).toBe("today");
    expect(out.groupOf.get("/r/b")).toBe("this week");
    expect(out.groupOf.get("/r/a")).toBe("idle 7d+");
  });

  test("preserves caller order within a group", () => {
    const out = groupWorktrees("repo", [main, b, a], seams([], { "/r/a": NOW - HOUR, "/r/b": NOW - 2 * HOUR }));
    expect(out.worktrees.map((w) => w.path)).toEqual(["/r/main", "/r/b", "/r/a"]);
  });

  test("hides trees the registry marks disposable", () => {
    const out = groupWorktrees("repo", [main, a, b], seams(
      [rec("/r/a", { state: "disposable", disposableReason: "MR closed without merge" })],
      { "/r/a": NOW - HOUR, "/r/b": NOW - HOUR },
    ));
    expect(out.worktrees.map((w) => w.path)).toEqual(["/r/main", "/r/b"]);
  });

  test("a recent claim or registry activity outranks a stale reflog", () => {
    const out = groupWorktrees("repo", [main, a, d], seams(
      [
        rec("/r/a", { state: "claimed", claimedAt: new Date(NOW - HOUR).toISOString() }),
        rec("/r/d", { state: "claimed", claimedAt: new Date(NOW - 30 * DAY).toISOString(), lastActiveAt: new Date(NOW - 2 * DAY).toISOString() }),
      ],
      { "/r/a": NOW - 30 * DAY, "/r/d": NOW - 30 * DAY },
    ));
    expect(out.groupOf.get("/r/a")).toBe("today");
    expect(out.groupOf.get("/r/d")).toBe("this week");
  });

  test("empty input stays empty", () => {
    expect(groupWorktrees("repo", [], seams([], {})).worktrees).toEqual([]);
  });
});
