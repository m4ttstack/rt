import { Hono } from "hono";

import { config } from "../config.js";
import { EnvError } from "./env.js";
import { getLeaderboard, getUserDetail, UnknownUserError } from "./leaderboard.js";
import { startRefresh, getRefresh, cancelRefresh, toStatusResponse } from "./jobs/refresh.js";
import { customWindow, isPreset, resolvePreset } from "./util/window.js";
import type { RangePreset, TimeWindow } from "../shared/types.js";

export const app = new Hono();

app.get("/api/leaderboard", async (c) => {
  let window: TimeWindow;
  try {
    window = resolveWindowFromQuery(
      c.req.query("range"),
      c.req.query("start"),
      c.req.query("end"),
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
  const trend = c.req.query("trend") === "1" || c.req.query("trend") === "true";
  const cacheOnly = c.req.query("cacheOnly") === "1" || c.req.query("cacheOnly") === "true";

  try {
    const result = await getLeaderboard({ window, refresh, trend, cacheOnly });
    return c.json(result);
  } catch (err) {
    if ((err as Error).name === "ColdCacheError") return c.json({ cached: false }, 200);
    if (err instanceof EnvError) return c.json({ error: err.message }, 400);
    console.error("[leaderboard] failed:", err);
    return c.json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

app.get("/api/detail", async (c) => {
  const user = c.req.query("user");
  if (!user) return c.json({ error: "user query param is required" }, 400);

  let window: TimeWindow;
  try {
    window = resolveWindowFromQuery(c.req.query("range"), c.req.query("start"), c.req.query("end"));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
  const trend = c.req.query("trend") === "1" || c.req.query("trend") === "true";

  try {
    const result = await getUserDetail({ window, refresh, trend, user });
    return c.json(result);
  } catch (err) {
    if (err instanceof UnknownUserError) return c.json({ error: err.message }, 404);
    if (err instanceof EnvError) return c.json({ error: err.message }, 400);
    console.error("[detail] failed:", err);
    return c.json({ error: (err as Error).message ?? "Internal error" }, 500);
  }
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/refresh", (c) => {
  let window: TimeWindow;
  try {
    window = resolveWindowFromQuery(c.req.query("range"), c.req.query("start"), c.req.query("end"));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const trend = c.req.query("trend") === "1" || c.req.query("trend") === "true";
  const job = startRefresh({
    window,
    trend,
    selection: {
      range: c.req.query("range") ?? config.defaultRange,
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

export function resolveWindowFromQuery(
  range: string | undefined,
  start: string | undefined,
  end: string | undefined,
): TimeWindow {
  if (range === "custom" || (start && end)) {
    if (!start || !end) throw new Error("custom range requires both start and end (ISO dates)");
    if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      throw new Error("start and end must be valid ISO dates");
    }
    if (Date.parse(start) >= Date.parse(end)) throw new Error("start must be before end");
    return customWindow(new Date(start).toISOString(), new Date(end).toISOString());
  }
  const preset: RangePreset = range && isPreset(range) ? range : config.defaultRange;
  return resolvePreset(preset, new Date());
}
