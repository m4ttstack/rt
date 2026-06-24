import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../server/index.js";
import { startRefresh, __resetJobs } from "../server/jobs/refresh.js";
import type { TimeWindow } from "../shared/types.js";

const WINDOW: TimeWindow = { start: "2026-05-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z", key: "30d" };
const SELECTION = { range: "30d", trend: false };
const flush = () => new Promise((r) => setTimeout(r, 0));

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
});
