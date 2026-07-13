import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@forge-glance/sdk";
import { buildBoard, projectPathFromWebUrl } from "../data.ts";
import { SnapshotCache } from "../cache.ts";
import type { BoardConfig } from "../config.ts";
import { extractTicketId } from "../ticket.ts";

const config: BoardConfig = {
  gitlabHost: "https://gitlab.com",
  projects: ["org/repo-a", "org/repo-b"],
  members: [{ username: "alice" }, { username: "bob" }],
  title: "Test board",
  port: 0,
};

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    id: "gitlab:1",
    iid: 1,
    repositoryId: "gitlab:42",
    title: "An MR",
    description: null,
    state: "opened",
    draft: false,
    conflicts: false,
    webUrl: "https://gitlab.com/org/repo-a/-/merge_requests/1",
    sourceBranch: "feat/x",
    targetBranch: "main",
    createdAt: "2026-07-09T12:00:00Z",
    updatedAt: "2026-07-10T12:00:00Z",
    sha: null,
    author: { id: "gitlab:7", username: "alice", name: "Alice", avatarUrl: null },
    assignees: [],
    reviewers: [],
    roles: ["author"],
    pipeline: null,
    unresolvedThreadCount: 0,
    approvalsLeft: 1,
    approved: false,
    approvedBy: [],
    diffStats: null,
    detailedMergeStatus: null,
    autoMergeEnabled: false,
    autoMergeStrategy: null,
    mergeUser: null,
    mergeAfter: null,
    divergedCommitsCount: null,
    rebaseInProgress: false,
    mergeOngoing: false,
    inProgressMergeCommitSha: null,
    mergeError: null,
    shouldBeRebased: false,
    mergeabilityChecks: [],
    blockingMergeRequestsCount: 0,
    approvalsRequired: 1,
    squash: false,
    squashOnMerge: false,
    mergeTrainIndex: null,
    ...overrides,
  } as PullRequest;
}

describe("extractTicketId", () => {
  test("exact branch segment", () => {
    expect(extractTicketId("feature/ACME-1287", "whatever")).toBe("ACME-1287");
  });
  test("prefixed branch segment", () => {
    expect(extractTicketId("feature/ACME-1287-add-photos", "whatever")).toBe("ACME-1287");
  });
  test("falls back to title prefix", () => {
    expect(extractTicketId("some-branch", "ACME-2388: simplify things")).toBe("ACME-2388");
  });
  test("null when nothing matches", () => {
    expect(extractTicketId("main", "fix stuff")).toBeNull();
  });
});

describe("projectPathFromWebUrl", () => {
  test("extracts group/project", () => {
    expect(projectPathFromWebUrl("https://gitlab.com/org/sub/repo/-/merge_requests/7", "https://gitlab.com")).toBe(
      "org/sub/repo",
    );
  });
  test("null for foreign host", () => {
    expect(projectPathFromWebUrl("https://other.com/org/repo/-/merge_requests/7", "https://gitlab.com")).toBeNull();
  });
});

describe("buildBoard", () => {
  test("keeps only member-authored, open, non-draft MRs in configured projects", () => {
    const mrs = buildBoard(
      [
        pr({ iid: 1, author: { id: "a", username: "alice", name: "Alice", avatarUrl: null } }),
        pr({ iid: 2, author: { id: "b", username: "bob", name: "Bob", avatarUrl: null } }),
        pr({ iid: 3, author: { id: "c", username: "carol", name: "Carol", avatarUrl: null } }), // not a member
        pr({ iid: 4, draft: true }),
        pr({ iid: 5, state: "merged" }),
        pr({ iid: 6, webUrl: "https://gitlab.com/other/repo/-/merge_requests/6" }), // wrong project
      ],
      config,
    );
    expect(mrs.map((m) => m.iid).sort()).toEqual([1, 2]);
  });

  test("tags each MR with author, createdAt, and derived pipelineState", () => {
    const [mr] = buildBoard([pr({ createdAt: "2026-07-01T00:00:00Z" })], config);
    expect(mr!.author.username).toBe("alice");
    expect(mr!.createdAt).toBe("2026-07-01T00:00:00Z");
    expect(mr!.pipelineState).toBe("none"); // pipeline: null
  });
});

describe("SnapshotCache", () => {
  test("caches within TTL and revalidates after", async () => {
    let calls = 0;
    let clock = 1_000;
    const cache = new SnapshotCache(
      async () => {
        calls++;
        return [pr({ iid: calls })].map(() => ({ iid: calls } as any));
      },
      () => clock,
      60_000,
    );
    const first = await cache.get();
    expect(first.mrs).toHaveLength(1);
    expect(calls).toBe(1);
    await cache.get();
    expect(calls).toBe(1); // within TTL
    clock += 61_000;
    await cache.get(); // serves stale, kicks background refresh
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  });
});
