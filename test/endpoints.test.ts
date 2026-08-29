import { unlink } from "node:fs/promises";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/app.js";
import { config } from "../config.js";
import { CACHE_DIR, cacheKey, writeCache } from "../server/cache/store.js";
import { startRefresh, __resetJobs } from "../server/jobs/refresh.js";
import { baseWindow, customWindow } from "../server/util/window.js";
import type { FetchOutcome } from "../server/pipeline/fetch.js";
import type { Scope, TimeWindow } from "../shared/types.js";

const WINDOW: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", key: "30d" };
const SELECTION = { range: "30d", trend: false };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** The scope resolveScope() derives from config (groupPath is empty -> projects scope). */
const TEST_SCOPE: Scope = { type: "projects", projectPaths: config.projectPaths ?? [] };

/** A cacheable but empty outcome, so a warmed window computes an empty snapshot. */
const EMPTY_OUTCOME: FetchOutcome = {
  result: { mrs: [], pipelines: [], pushEvents: [], linearIssues: [], approvalsAvailable: true },
  identities: {},
  warnings: [],
};

beforeAll(() => {
  // getLeaderboard calls getEnv(); give it a valid-looking env so it reaches cache logic.
  process.env.GITLAB_BASE_URL = "https://gl.example";
  process.env.GITLAB_TOKEN = "test-token";
});
afterEach(() => __resetJobs());

describe("refresh endpoints", () => {
  it("GET /api/refresh/:id returns a running job's status", async () => {
    const job = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, () => new Promise(() => {}));
    const res = await app.request(`/api/refresh/${job.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.jobId).toBe(job.id);
    expect(body.status).toBe("running");
  });

  it("GET /api/refresh/:id is 404 for an unknown id", async () => {
    const res = await app.request("/api/refresh/nope");
    expect(res.status).toBe(404);
  });

  it("POST /api/refresh/:id/cancel cancels a running job", async () => {
    const job = startRefresh({ window: WINDOW, trend: false, selection: SELECTION }, ({ signal }) =>
      new Promise((_res, rej) => signal.addEventListener("abort", () => { const e = new Error("x"); e.name = "AbortError"; rej(e); })),
    );
    const res = await app.request(`/api/refresh/${job.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    await flush();
    const after = await Promise.resolve(app.request(`/api/refresh/${job.id}`)).then((r) => r.json()) as Record<string, unknown>;
    expect(after.status).toBe("cancelled");
  });

  it("POST /api/refresh rejects an invalid custom range with 400", async () => {
    const res = await app.request("/api/refresh?range=custom&start=2026-05-01T00:00:00.000Z", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("GET /api/leaderboard?cacheOnly=1 returns {cached:false} on a cold cache", async () => {
    const res = await app.request(
      "/api/leaderboard?range=custom&start=2019-01-01T00:00:00.000Z&end=2019-01-08T00:00:00.000Z&cacheOnly=1",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.cached).toBe(false);
  });

  // A trend probe needs BOTH windows. When only the current one is warm, the probe must
  // report a cold cache so the client auto-starts the job that fetches the prior window.
  // Swallowing the prior's ColdCacheError into a warning instead returns a "successful"
  // response with hasTrend=false, and the prior window is then never fetched at all.
  it("GET /api/leaderboard?cacheOnly=1&trend=1 returns {cached:false} when only the current window is cached", async () => {
    const start = "2019-03-01T00:00:00.000Z";
    const end = "2019-03-08T00:00:00.000Z";
    const key = cacheKey(TEST_SCOPE, customWindow(start, end));
    // Warm ONLY the current window; its prior (2019-02-22..2019-03-01) stays cold.
    await writeCache(key, EMPTY_OUTCOME);
    try {
      const res = await app.request(
        `/api/leaderboard?range=custom&start=${start}&end=${end}&trend=1&cacheOnly=1`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.cached).toBe(false);
    } finally {
      await unlink(`${CACHE_DIR}/${key}.json`).catch(() => {});
    }
  });

  it("serves a preset from a warm base envelope without refetching", async () => {
    const now = new Date();
    const base = baseWindow(false, now);
    const key = cacheKey(TEST_SCOPE, base);
    await writeCache(key, EMPTY_OUTCOME);
    try {
      const res = await app.request("/api/leaderboard?range=7d&cacheOnly=1");
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      // A warm base means the 7d probe must NOT report a cold cache.
      expect(body.cached).toBeUndefined();
      expect(body.hasTrend).toBe(false);
    } finally {
      await unlink(`${CACHE_DIR}/${key}.json`).catch(() => {});
    }
  });

  it("falls back to a direct fetch for a custom range wider than the base", async () => {
    const start = "2026-03-01T00:00:00.000Z";
    const end = "2026-07-07T00:00:00.000Z";
    const key = cacheKey(TEST_SCOPE, customWindow(start, end));
    // 128 days: wider than the 90d base, so it must key on itself, not on the base.
    await writeCache(key, EMPTY_OUTCOME);
    try {
      const res = await app.request(
        `/api/leaderboard?range=custom&start=${start}&end=${end}&cacheOnly=1`,
      );
      const body = await res.json() as Record<string, unknown>;
      expect(body.cached).toBeUndefined();
    } finally {
      await unlink(`${CACHE_DIR}/${key}.json`).catch(() => {});
    }
  });
});
