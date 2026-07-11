import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@forge-glance/sdk";
import { buildGroups, projectPathFromWebUrl } from "../data.ts";
import { SnapshotCache } from "../cache.ts";
import type { BoardConfig } from "../config.ts";

const config: BoardConfig = {
  gitlabHost: "https://gitlab.com",
  username: "matt",
  projects: ["org/repo-a", "org/repo-b"],
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
    author: { id: "gitlab:7", username: "matt", name: "Matt", avatarUrl: null },
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
  const { extractTicketId } = require("../ticket.ts");
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
    expect(projectPathFromWebUrl("https://gitlab.com/org/sub/repo/-/merge_requests/7", "https://gitlab.com"))
      .toBe("org/sub/repo");
  });
  test("rejects other hosts and malformed urls", () => {
    expect(projectPathFromWebUrl("https://github.com/org/repo/pull/1", "https://gitlab.com")).toBeNull();
    expect(projectPathFromWebUrl("https://gitlab.com/org/repo", "https://gitlab.com")).toBeNull();
  });
});

describe("buildGroups", () => {
  test("filters drafts, other authors, and unconfigured projects", () => {
    const groups = buildGroups(
      [
        pr({ title: "mine" }),
        pr({ title: "draft", draft: true }),
        pr({ title: "someone elses", author: { id: "gitlab:8", username: "alice", name: "Alice", avatarUrl: null } }),
        pr({ title: "other project", webUrl: "https://gitlab.com/org/other/-/merge_requests/2" }),
      ],
      config,
    );
    expect(groups.map((g) => g.projectPath)).toEqual(["org/repo-a", "org/repo-b"]);
    expect(groups[0]!.mrs.map((m) => m.title)).toEqual(["mine"]);
    expect(groups[1]!.mrs).toEqual([]);
  });

  test("sorts newest-updated first within a repo", () => {
    const groups = buildGroups(
      [
        pr({ title: "old", updatedAt: "2026-07-01T00:00:00Z" }),
        pr({ title: "new", updatedAt: "2026-07-10T00:00:00Z" }),
      ],
      config,
    );
    expect(groups[0]!.mrs.map((m) => m.title)).toEqual(["new", "old"]);
  });

  test("produces MRDashboardProps with review and pipeline fields", () => {
    const groups = buildGroups(
      [pr({
        approvalsRequired: 2,
        approvalsLeft: 1,
        approvedBy: [{ id: "gitlab:9", username: "bob", name: "Bob", avatarUrl: null }],
        pipeline: { id: "gitlab:pipeline:9", status: "success", createdAt: null, webUrl: null, jobs: [] },
      })],
      config,
    );
    const props = groups[0]!.mrs[0]!;
    expect(props.reviews.required).toBe(2);
    expect(props.reviews.given).toBe(1);
    expect(props.pipeline?.status).toBe("success");
    expect(props.webUrl).toContain("/merge_requests/1");
  });
});

describe("SnapshotCache", () => {
  test("serves cached within TTL, refreshes past TTL, dedupes concurrent refreshes", async () => {
    let clock = 0;
    let fetches = 0;
    const cache = new SnapshotCache(
      async () => {
        fetches++;
        return [];
      },
      () => clock,
      60_000,
    );
    await cache.get();
    await cache.get();
    expect(fetches).toBe(1);

    clock = 61_000;
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    // Stale snapshots return immediately; the background refresh is shared.
    await Bun.sleep(0);
    expect(fetches).toBe(2);
  });

  test("keeps last good data and stamps error on failed refresh", async () => {
    let clock = 0;
    let fail = false;
    const cache = new SnapshotCache(
      async () => {
        if (fail) throw new Error("boom");
        return [{ projectPath: "org/repo-a", mrs: [] }];
      },
      () => clock,
      60_000,
    );
    await cache.get();
    fail = true;
    clock = 61_000;
    await cache.get(); // triggers background refresh that fails
    await Bun.sleep(0);
    const snap = await cache.get();
    expect(snap.groups.length).toBe(1);
    expect(snap.fetchError).toBe("boom");
  });

  test("cold start with fetch failing yields empty snapshot with error", async () => {
    const cache = new SnapshotCache(async () => {
      throw new Error("down");
    });
    const snap = await cache.get();
    expect(snap.groups).toEqual([]);
    expect(snap.fetchError).toBe("down");
  });
});
