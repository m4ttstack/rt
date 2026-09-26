import { describe, expect, test } from "bun:test";
import { createRelocationWatcher, type RelocationWatcherDeps } from "../relocation-announce.ts";
import type { LivePane } from "../pane-resolve-live.ts";

const pane: LivePane = { paneRef: "7", sockPath: "/s", workspaceId: "w", agentStatus: "blocked", sessionId: "s1", cwd: "/repo" };
const log = { info() {}, warn() {}, debug() {} };

function watcher(over: Partial<RelocationWatcherDeps> & { outcomes?: Array<"no-dialog" | "accepted" | "unregistered" | "stuck">; seen?: Array<(p: string) => boolean> } = {}) {
  const outcomes = [...(over.outcomes ?? ["accepted"])];
  const seen: Array<(p: string) => boolean> = over.seen ?? [];
  const deps: RelocationWatcherDeps = {
    snapshot: async () => [pane],
    drive: async (_p, allowed) => { seen.push(allowed); return outcomes.shift() ?? "no-dialog"; },
    isRegisteredTree: (p) => p === "/pool/t1" || p === "/pool/t2",
    isHerdPane: () => false,
    enabled: () => true,
    realpath: (p) => p,
    log,
    windowMs: 50,
    pollMs: 5,
    sleep: async () => {},
    ...over,
  };
  return { w: createRelocationWatcher(deps), seen };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("relocation watcher", () => {
  test("schedules a watch for the pane the session id resolves to", async () => {
    const { w } = watcher();
    expect(await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: true, pane: "7" });
  });
  test("no matching pane, a herd pane, or the setting off: nothing is scheduled", async () => {
    expect(await watcher({ snapshot: async () => [] }).w.announce({ sessionId: "zz", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: false, pane: null, reason: "no-pane" });
    expect(await watcher({ isHerdPane: () => true }).w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: false, pane: "7", reason: "herd-pane" });
    expect(await watcher({ enabled: () => false }).w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" })).toEqual({ scheduled: false, pane: "7", reason: "disabled" });
  });
  test("EnterWorktree allows only the announced registered path", async () => {
    const { w, seen } = watcher();
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(seen[0]!("/pool/t1")).toBe(true);
    expect(seen[0]!("/pool/t2")).toBe(false);
    expect(seen[0]!("/elsewhere")).toBe(false);
  });
  test("EnterWorktree without a path (name mode) schedules nothing: the tree does not exist yet", async () => {
    const { w, seen } = watcher();
    expect(await w.announce({ sessionId: "s1", tool: "EnterWorktree", cwd: "/repo" })).toEqual({ scheduled: false, pane: "7", reason: "awaiting-path" });
    await settle();
    expect(seen).toEqual([]);
  });
  test("the provisioned-path announcement that follows name mode schedules the watch for that path only", async () => {
    const { w, seen } = watcher();
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", cwd: "/repo" });
    expect(await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t2", cwd: "/repo" })).toEqual({ scheduled: true, pane: "7" });
    await settle();
    expect(seen[0]!("/pool/t2")).toBe(true);
    expect(seen[0]!("/pool/t1")).toBe(false);
  });
  test("polls while there is no dialog, stops on accepted, and gives up at the window", async () => {
    const a = watcher({ outcomes: ["no-dialog", "no-dialog", "accepted", "accepted"] });
    await a.w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(a.seen.length).toBe(3);
    const b = watcher({ outcomes: [], windowMs: 10 });
    await b.w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(b.seen.length).toBeGreaterThan(0);
  });
  test("an unregistered outcome stops the watch: the human answers", async () => {
    const { w, seen } = watcher({ outcomes: ["unregistered", "accepted"] });
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(seen.length).toBe(1);
  });
});
