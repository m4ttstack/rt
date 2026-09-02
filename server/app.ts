import { Hono } from "hono";
import type { Context } from "hono";

import { getEnv } from "./env.js";
import { ConfigError, readSettings } from "./config/index.js";
import { getLeaderboard, getUserDetail, UnknownUserError } from "./leaderboard.js";
import { startRefresh, getRefresh, cancelRefresh, toStatusResponse } from "./jobs/refresh.js";
import { clearMrStore, mrStoreSize, linearIdStats, mrListCacheSize } from "./cache/mr-store.js";
import { getSettings, updateSettings, getDefaults } from "./settings.js";
import { fetchWorkflowStates } from "./linear/fetch.js";
import { scanSuspectedBots } from "./bots.js";
import { resolveWindowArgs } from "./util/window.js";
import type { CacheStatsResponse, TimeWindow } from "../shared/types.js";

export const app = new Hono();

const boolQuery = (c: Context, name: string): boolean =>
  c.req.query(name) === "1" || c.req.query(name) === "true";

/** The window from query params, or the 400 response to return for bad bounds. */
function windowFromQuery(c: Context): TimeWindow | Response {
  try {
    return resolveWindowArgs(
      c.req.query("range"),
      c.req.query("start"),
      c.req.query("end"),
      readSettings().defaultRange,
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}

app.get("/api/leaderboard", async (c) => {
  const window = windowFromQuery(c);
  if (window instanceof Response) return window;

  const refresh = boolQuery(c, "refresh");
  const trend = boolQuery(c, "trend");
  const cacheOnly = boolQuery(c, "cacheOnly");

  try {
    const result = await getLeaderboard({ window, refresh, trend, cacheOnly });
    return c.json(result);
  } catch (err) {
    if ((err as Error).name === "ColdCacheError") return c.json({ cached: false }, 200);
    if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
    console.error("[leaderboard] failed:", err);
    return c.json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

app.get("/api/detail", async (c) => {
  const user = c.req.query("user");
  if (!user) return c.json({ error: "user query param is required" }, 400);

  const window = windowFromQuery(c);
  if (window instanceof Response) return window;

  const refresh = boolQuery(c, "refresh");
  const trend = boolQuery(c, "trend");

  try {
    const result = await getUserDetail({ window, refresh, trend, user });
    return c.json(result);
  } catch (err) {
    if (err instanceof UnknownUserError) return c.json({ error: err.message }, 404);
    if (err instanceof ConfigError) return c.json({ error: err.message }, 400);
    console.error("[detail] failed:", err);
    return c.json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/settings", (c) => {
  return c.json({ settings: getSettings(), defaults: getDefaults() });
});

app.get("/api/settings/linear-states", async (c) => {
  try {
    const env = getEnv();
    if (!env.linearApiKey) return c.json({ states: [] });
    const team = c.req.query("team");
    const states = await fetchWorkflowStates(env.linearApiKey, team || undefined);
    return c.json({ states });
  } catch (err) {
    console.error("[settings/linear-states] failed:", err);
    return c.json({ error: "Failed to fetch Linear workflow states" }, 502);
  }
});

app.put("/api/settings", async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    try {
      const settings = updateSettings(body as Parameters<typeof updateSettings>[0]);
      return c.json({ settings });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
});

app.get("/api/settings/suspected-bots", async (c) => {
  try {
    const s = getSettings();
    const bots = await scanSuspectedBots(s.bots.extraPatterns);
    return c.json({ bots });
  } catch (err) {
    console.error("[settings/suspected-bots] failed:", err);
    return c.json({ error: "Failed to scan for suspected bots" }, 500);
  }
});

app.post("/api/refresh", (c) => {
  const window = windowFromQuery(c);
  if (window instanceof Response) return window;
  const trend = boolQuery(c, "trend");
  const job = startRefresh({
    window,
    trend,
    selection: {
      range: c.req.query("range") ?? readSettings().defaultRange,
      start: c.req.query("start"),
      end: c.req.query("end"),
      trend,
    },
  });
  return c.json(toStatusResponse(job));
});

app.get("/api/refresh/:id", async (c) => {
  const job = getRefresh(c.req.param("id"));
  if (!job) return c.json({ error: "unknown job" }, 404);
  return c.json(toStatusResponse(job));
});

app.post("/api/refresh/:id/cancel", (c) => {
  const job = cancelRefresh(c.req.param("id"));
  if (!job) return c.json({ error: "unknown job" }, 404);
  return c.json(toStatusResponse(job));
});

app.get("/api/cache/stats", async (c) => {
  const stats: CacheStatsResponse = {
    mrDetails: await mrStoreSize(),
    mrList: await mrListCacheSize(),
    linearIds: await linearIdStats(),
  };
  return c.json(stats);
});

app.post("/api/cache/clear", async (c) => {
  await clearMrStore();
  return c.json({ cleared: true });
});
