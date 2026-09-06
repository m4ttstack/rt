import { describe, expect, test } from "bun:test";
import { normalizeWorktreePath, panesForOrigin, resolveOriginFocus } from "../gates/focus.ts";

describe("resolveOriginFocus", () => {
  test("paneId wins directly and carries tabId for the fallback", () => {
    expect(resolveOriginFocus({ paneId: "p1", tabId: "t1", worktree: "/w" }, []))
      .toEqual({ ok: true, paneId: "p1", tabId: "t1" });
  });

  test("worktree matches a live pane's cwd when no paneId is on the origin", () => {
    const panes = [{ paneId: "a", cwd: "/other" }, { paneId: "b", cwd: "/w" }];
    expect(resolveOriginFocus({ worktree: "/w" }, panes)).toEqual({ ok: true, paneId: "b" });
  });

  test("worktree with no live match resolves to a reason, not a dead target", () => {
    expect(resolveOriginFocus({ worktree: "/gone" }, [{ paneId: "a", cwd: "/other" }]))
      .toEqual({ ok: false, reason: "no live pane matches the origin worktree" });
  });

  test("no origin resolves to a reason", () => {
    expect(resolveOriginFocus(undefined, [])).toEqual({ ok: false, reason: "no origin on this gate" });
    expect(resolveOriginFocus({}, [])).toEqual({ ok: false, reason: "no origin on this gate" });
  });

  test("a trailing slash on either side of the comparison still matches", () => {
    expect(resolveOriginFocus({ worktree: "/w/" }, [{ paneId: "a", cwd: "/w" }]))
      .toEqual({ ok: true, paneId: "a" });
    expect(resolveOriginFocus({ worktree: "/w" }, [{ paneId: "a", cwd: "/w/" }]))
      .toEqual({ ok: true, paneId: "a" });
  });

  test("the macOS /tmp vs /private/tmp symlink still matches on either side", () => {
    expect(resolveOriginFocus({ worktree: "/tmp/wt-1" }, [{ paneId: "a", cwd: "/private/tmp/wt-1" }]))
      .toEqual({ ok: true, paneId: "a" });
    expect(resolveOriginFocus({ worktree: "/private/tmp/wt-1" }, [{ paneId: "a", cwd: "/tmp/wt-1" }]))
      .toEqual({ ok: true, paneId: "a" });
  });

  test("a pane with no cwd never matches a worktree origin", () => {
    expect(resolveOriginFocus({ worktree: "/w" }, [{ paneId: "a" }]))
      .toEqual({ ok: false, reason: "no live pane matches the origin worktree" });
  });
});

describe("normalizeWorktreePath", () => {
  test("strips trailing slashes", () => {
    expect(normalizeWorktreePath("/a/b/")).toBe("/a/b");
    expect(normalizeWorktreePath("/a/b///")).toBe("/a/b");
  });

  test("rewrites the macOS /tmp symlink to its real /private/tmp target", () => {
    expect(normalizeWorktreePath("/tmp")).toBe("/private/tmp");
    expect(normalizeWorktreePath("/tmp/wt-1/board")).toBe("/private/tmp/wt-1/board");
  });

  test("leaves an already-resolved or unrelated path alone", () => {
    expect(normalizeWorktreePath("/private/tmp/wt-1")).toBe("/private/tmp/wt-1");
    expect(normalizeWorktreePath("/Users/matt/repo")).toBe("/Users/matt/repo");
    expect(normalizeWorktreePath("/tmpfoo")).toBe("/tmpfoo");
  });
});

describe("panesForOrigin", () => {
  test("a direct paneId never fetches the pane list", async () => {
    let calls = 0;
    const listPanes = async () => {
      calls++;
      return { ok: true, data: { panes: [] } };
    };
    const result = await panesForOrigin({ paneId: "p1" }, listPanes);
    expect(result).toEqual({ panes: [], fetchFailed: false });
    expect(calls).toBe(0);
  });

  test("no origin at all never fetches the pane list", async () => {
    let calls = 0;
    const listPanes = async () => {
      calls++;
      return { ok: true, data: { panes: [] } };
    };
    await panesForOrigin(undefined, listPanes);
    await panesForOrigin({}, listPanes);
    expect(calls).toBe(0);
  });

  test("a worktree-only origin fetches the pane list and returns its panes", async () => {
    let calls = 0;
    const panes = [{ paneId: "b", cwd: "/w" }];
    const listPanes = async () => {
      calls++;
      return { ok: true, data: { panes } };
    };
    const result = await panesForOrigin({ worktree: "/w" }, listPanes);
    expect(calls).toBe(1);
    expect(result).toEqual({ panes, fetchFailed: false });
  });

  test("a failed fetch resolves to an empty pane list flagged as failed, rather than throwing", async () => {
    const listPanes = async () => ({ ok: false, data: null });
    const result = await panesForOrigin({ worktree: "/w" }, listPanes);
    expect(result).toEqual({ panes: [], fetchFailed: true });
  });
});
