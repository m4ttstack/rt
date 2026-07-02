import { describe, expect, it } from "vitest";

import { applyMrDetail, mapEvent, mapMrListNode, mapPipeline } from "../server/gitlab/map.js";
import type { RawMrDetail, RawMrListNode } from "../server/gitlab/raw-types.js";

const RAW_LIST: RawMrListNode = {
  iid: "42",
  title: 'Revert "Add thing"',
  state: "MERGED",
  createdAt: "2026-05-10T08:00:00.000Z",
  updatedAt: "2026-05-12T08:00:00.000Z",
  mergedAt: "2026-05-12T00:00:00.000Z",
  author: { username: "bob" },
  project: { fullPath: "org/app" },
  sourceBranch: "feature/thing",
};

const RAW_DETAIL: RawMrDetail = {
  description: "Closes ACME-123",
  diffStatsSummary: { additions: 12, deletions: 34, fileCount: 2 },
  diffStats: [{ path: "src/a.ts", additions: 12, deletions: 34 }],
  labels: { nodes: [{ title: "backend" }, { title: "revert" }] },
  approvedBy: { nodes: [{ username: "alice" }, { username: null }] },
  notes: {
    nodes: [
      { system: false, createdAt: "2026-05-11T09:00:00.000Z", author: { username: "alice" }, position: { __typename: "DiffPosition" } },
      { system: false, createdAt: "2026-05-11T10:00:00.000Z", author: { username: "alice" }, position: null },
      { system: true, createdAt: "2026-05-11T10:05:00.000Z", author: null, position: null },
    ],
  },
};

describe("mapMrListNode", () => {
  const m = mapMrListNode(RAW_LIST);

  it("normalizes scalars and state casing, defaults detail to empty", () => {
    expect(m.iid).toBe(42);
    expect(m.state).toBe("merged");
    expect(m.projectPath).toBe("org/app");
    expect(m.authorUsername).toBe("bob");
    expect(m.additions).toBe(0);
    expect(m.labels).toEqual([]);
    expect(m.notes).toEqual([]);
    expect(m.approvedByUsernames).toEqual([]);
  });
});

describe("applyMrDetail", () => {
  const m = applyMrDetail(mapMrListNode(RAW_LIST), RAW_DETAIL);

  it("merges diff stats and flattens labels, filtering null approvers", () => {
    expect(m.additions).toBe(12);
    expect(m.deletions).toBe(34);
    expect(m.labels).toEqual(["backend", "revert"]);
    expect(m.approvedByUsernames).toEqual(["alice"]);
  });

  it("detects inline notes via position and preserves system flag", () => {
    expect(m.notes).toHaveLength(3);
    expect(m.notes[0]!.inline).toBe(true);
    expect(m.notes[1]!.inline).toBe(false);
    expect(m.notes[2]!.system).toBe(true);
  });

  it("defaults missing detail fields to zero/empty", () => {
    const bare = applyMrDetail(mapMrListNode(RAW_LIST), {
      description: null,
      diffStatsSummary: null,
      diffStats: null,
      labels: null,
      approvedBy: null,
      notes: null,
    });
    expect(bare.additions).toBe(0);
    expect(bare.labels).toEqual([]);
    expect(bare.approvedByUsernames).toEqual([]);
    expect(bare.notes).toEqual([]);
  });
});

describe("mapPipeline / mapEvent", () => {
  it("lowercases pipeline status and attaches attribution", () => {
    const p = mapPipeline({ id: 1, status: "SUCCESS", created_at: "2026-05-10T00:00:00Z" }, "org/app", "alice");
    expect(p).toEqual({ projectPath: "org/app", username: "alice", status: "success", createdAt: "2026-05-10T00:00:00Z" });
  });

  it("maps a push event to its user", () => {
    const e = mapEvent({ action_name: "pushed to", created_at: "2026-05-10T00:00:00Z" }, "bob");
    expect(e).toEqual({ username: "bob", createdAt: "2026-05-10T00:00:00Z" });
  });
});
