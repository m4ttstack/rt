import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@workforge/glance-sdk";
import { buildBoard, buildRoster, projectPathFromWebUrl, type BoardMR } from "../data.ts";
import { SnapshotCache } from "../cache.ts";
import type { BoardConfig } from "../config.ts";
import { extractTicketId } from "../ticket.ts";

const config: BoardConfig = {
  gitlabHost: "https://gitlab.com",
  projects: ["org/repo-a", "org/repo-b"],
  members: [{ username: "alice" }, { username: "bob" }],
  defaultMember: "all",
  staleAfterDays: 90,
  ticketPrefixes: [],
  title: "Test board",
  port: 0,
  reviewCwd: "",
  reviewsWorkspace: "reviews",
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

  test("drops MRs with no activity within the stale window, keeps recently-updated ones", () => {
    const now = Date.parse("2026-07-13T00:00:00Z");
    const mrs = buildBoard(
      [
        pr({ iid: 1, updatedAt: "2026-07-10T00:00:00Z" }), // 3 days ago — fresh
        pr({ iid: 2, updatedAt: "2026-01-01T00:00:00Z" }), // ~193 days ago — stale
      ],
      config, // staleAfterDays: 90
      now,
    );
    expect(mrs.map((m) => m.iid)).toEqual([1]);
  });

  test("ticketPrefixes filter: keeps only matching prefixes, drops other teams and untagged", () => {
    const withPrefix = { ...config, ticketPrefixes: ["CV"] };
    const mrs = buildBoard(
      [
        pr({ iid: 1, sourceBranch: "feature/ACME-2369-thing" }), // CV — keep
        pr({ iid: 2, sourceBranch: "ing-595-transition", title: "ING work" }), // ING — drop
        pr({ iid: 3, sourceBranch: "hotfix", title: "NO-TICKET quick fix" }), // untagged — drop
        pr({ iid: 4, sourceBranch: "x", title: "ACME-2400: titled" }), // CV via title — keep
      ],
      withPrefix,
    );
    expect(mrs.map((m) => m.iid).sort()).toEqual([1, 4]);
  });

  test("empty ticketPrefixes keeps everything regardless of ticket", () => {
    const mrs = buildBoard(
      [pr({ iid: 1, sourceBranch: "ing-1-x", title: "ING" }), pr({ iid: 2, sourceBranch: "no-ticket" })],
      config, // ticketPrefixes: []
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

describe("buildRoster", () => {
  const members = [{ username: "alice" }, { username: "bob", name: "Bobby" }, { username: "carol" }];

  function boardMr(username: string): BoardMR {
    return { author: { id: username, username, name: username, avatarUrl: null } } as unknown as BoardMR;
  }

  test("returns members in config order with resolved names and per-member counts", () => {
    const mrs = [boardMr("alice"), boardMr("bob"), boardMr("alice")];
    const names = new Map<string, string | null>([["alice", "Alice Resolved"]]);
    const roster = buildRoster(members, mrs, names);
    expect(roster.map((r) => r.username)).toEqual(["alice", "bob", "carol"]);
    expect(roster[0]).toEqual({ username: "alice", name: "Alice Resolved", count: 2 });
  });

  test("member with zero MRs still appears with count 0", () => {
    const roster = buildRoster(members, [boardMr("alice")], new Map());
    expect(roster.find((r) => r.username === "carol")).toEqual({ username: "carol", name: null, count: 0 });
  });

  test("name falls back from names map to member.name to null", () => {
    const roster = buildRoster(members, [], new Map([["alice", "Alice Resolved"]]));
    expect(roster.find((r) => r.username === "alice")?.name).toBe("Alice Resolved"); // from names map
    expect(roster.find((r) => r.username === "bob")?.name).toBe("Bobby"); // falls back to member.name
    expect(roster.find((r) => r.username === "carol")?.name).toBeNull(); // falls back to null
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

  // A config change makes the snapshot outdated but not useless. Readers must
  // keep getting the old data while the refetch (tens of seconds against
  // GitLab) runs, rather than blocking on it.
  test("markStale() serves the current snapshot while revalidating", async () => {
    let calls = 0;
    let release!: () => void;
    const cache = new SnapshotCache(
      async () => {
        calls++;
        const n = calls;
        if (n === 2) await new Promise<void>((r) => (release = r)); // hold the refetch open
        return [{ iid: n } as any];
      },
      () => 1_000, // frozen clock: markStale is the only thing forcing a refetch
      60_000,
    );
    expect((await cache.get()).mrs).toEqual([{ iid: 1 } as any]);

    cache.markStale();
    const during = await cache.get();
    expect(during.mrs).toEqual([{ iid: 1 } as any]); // stale data, served immediately
    expect(calls).toBe(2); // ...and a refresh was kicked

    release();
    await new Promise((r) => setTimeout(r, 0));
    expect((await cache.get()).mrs).toEqual([{ iid: 2 } as any]);
  });

  // The manual refresh button means "I'll wait for genuinely fresh data".
  test("invalidate() still blocks until fresh data arrives", async () => {
    let calls = 0;
    const cache = new SnapshotCache(
      async () => {
        calls++;
        return [{ iid: calls } as any];
      },
      () => 1_000,
      60_000,
    );
    await cache.get();
    cache.invalidate();
    expect((await cache.get()).mrs).toEqual([{ iid: 2 } as any]); // fresh, not stale
    expect(calls).toBe(2);
  });

  // Toggling two members in a row: the second change lands while the first
  // one's refetch is still running, so that refetch used the old config.
  test("a change landing mid-refetch forces another refetch", async () => {
    let calls = 0;
    const gate: Array<() => void> = [];
    const cache = new SnapshotCache(
      async () => {
        calls++;
        const n = calls;
        await new Promise<void>((r) => gate.push(r));
        return [{ iid: n } as any];
      },
      () => 1_000,
      60_000,
    );
    const first = cache.get();
    gate[0]!();
    await first;
    expect(calls).toBe(1);

    cache.markStale();
    await cache.get(); // kicks refetch #2, reading config as it stands now
    expect(calls).toBe(2);

    cache.markStale(); // config changes again *while* #2 is in flight
    gate[1]!(); // #2 lands, but its data predates that second change
    await new Promise((r) => setTimeout(r, 0));

    await cache.get(); // so #2 can't be trusted as current — refetch again
    expect(calls).toBe(3);
  });
});
