import { describe, expect, test } from "bun:test";
import { createPaneDriveGuard, createRelocationWatcher, type RelocationWatcherDeps } from "../relocation-announce.ts";
import { driveRelocationAccept } from "../trust-accept.ts";
import type { LivePane } from "../pane-resolve-live.ts";
import { createPaneHandlers } from "../handlers/pane.ts";

const TREE_A = "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/aragorn";
const TREE_B = "/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/boromir";
// trust-dialog.test.ts's ATTENDED_ENTER capture from the echo down, path substituted in the echo and reason lines (same length keeps the rule widest).
const attended = (path: string) => [
  `⏺ Entering worktree(${path})`,
  "",
  "────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  " Tool use",
  "",
  `   Entering worktree(${path})`,
  "   │ Creates an isolated worktree (via git or configured hooks) and switches the session into it",
  "",
  ` │ permission-root relocation to "${path}" — a model-supplied`,
  " │ worktree outside .claude/worktrees/",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. No",
  "",
  " Esc to cancel · Tab to amend",
].join("\n");

const pane: LivePane ={ paneRef: "7", sockPath: "/s", workspaceId: "w", agentStatus: "blocked", sessionId: "s1", cwd: "/repo" };
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
  describe("pane identity: session first, pane id as the cross-check", () => {
    const main: LivePane = { paneRef: "w1:p1", sockPath: "/main", workspaceId: "w1", agentStatus: "blocked", sessionId: "s-main" };
    const bg: LivePane = { paneRef: "bg:w1:p1", sockPath: "/bg", workspaceId: "w1", agentStatus: "blocked", sessionId: "s-bg" };
    const both = async () => [main, bg];
    const at = (paneId: string | undefined, sessionId: string) => ({ sessionId, ...(paneId ? { paneId } : {}), tool: "EnterWorktree" as const, path: "/pool/t1", cwd: "/repo" });

    test("a bg session announcing its bg ref schedules on the bg pane, and the herd check sees that pane", async () => {
      const herdChecked: string[] = [];
      const { w } = watcher({ snapshot: both, isHerdPane: (ref) => { herdChecked.push(ref); return false; } });
      expect(await w.announce(at("bg:w1:p1", "s-bg"))).toEqual({ scheduled: true, pane: "bg:w1:p1" });
      expect(herdChecked).toEqual(["bg:w1:p1"]);
    });
    test("a bare pane id from a bg session never lands on the main server's same-id pane", async () => {
      expect(await watcher({ snapshot: both }).w.announce(at("w1:p1", "s-bg"))).toEqual({ scheduled: false, pane: null, reason: "no-pane" });
    });
    test("a pane id that disagrees with the session's pane is refused", async () => {
      expect(await watcher({ snapshot: both }).w.announce(at("bg:w1:p1", "s-main"))).toEqual({ scheduled: false, pane: null, reason: "no-pane" });
    });
    test("no pane reports the session: the pane id is used only when that pane reports no session", async () => {
      const bare: LivePane = { paneRef: "w2:p4", sockPath: "/main", workspaceId: "w2", agentStatus: "blocked" };
      const snapshot = async () => [main, bg, bare];
      expect(await watcher({ snapshot }).w.announce(at("w2:p4", "s-new"))).toEqual({ scheduled: true, pane: "w2:p4" });
      expect(await watcher({ snapshot }).w.announce(at("bg:w1:p1", "s-new"))).toEqual({ scheduled: false, pane: null, reason: "no-pane" });
      expect(await watcher({ snapshot }).w.announce(at(undefined, "s-new"))).toEqual({ scheduled: false, pane: null, reason: "no-pane" });
    });
  });
  test("an unregistered outcome stops the watch: the human answers", async () => {
    const { w, seen } = watcher({ outcomes: ["unregistered", "accepted"] });
    await w.announce({ sessionId: "s1", tool: "EnterWorktree", path: "/pool/t1", cwd: "/repo" });
    await settle();
    expect(seen.length).toBe(1);
  });
});

describe("per-pane single-flight drive guard", () => {
  test("a second drive on a pane already in flight reports no-dialog without running; other panes and later drives run", async () => {
    const guard = createPaneDriveGuard();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const ran: string[] = [];
    const first = guard("w1:p1", async () => { ran.push("first"); await held; return "accepted" as const; });
    expect(await guard("w1:p1", async () => { ran.push("second"); return "accepted" as const; })).toBe("no-dialog");
    expect(await guard("bg:w1:p1", async () => { ran.push("other"); return "accepted" as const; })).toBe("accepted");
    release();
    expect(await first).toBe("accepted");
    expect(await guard("w1:p1", async () => { ran.push("later"); return "stuck" as const; })).toBe("stuck");
    expect(ran).toEqual(["first", "other", "later"]);
  });
  test("a drive that throws still frees the pane", async () => {
    const guard = createPaneDriveGuard();
    await expect(guard("w1:p1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await guard("w1:p1", async () => "accepted" as const)).toBe("accepted");
  });
  test("two concurrent real drives on one dialog press enter once", async () => {
    const guard = createPaneDriveGuard();
    const screen = attended(TREE_A);
    let cleared = false;
    const keys: string[][] = [];
    const herdr = (async (method: string, params: { keys?: string[] }) => {
      if (method === "pane.read") return { ok: true, result: { read: { text: cleared ? "$ \n" : screen } } };
      if (method === "pane.send_keys") {
        keys.push(params.keys!);
        await Bun.sleep(5);
        if (params.keys!.includes("enter")) cleared = true;
        return { ok: true, result: {} };
      }
      return { ok: false, code: "invalid_request", message: method };
    }) as never;
    const drive = () => guard("w1:p1", () => driveRelocationAccept({
      herdr, sock: {}, pane: "w1:p1", context: {}, settleMs: 1, stepMs: 1, isRegisteredTree: (p) => p === TREE_A,
    }));
    const outcomes = await Promise.all([drive(), drive()]);
    expect(outcomes.sort()).toEqual(["accepted", "no-dialog"]);
    expect(keys).toEqual([["enter"]]);
  });
});

describe("pane:announce-relocation handler", () => {
  test("a non-string paneId is refused before the watcher sees it", async () => {
    const announced: unknown[] = [];
    const relocation = { announce: async (a: unknown) => { announced.push(a); return { scheduled: false as const, pane: null, reason: "no-pane" as const }; } };
    const h = createPaneHandlers({ db: {} as never, repoIndex: () => ({}), relocation });
    expect(await h["pane:announce-relocation"]({ sessionId: "s1", paneId: 7, tool: "EnterWorktree", cwd: "/repo" }))
      .toEqual({ ok: false, error: "paneId must be a string" });
    expect(announced).toEqual([]);
  });
});
