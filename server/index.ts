import { existsSync } from "node:fs";
import { serveStatic } from "hono/bun";

import { app } from "./app.js";
import { getEnv } from "./env.js";

// Serve the built frontend in production (bun run build && bun start).
// In dev, Vite serves the app and proxies /api here, so dist won't exist yet.
if (existsSync("./web/dist")) {
  app.use("/*", serveStatic({ root: "./web/dist" }));
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
