import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  FetchMergeRequestIndexOptions,
  FetchMergeRequestMetricsOptions,
  FetchProjectPipelinesOptions,
  FetchUserEventsOptions,
  MergeRequestIndexRow,
  MergeRequestMetrics,
  PipelineSummary,
  UserEvent,
} from "@mattstack/glance";
import type { RequestIO, SourceProvider, GitProvider } from "../server/source/index.js";
import type { BoxscoreSettings, Env } from "../server/config/index.js";
import type { LeaderboardWarning, RefreshProgress, TimeWindow } from "../shared/types.js";

const dir = mkdtempSync(join(tmpdir(), "boxscore-refresh-"));
process.env.BOXSCORE_DB = join(dir, "test.sqlite");

const { getStore, mrKey, __resetStore } = await import("../server/store/index.js");
const { runRefresh } = await import("../server/refresh/run.js");
const { toIndexRow } = await import("../server/source/index.js");

beforeEach(() => getStore().clear());
afterAll(() => {
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});

const WINDOW: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-05-31T00:00:00.000Z", key: "custom" };
const ENV: Env = { baseUrl: "https://gl.example", token: "tkn" };

interface Call {
  method: string;
  args: unknown[];
}

interface FakeOverrides {
  fetchMergeRequestIndex?: (options: FetchMergeRequestIndexOptions) => Promise<MergeRequestIndexRow[]>;
  fetchMergeRequestMetrics?: (
    projectPath: string,
    mrIid: number,
    options?: FetchMergeRequestMetricsOptions,
  ) => Promise<MergeRequestMetrics | null>;
  fetchProjectPipelines?: (projectPath: string, options: FetchProjectPipelinesOptions) => Promise<PipelineSummary[]>;
  fetchUserEvents?: (userId: string, options: FetchUserEventsOptions) => Promise<UserEvent[]>;
  restRequest?: (method: string, path: string, body?: unknown, op?: string, io?: RequestIO) => Promise<Response>;
}

/** A hand-rolled fake, not a mock library: records every call and returns canned glance shapes. */
function makeFakeProvider(overrides: FakeOverrides = {}) {
  const calls: Call[] = [];
  const provider: SourceProvider = {
    async fetchMergeRequestIndex(options) {
      calls.push({ method: "fetchMergeRequestIndex", args: [options] });
      return overrides.fetchMergeRequestIndex ? await overrides.fetchMergeRequestIndex(options) : [];
    },
    async fetchMergeRequestMetrics(projectPath, mrIid, options) {
      calls.push({ method: "fetchMergeRequestMetrics", args: [projectPath, mrIid, options] });
      return overrides.fetchMergeRequestMetrics
        ? await overrides.fetchMergeRequestMetrics(projectPath, mrIid, options)
        : null;
    },
    async fetchProjectPipelines(projectPath, options) {
      calls.push({ method: "fetchProjectPipelines", args: [projectPath, options] });
      return overrides.fetchProjectPipelines ? await overrides.fetchProjectPipelines(projectPath, options) : [];
    },
    async fetchUserEvents(userId, options) {
      calls.push({ method: "fetchUserEvents", args: [userId, options] });
      return overrides.fetchUserEvents ? await overrides.fetchUserEvents(userId, options) : [];
    },
    async restRequest(method, path, body, op, io) {
      calls.push({ method: "restRequest", args: [method, path, body, op, io] });
      return overrides.restRequest
        ? await overrides.restRequest(method, path, body, op, io)
        : new Response("[]", { status: 200 });
    },
  };
  // A real GitLabProvider satisfies SourceProvider structurally (task 2 deviation);
  // the fake mirrors that by casting through the same narrow surface.
  return { provider: provider as unknown as GitProvider, calls };
}

function settings(over: Partial<BoxscoreSettings> = {}): BoxscoreSettings {
  const roster = over.roster ?? [{ username: "alice" }];
  const hiddenMembers = over.hiddenMembers ?? [];
  const hidden = new Set(hiddenMembers);
  return {
    projects: ["g/p"],
    roster,
    hiddenMembers,
    users: roster.filter((r) => !hidden.has(r.username)).map((r) => r.username),
    linearTeam: "",
    doneStates: [],
    sizeBand: { tooSmall: 10, tooLarge: 400 },
    excludeFilePatterns: [],
    ignoredMrs: [],
    botPatterns: [],
    defaultRange: "30d",
    baseUrl: "https://gl.example",
    ...over,
  };
}

const indexRow = (over: Partial<MergeRequestIndexRow> = {}): MergeRequestIndexRow => ({
  iid: 1,
  projectPath: "g/p",
  title: "t",
  state: "opened",
  createdAt: "2026-05-05T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  mergedAt: null,
  authorUsername: "alice",
  sourceBranch: "feat/x",
  labels: [],
  ...over,
});

const metrics = (over: Partial<MergeRequestMetrics> & Pick<MergeRequestMetrics, "projectPath" | "iid">): MergeRequestMetrics => ({
  description: "desc",
  diffStats: { additions: 1, deletions: 1, filesChanged: 1 },
  fileStats: [],
  labels: [],
  approvedByUsernames: [],
  notes: [],
  ...over,
});

const userIdRes = (id: number, username: string) =>
  new Response(JSON.stringify([{ id, username, name: username }]), { status: 200 });

describe("runRefresh: identity resolution", () => {
  it("resolves only roster users missing from identities or older than a day; a fresh one is not re-fetched", async () => {
    const store = getStore();
    const oldEnough = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    store.upsertIdentities([
      { username: "fresh", name: "Fresh", resolved: true, userId: 1, fetchedAt: fresh },
      { username: "stale", name: "Stale", resolved: true, userId: 2, fetchedAt: oldEnough },
    ]);
    const { provider, calls } = makeFakeProvider({
      restRequest: async (_m, path) => {
        const username = new URL(path, "http://x").searchParams.get("username")!;
        return userIdRes(username === "stale" ? 2 : 3, username);
      },
    });

    await runRefresh({
      store,
      provider,
      settings: settings({ roster: [{ username: "fresh" }, { username: "stale" }, { username: "missing" }] }),
      env: ENV,
      window: WINDOW,
    });

    const lookedUp = calls
      .filter((c) => c.method === "restRequest")
      .map((c) => new URL(c.args[1] as string, "http://x").searchParams.get("username"));
    expect(lookedUp.sort()).toEqual(["missing", "stale"]);
  });
});

describe("runRefresh: full roster (visible + hidden)", () => {
  it("scans/resolves for hidden members too, so hiding a user does not evict their data", async () => {
    const store = getStore();
    const { provider, calls } = makeFakeProvider({
      restRequest: async (_m, path) => {
        const username = new URL(path, "http://x").searchParams.get("username")!;
        return userIdRes(username === "hidden" ? 9 : 1, username);
      },
      fetchMergeRequestIndex: async () => [indexRow({ iid: 1, authorUsername: "hidden" })],
    });

    await runRefresh({
      store,
      provider,
      settings: settings({
        roster: [{ username: "vis" }, { username: "hidden" }],
        hiddenMembers: ["hidden"],
      }),
      env: ENV,
      window: WINDOW,
    });

    const identityUsers = calls
      .filter((c) => c.method === "restRequest")
      .map((c) => new URL(c.args[1] as string, "http://x").searchParams.get("username"));
    expect(identityUsers.sort()).toEqual(["hidden", "vis"]);

    // The hidden member's MR (fetched via the project scan) is still eligible: authored by
    // a roster member, so its metrics get fetched -- the data is not evicted by hiding.
    const detailCalls = calls.filter((c) => c.method === "fetchMergeRequestMetrics");
    expect(detailCalls).toHaveLength(1);
    expect(detailCalls[0]!.args[1]).toBe(1);
  });
});

describe("runRefresh: watermark-driven project scan", () => {
  it("uses lastScan(project) as updatedAfter, falling back to the window start", async () => {
    const store = getStore();
    store.setLastScan("g/p1", "2026-04-15T00:00:00.000Z");
    const { provider, calls } = makeFakeProvider();

    await runRefresh({
      store,
      provider,
      settings: settings({ projects: ["g/p1", "g/p2"] }),
      env: ENV,
      window: WINDOW,
    });

    const listCalls = calls.filter((c) => c.method === "fetchMergeRequestIndex");
    const byProject = new Map(
      listCalls.map((c) => {
        const opts = c.args[0] as FetchMergeRequestIndexOptions;
        return [opts.projectPaths![0]!, opts.updatedAfter];
      }),
    );
    expect(byProject.get("g/p1")).toBe("2026-04-15T00:00:00.000Z");
    expect(byProject.get("g/p2")).toBe(WINDOW.start);
  });
});

describe("runRefresh: failed-scan invariant", () => {
  it("leaves the failed project's watermark untouched, advances the other, and warns instead of throwing", async () => {
    const store = getStore();
    store.setLastScan("g/A", "2026-04-01T00:00:00.000Z");
    store.setLastScan("g/B", "2026-04-01T00:00:00.000Z");
    const { provider } = makeFakeProvider({
      fetchMergeRequestIndex: async (options) => {
        if (options.projectPaths![0] === "g/A") throw new Error("boom");
        return [];
      },
    });

    const warnings = await runRefresh({
      store,
      provider,
      settings: settings({ projects: ["g/A", "g/B"] }),
      env: ENV,
      window: WINDOW,
    });

    expect(store.lastScan("g/A")).toBe("2026-04-01T00:00:00.000Z");
    expect(store.lastScan("g/B")).not.toBe("2026-04-01T00:00:00.000Z");
    expect(warnings).toContainEqual(expect.objectContaining({ code: "mr_fetch_failed" }));
  });
});

describe("runRefresh: eligible-for-detail set", () => {
  it("fetches metrics for roster-authored rows in window, plus revert-titled rows by anyone", async () => {
    const store = getStore();
    const { provider, calls } = makeFakeProvider({
      fetchMergeRequestIndex: async () => [
        indexRow({ iid: 1, authorUsername: "alice", title: "normal change" }),
        indexRow({ iid: 2, authorUsername: "outsider", title: 'Revert "normal change"' }),
        indexRow({ iid: 3, authorUsername: "outsider", title: "unrelated" }),
      ],
      fetchMergeRequestMetrics: async (_p, iid) => metrics({ projectPath: "g/p", iid }),
    });

    await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });

    const fetchedIids = calls
      .filter((c) => c.method === "fetchMergeRequestMetrics")
      .map((c) => c.args[1]);
    expect(fetchedIids.sort()).toEqual([1, 2]);
  });
});

describe("runRefresh: metrics re-fetch rule", () => {
  it("skips a merged row already in mr_metrics but re-fetches a non-merged stored row and a missing one", async () => {
    const store = getStore();
    store.upsertIndexRows(
      [
        indexRow({ iid: 1, state: "merged" }),
        indexRow({ iid: 2, state: "opened" }),
        indexRow({ iid: 3, state: "opened" }),
      ].map((r) => toIndexRow(r, "2026-05-01T00:00:00.000Z")),
    );
    store.upsertMrMetrics([
      { projectPath: "g/p", iid: 1, description: "old", diffStats: null, fileStats: [], labels: [], approvedByUsernames: [], notes: [] },
      { projectPath: "g/p", iid: 2, description: "old", diffStats: null, fileStats: [], labels: [], approvedByUsernames: [], notes: [] },
    ]);
    const { provider, calls } = makeFakeProvider({
      fetchMergeRequestMetrics: async (_p, iid) => metrics({ projectPath: "g/p", iid }),
    });

    await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });

    const fetchedIids = calls
      .filter((c) => c.method === "fetchMergeRequestMetrics")
      .map((c) => c.args[1]);
    expect(fetchedIids.sort()).toEqual([2, 3]);
  });
});

describe("runRefresh: metrics batch persistence", () => {
  it("persists in batches of 25", async () => {
    const store = getStore();
    const rows = Array.from({ length: 30 }, (_, i) => indexRow({ iid: i + 1 }));
    store.upsertIndexRows(rows.map((r) => toIndexRow(r, "2026-05-01T00:00:00.000Z")));
    const { provider } = makeFakeProvider({
      fetchMergeRequestMetrics: async (_p, iid) => metrics({ projectPath: "g/p", iid }),
    });

    const batchSizes: number[] = [];
    const original = store.upsertMrMetrics.bind(store);
    store.upsertMrMetrics = (batch) => {
      batchSizes.push(batch.length);
      return original(batch);
    };

    await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });

    expect(batchSizes).toEqual([25, 5]);
    expect(store.metricsByKeys(rows.map((r) => mrKey(r.projectPath, r.iid)))).toHaveLength(30);
  });

  it("banks completed batches when the run is aborted mid-flight", async () => {
    const store = getStore();
    const rows = Array.from({ length: 30 }, (_, i) => indexRow({ iid: i + 1 }));
    store.upsertIndexRows(rows.map((r) => toIndexRow(r, "2026-05-01T00:00:00.000Z")));
    const controller = new AbortController();
    let count = 0;
    const { provider } = makeFakeProvider({
      fetchMergeRequestMetrics: async (_p, iid) => {
        count++;
        if (count === 5) {
          controller.abort();
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return metrics({ projectPath: "g/p", iid });
      },
    });

    await expect(
      runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const stored = store.metricsByKeys(rows.map((r) => mrKey(r.projectPath, r.iid)));
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThan(30);
  });
});

describe("runRefresh: progress phases", () => {
  it("emits users, mrs-list, mrs-detail, pipelines, pushes, linear in order", async () => {
    const store = getStore();
    const { provider } = makeFakeProvider({
      fetchMergeRequestIndex: async () => [indexRow()],
      fetchMergeRequestMetrics: async (_p, iid) => metrics({ projectPath: "g/p", iid }),
    });

    const phases: RefreshProgress["phase"][] = [];
    await runRefresh({
      store,
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
      onProgress: (p) => {
        if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
      },
    });

    expect(phases).toEqual(["users", "mrs-list", "mrs-detail", "pipelines", "pushes", "linear"]);
  });
});

describe("runRefresh: warning codes", () => {
  it("emits user_unresolved when a username has no match", async () => {
    const store = getStore();
    const { provider } = makeFakeProvider({ restRequest: async () => new Response("[]", { status: 200 }) });
    const warnings = await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "user_unresolved" }));
  });

  it("emits user_lookup_failed when identity resolution throws", async () => {
    const store = getStore();
    const { provider } = makeFakeProvider({
      restRequest: async () => {
        throw new Error("network down");
      },
    });
    const warnings = await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "user_lookup_failed" }));
  });

  it("emits mr_detail_partial when a metrics fetch throws", async () => {
    const store = getStore();
    const { provider } = makeFakeProvider({
      fetchMergeRequestIndex: async () => [indexRow()],
      fetchMergeRequestMetrics: async () => {
        throw new Error("gone");
      },
    });
    const warnings: LeaderboardWarning[] = await runRefresh({
      store,
      provider,
      settings: settings(),
      env: ENV,
      window: WINDOW,
    });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "mr_detail_partial" }));
  });

  it("emits pipeline_fetch_failed when the pipeline fetch throws", async () => {
    const store = getStore();
    const { provider } = makeFakeProvider({
      fetchProjectPipelines: async () => {
        throw new Error("nope");
      },
    });
    const warnings = await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "pipeline_fetch_failed" }));
  });

  it("emits events_fetch_failed when the push-events fetch throws", async () => {
    const store = getStore();
    const { provider } = makeFakeProvider({
      restRequest: async (_m, path) => {
        const username = new URL(path, "http://x").searchParams.get("username")!;
        return userIdRes(1, username);
      },
      fetchUserEvents: async () => {
        throw new Error("nope");
      },
    });
    const warnings = await runRefresh({ store, provider, settings: settings(), env: ENV, window: WINDOW });
    expect(warnings).toContainEqual(expect.objectContaining({ code: "events_fetch_failed" }));
  });
});
