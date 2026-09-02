import { existsSync } from "node:fs";
import { serveStatic } from "hono/bun";

import { app } from "./app.js";

// Serve the built frontend in production (bun run build && bun start).
// In dev, Vite serves the app and proxies /api here, so dist won't exist yet.
if (existsSync("./web/dist")) {
  app.use("/*", serveStatic({ root: "./web/dist" }));
}

// Boot. We intentionally do NOT validate env here so the server always starts;
// missing-token errors surface per-request with a readable message.
// Bun serves the default export ({ port, fetch }) natively ... no node http server needed.
const port = Number(process.env.PORT ?? 8787);
console.log(`boxscore server listening on http://localhost:${port}`);

// idleTimeout raised from Bun's 10s default ... the first uncached fetch of a large
// monorepo (current + prior window) can take longer. 255s is Bun's max.
export default { port, fetch: app.fetch, idleTimeout: 255 };
