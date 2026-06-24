import { existsSync } from "node:fs";
import { Hono } from "hono";

import { config } from "../config.js";
import { getEnv, EnvError } from "./env.js";
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

// Serve the built frontend in production (bun run build && bun start).
// In dev, Vite serves the app and proxies /api here, so dist won't exist yet.
if (existsSync("./web/dist")) {
  // Dynamic import so hono/bun (which requires Bun globals) is not loaded in test/Node environments.
  void import("hono/bun").then(({ serveStatic }) => {
    app.use("/*", serveStatic({ root: "./web/dist" }));
  }).catch(() => {
    // hono/bun requires Bun runtime; silently skip in non-Bun environments (e.g. tests).
  });
}

function resolveWindowFromQuery(
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

// Boot. We intentionally do NOT validate env here so the server always starts;
// missing-token errors surface per-request with a readable message.
// Bun serves the default export ({ port, fetch }) natively ... no node http server needed.
const port = readPort();
console.log(`forge-leaderboard server listening on http://localhost:${port}`);

function readPort(): number {
  try {
    return getEnv().port;
  } catch {
    return Number(process.env.PORT ?? 8787) || 8787;
  }
}

// idleTimeout raised from Bun's 10s default ... the first uncached fetch of a large
// monorepo (current + prior window) can take longer. 255s is Bun's max.
export default { port, fetch: app.fetch, idleTimeout: 255 };
