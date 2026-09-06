import { describe, expect, test } from "bun:test";
import { resolveOriginFocus } from "../gates/focus.ts";

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
