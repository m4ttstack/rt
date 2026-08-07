import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@mattstack/glance";
import { aggregateSyncScope, boardDemand, buildBoard, buildRoster, projectPathFromWebUrl, stripDraftPrefix, type BoardMR } from "../data.ts";
import { SnapshotCache, type FetchResult } from "../cache.ts";
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
  rtRepos: {},
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

describe("stripDraftPrefix", () => {
  test("clears every marker gitlab recognises, in any case", () => {
    expect(stripDraftPrefix("Draft: fix the thing")).toBe("fix the thing");
    expect(stripDraftPrefix("draft: fix the thing")).toBe("fix the thing");
    expect(stripDraftPrefix("DRAFT: fix the thing")).toBe("fix the thing");
    expect(stripDraftPrefix("[Draft] fix the thing")).toBe("fix the thing");
    expect(stripDraftPrefix("(Draft) fix the thing")).toBe("fix the thing");
    expect(stripDraftPrefix("WIP: fix the thing")).toBe("fix the thing");
    expect(stripDraftPrefix("[WIP] fix the thing")).toBe("fix the thing");
  });

  test("keeps the ticket id that follows the marker", () => {
    expect(stripDraftPrefix("Draft: ACME-2382: fix the thing")).toBe("ACME-2382: fix the thing");
  });

  test("returns the title untouched when there is no marker, so callers can refuse to guess", () => {
    expect(stripDraftPrefix("fix the thing")).toBe("fix the thing");
    // Only a leading marker counts -- "draft" as a real word must survive.
    expect(stripDraftPrefix("rewrite the draft: attempt two")).toBe("rewrite the draft: attempt two");
    expect(stripDraftPrefix("add draft support")).toBe("add draft support");
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

  test("keeps your own drafts and flags them, but not anyone else's", () => {
    const mine: BoardConfig = { ...config, defaultMember: "alice" };
    const mrs = buildBoard(
      [
        pr({ iid: 1, draft: true, author: { id: "a", username: "alice", name: "Alice", avatarUrl: null } }),
        pr({ iid: 2, draft: true, author: { id: "b", username: "bob", name: "Bob", avatarUrl: null } }),
        pr({ iid: 3, author: { id: "a", username: "alice", name: "Alice", avatarUrl: null } }),
      ],
      mine,
    );
    expect(mrs.map((m) => m.iid).sort()).toEqual([1, 3]);
    expect(mrs.find((m) => m.iid === 1)?.isDraft).toBe(true);
    expect(mrs.find((m) => m.iid === 3)?.isDraft).toBe(false);
  });

  test("hides every draft when there is no single you to own them", () => {
    // defaultMember "all" means the board is showing the whole team, so there is
    // nobody whose drafts are "mine" to act on.
    const mrs = buildBoard([pr({ iid: 1, draft: true }), pr({ iid: 2 })], config);
    expect(mrs.map((m) => m.iid)).toEqual([2]);
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

  test("buildBoard maps rtRepo from config.rtRepos by project path, null when unmapped", () => {
    const testConfig = { ...config, projects: ["g/a", "g/b"], rtRepos: { "g/a": "repo-a" } };
    const prs = [
      pr({ webUrl: "https://gitlab.com/g/a/-/merge_requests/1" }),
      pr({ iid: 2, webUrl: "https://gitlab.com/g/b/-/merge_requests/2" }),
    ];
    const board = buildBoard(prs, testConfig);
    expect(board.find((m) => m.webUrl!.includes("/g/a/"))!.rtRepo).toBe("repo-a");
    expect(board.find((m) => m.webUrl!.includes("/g/b/"))!.rtRepo).toBeNull();
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

describe("boardDemand", () => {
  test("stable client id from port, full roster including hidden, fresh stamp", () => {
    const d = boardDemand({ ...config, port: 5980,
      members: [{ username: "a" }, { username: "b", hidden: true }] } as any);
    expect(d.client).toBe("mr-board:5980");
    expect(d.authors).toEqual(["a", "b"]);          // hidden is a display state, not a demand state
    expect(d.declaredAt).toBeGreaterThan(0);
  });
});

describe("aggregateSyncScope", () => {
  test("dataSyncedAt is the min syncedAt across reads", () => {
    const agg = aggregateSyncScope([{ syncedAt: 300 }, { syncedAt: 100 }, { syncedAt: 200 }]);
    expect(agg.dataSyncedAt).toBe(100);
  });

  test("no reads yields null syncedAt/windowDays and an empty uncovered list", () => {
    expect(aggregateSyncScope([])).toEqual({ dataSyncedAt: null, scopeUncovered: [], scopeWindowDays: null });
  });

  test("unions scope.uncovered across reads and takes the min windowDays", () => {
    const agg = aggregateSyncScope([
      { syncedAt: 100, scope: { authors: ["a"], windowDays: 30, uncovered: ["a"] } },
      { syncedAt: 200, scope: { authors: ["b"], windowDays: 14, uncovered: ["b", "a"] } },
    ]);
    expect(agg.scopeUncovered.sort()).toEqual(["a", "b"]);
    expect(agg.scopeWindowDays).toBe(14);
  });

  test("scopeWindowDays and scopeUncovered stay empty when no read carries a scope", () => {
    const agg = aggregateSyncScope([{ syncedAt: 100 }, { syncedAt: 200 }]);
    expect(agg.scopeWindowDays).toBeNull();
    expect(agg.scopeUncovered).toEqual([]);
  });
});

/** Wrap a bare mrs array as the FetchResult shape SnapshotCache now expects,
    for tests that only care about the mrs field. */
function fetchResult(mrs: unknown[]): FetchResult {
  return { mrs: mrs as BoardMR[], dataSyncedAt: null, scopeUncovered: [], scopeWindowDays: null };
}

describe("SnapshotCache", () => {
  test("caches within TTL and revalidates after", async () => {
    let calls = 0;
    let clock = 1_000;
    const cache = new SnapshotCache(
      async () => {
        calls++;
        return fetchResult([pr({ iid: calls })].map(() => ({ iid: calls } as any)));
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
        return fetchResult([{ iid: n } as any]);
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
        return fetchResult([{ iid: calls } as any]);
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
        return fetchResult([{ iid: n } as any]);
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

  test("refreshNow revalidates immediately and resolves with fresh data", async () => {
    let calls = 0;
    const cache = new SnapshotCache(async () => { calls++; return fetchResult([]); }, () => 1000, 60_000);
    await cache.get();               // warm: 1 fetch
    const snap = await cache.refreshNow(); // within TTL, but must fetch again
    expect(calls).toBe(2);
    expect(snap.fetchError).toBeNull();
  });

  test("refreshNow during an in-flight fetch shares it and stays stale for the next get", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const cache = new SnapshotCache(async () => { calls++; await gate; return fetchResult([]); }, () => 1000, 60_000);
    const first = cache.get();
    const second = cache.refreshNow(); // shares the in-flight fetch
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    // The shared fetch predates markStale, so the next get() must refetch.
    await cache.get();
    expect(calls).toBe(2);
  });

  test("forceRefresh with nothing in flight fetches once and returns fresh data", async () => {
    let calls = 0;
    const cache = new SnapshotCache(async () => { calls++; return fetchResult([]); }, () => 1000, 60_000);
    await cache.get(); // warm: 1 fetch
    const snap = await cache.forceRefresh();
    expect(calls).toBe(2);
    expect(snap.fetchError).toBeNull();
  });

  // The forced path must never share a fetch that started before the user's
  // click — that fetch's data (and any force-flag consumption) predates it.
  test("forceRefresh during an in-flight fetch waits it out and fetches again", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const cache = new SnapshotCache(
      async () => {
        calls++;
        const n = calls;
        if (n === 1) await gate;
        return fetchResult([{ iid: n } as any]);
      },
      () => 1000,
      60_000,
    );
    const first = cache.get(); // gated fetch #1, in flight
    const forced = cache.forceRefresh(); // must not share #1 — waits it out
    release();
    const [, forcedSnap] = await Promise.all([first, forced]);
    expect(calls).toBe(2); // NOT 1: forceRefresh fetched again, not shared
    expect(forcedSnap.mrs).toEqual([{ iid: 2 } as any]); // the second fetch's snapshot
  });
});
