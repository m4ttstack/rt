import { describe, expect, test } from "bun:test";
import { resolveLivePane, type LivePane } from "../pane-resolve-live.ts";

const pane = (over: Partial<LivePane>): LivePane => ({
  paneRef: "w1:p1", sockPath: "/tmp/h.sock", workspaceId: "w1",
  agentStatus: "idle", ...over,
});

describe("resolveLivePane", () => {
  test("layer 1: paneId wins when live", () => {
    const panes = [pane({ paneRef: "w1:p1" }), pane({ paneRef: "w1:p2", sessionId: "s-a" })];
    expect(resolveLivePane({ paneId: "w1:p1", sessionId: "s-a" }, panes)?.paneRef).toBe("w1:p1");
  });
  test("layer 2: dead paneId falls through to session id", () => {
    const panes = [pane({ paneRef: "w1:p8", sessionId: "s-a" })];
    expect(resolveLivePane({ paneId: "w1:p6", sessionId: "s-a" }, panes)?.paneRef).toBe("w1:p8");
  });
  test("layer 3: unique worktree match", () => {
    const panes = [pane({ paneRef: "w1:p3", cwd: "/private/tmp/wt" })];
    expect(resolveLivePane({ paneId: "w1:p6", worktree: "/tmp/wt" }, panes)?.paneRef).toBe("w1:p3");
  });
  test("layer 3 never claims a pane that belongs to another session", () => {
    // A dead board agent's cwd is the shared review checkout; the one live pane
    // there is the operator's own conversation. Matching it would resurrect the
    // dead agent as live (and every other dead agent launched in that cwd).
    const panes = [pane({ paneRef: "w7:pY", cwd: "/x", sessionId: "s-operator" })];
    expect(resolveLivePane({ paneId: "wE9:p1", sessionId: "s-dead", worktree: "/x" }, panes)).toBeNull();
  });
  test("layer 3 still matches a pane whose session is not yet known", () => {
    const panes = [pane({ paneRef: "w1:p3", cwd: "/x" })];
    expect(resolveLivePane({ paneId: "w1:p6", sessionId: "s-a", worktree: "/x" }, panes)?.paneRef).toBe("w1:p3");
  });
  test("layer 3 with no session hint still matches by cwd alone", () => {
    const panes = [pane({ paneRef: "w1:p3", cwd: "/x", sessionId: "s-other" })];
    expect(resolveLivePane({ worktree: "/x" }, panes)?.paneRef).toBe("w1:p3");
  });
  test("ambiguous worktree resolves null", () => {
    const panes = [pane({ paneRef: "w1:p3", cwd: "/x" }), pane({ paneRef: "w1:p4", cwd: "/x" })];
    expect(resolveLivePane({ worktree: "/x" }, panes)).toBeNull();
  });
  test("no hints, no match: null", () => {
    expect(resolveLivePane({}, [pane({})])).toBeNull();
  });
  test("bare hint does not match bg pane", () => {
    const panes = [pane({ paneRef: "bg:w1:p1" })];
    expect(resolveLivePane({ paneId: "w1:p1" }, panes)).toBeNull();
  });
  test("bg: hint does not match bare pane", () => {
    const panes = [pane({ paneRef: "w1:p1" })];
    expect(resolveLivePane({ paneId: "bg:w1:p1" }, panes)).toBeNull();
  });
});
