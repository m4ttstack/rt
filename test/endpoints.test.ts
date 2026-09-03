import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { __setSettingReader } from "../server/config/index.js";
import type { TimeWindow } from "../shared/types.js";

const dir = mkdtempSync(join(tmpdir(), "boxscore-endpoints-"));
process.env.BOXSCORE_DB = join(dir, "test.sqlite");

const { app } = await import("../server/app.js");
const { startRefresh, __resetJobs } = await import("../server/refresh/index.js");
const { getStore, __resetStore } = await import("../server/store/index.js");

const WINDOW: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", key: "30d" };
const SELECTION = { range: "30d", trend: false };
const flush = () => new Promise((r) => setTimeout(r, 0));

const PROJECTS = ["acme/acme-web"];
const SETTINGS: Record<string, unknown> = {
  "boxscore.projects": PROJECTS,
  "mattstack.roster": [{ username: "m4ttheweric", name: "Matthew Goodwin" }],
  "mattstack.integrations": { forge: { host: "gl.example" } },
};

beforeAll(() => {
  __setSettingReader(<T,>(k: string) => SETTINGS[k] as T | undefined);
  // resolveEnv() reads GITLAB_TOKEN through the env-first secrets seam.
  process.env.GITLAB_TOKEN = "test-token";
});
afterAll(() => {
  __setSettingReader(null);
  __resetStore();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => getStore().clear());
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

  it("GET /api/leaderboard?cacheOnly=1 returns {cached:false} on a cold store", async () => {
    const res = await app.request(
      "/api/leaderboard?range=custom&start=2019-01-01T00:00:00.000Z&end=2019-01-08T00:00:00.000Z&cacheOnly=1",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.cached).toBe(false);
  });

  // The trend flag must not bypass the cold-store check: a probe still needs to know the
  // store has ever been populated before either window's snapshot can mean anything.
  it("GET /api/leaderboard?cacheOnly=1&trend=1 returns {cached:false} on a cold store", async () => {
    const res = await app.request(
      "/api/leaderboard?range=custom&start=2019-03-01T00:00:00.000Z&end=2019-03-08T00:00:00.000Z&trend=1&cacheOnly=1",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.cached).toBe(false);
  });

  it("GET /api/leaderboard?cacheOnly=1 serves a snapshot without refetching once every configured project has been scanned", async () => {
    for (const p of PROJECTS) getStore().setLastScan(p, new Date().toISOString());
    const res = await app.request("/api/leaderboard?range=7d&cacheOnly=1");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // A warm store means the probe must NOT report a cold cache.
    expect(body.cached).toBeUndefined();
    expect(body.hasTrend).toBe(false);
  });
});

describe("deleted routes", () => {
  it("the settings API is gone", async () => {
    expect((await app.request("/api/settings")).status).toBe(404);
    expect((await app.request("/api/settings/linear-states")).status).toBe(404);
  });
});
