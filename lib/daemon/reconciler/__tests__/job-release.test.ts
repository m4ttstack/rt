import { describe, test, expect } from "bun:test";
import type { HerdJobRow, HerdRow, HerdJobStatus } from "../../herd-store.ts";
import type { TreeRecord } from "../../../worktree/registry.ts";
import { herdJobTreeHold } from "../job-release.ts";

const TREE = "/pool/rt/saruman";

function rec(owner: string | undefined): TreeRecord {
  return { name: "saruman", path: TREE, kind: "ephemeral", state: "claimed", branch: "rt-175", disposal: "job", owner, createdAt: "2026-09-14T00:00:00Z" };
}

function herd(id: string, status: HerdRow["status"]): HerdRow {
  return {
    id, repo: "rt", room: "r", workspace: "w", shepherdSession: "s", shepherdHandle: "h", shepherdPane: null,
    herdrSocket: null, hidden: false, status, createdAt: 0, wrappedAt: status === "wrapped" ? 1 : null,
  };
}

function job(herdId: string, name: string, status: HerdJobStatus, updatedAt: number, worktree = TREE, branch: string | null = "rt-175"): HerdJobRow {
  return {
    herd: herdId, name, worktree, branch, tree: "saruman", pane: null, agentSession: null, agentId: null,
    handle: name, status, disposable: false, lastGate: null, lastReport: null, createdAt: 0, updatedAt,
  };
}

function store(herds: HerdRow[], jobs: HerdJobRow[]) {
  return {
    get: (id: string) => herds.find((h) => h.id === id) ?? null,
    jobs: (id: string) => jobs.filter((j) => j.herd === id),
  };
}

describe("herdJobTreeHold", () => {
  test("a wrapped herd releases its tree whatever its job rows say", () => {
    const s = store([herd("h1", "wrapped")], [job("h1", "rt-175", "active", 5)]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBeNull();
  });

  test("an active herd holds a tree whose job is still running and names the job", () => {
    const s = store([herd("h1", "active")], [job("h1", "rt-175", "at-gate", 5)]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBe("herd job h1/rt-175 is at-gate");
  });

  test.each(["closed", "crashed"] as const)("an active herd releases a tree whose job is %s", (status) => {
    const s = store([herd("h1", "active")], [job("h1", "rt-175", status, 5)]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBeNull();
  });

  test("a done job with its herd still active stays held", () => {
    const s = store([herd("h1", "active")], [job("h1", "rt-175", "done", 5)]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBe("herd job h1/rt-175 is done");
  });

  test("a pool path reused inside one herd judges by the job on the tree's branch, not the newest row", () => {
    // The earlier job's pane closing bumps its row after the later job claimed the slot.
    const s = store([herd("h1", "active")], [job("h1", "rt-144", "closed", 9, TREE, "rt-144"), job("h1", "rt-175", "active", 5)]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBe("herd job h1/rt-175 is active");
    const ended = store([herd("h1", "active")], [job("h1", "rt-144", "active", 9, TREE, "rt-144"), job("h1", "rt-175", "closed", 5)]);
    expect(herdJobTreeHold(ended, rec("herd:h1"))).toBeNull();
  });

  test("any live job on the tree's branch holds it", () => {
    const s = store([herd("h1", "active")], [job("h1", "rt-175", "closed", 9), job("h1", "rt-175b", "at-gate", 5)]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBe("herd job h1/rt-175b is at-gate");
  });

  test("an active herd with no job row on the tree yet holds it (spawn in flight)", () => {
    const s = store([herd("h1", "active")], [job("h1", "other", "closed", 5, "/pool/rt/other")]);
    expect(herdJobTreeHold(s, rec("herd:h1"))).toBe("herd h1 is active");
  });

  test("a herd with no row left releases the tree; nothing else will ever end it", () => {
    expect(herdJobTreeHold(store([], []), rec("herd:gone"))).toBeNull();
  });

  test("a job tree not owned by a herd stays with its owner", () => {
    expect(herdJobTreeHold(store([], []), rec("alex"))).toBe("job tree owned by alex");
    expect(herdJobTreeHold(store([], []), rec(undefined))).toBe("job tree with no owner");
  });
});
