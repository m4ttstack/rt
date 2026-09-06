import { describe, expect, test } from "bun:test";
import { panesForOrigin, resolveOriginFocus } from "../gates/focus.ts";

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
});

describe("panesForOrigin", () => {
  test("a direct paneId never fetches the pane list", async () => {
    let calls = 0;
    const listPanes = async () => {
      calls++;
      return { ok: true, data: { panes: [] } };
    };
    const panes = await panesForOrigin({ paneId: "p1" }, listPanes);
    expect(panes).toEqual([]);
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
    expect(result).toEqual(panes);
  });

  test("a failed fetch resolves to an empty pane list rather than throwing", async () => {
    const listPanes = async () => ({ ok: false, data: null });
    const result = await panesForOrigin({ worktree: "/w" }, listPanes);
    expect(result).toEqual([]);
  });
});
