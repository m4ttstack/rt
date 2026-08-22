import { readFileSync, writeFileSync } from "fs";
import { routesPath } from "./discover.ts";

// Rewrite one route's port in routes.json atomically, preserving all other
// fields (pid, etc.). Accepts a bare name or a full <name>.localhost hostname.
// Returns false (no write) when no matching entry exists or the file is unreadable.
export function setRoutePort(hostname: string, port: number): boolean {
  const bare = hostname.replace(/\.localhost$/, "");
  const path = routesPath();
  let routes: Array<Record<string, unknown>>;
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  const entry = routes.find(
    (r) => String(r.hostname).replace(/\.localhost$/, "") === bare,
  );
  if (!entry) return false;
  entry.port = port;
  // MUST be an in-place write. Do NOT "improve" this into the usual atomic
  // temp-file + rename: portless watches this exact path with fs.watch, which
  // follows the inode, so replacing the file leaves the proxy watching a dead
  // inode. Measured behaviour: the rename itself is delivered, then every later
  // change is silently ignored, and .localhost serves stale ports until the
  // proxy is restarted. Writing in place keeps the inode and the watcher alive
  // (verified across repeated writes). routes-writer.test.ts guards this.
  //
  // The cost is losing write atomicity, so readers must tolerate a torn read;
  // readRoutes() falls back to the last good value for that reason.
  writeFileSync(path, JSON.stringify(routes, null, 2));
  return true;
}

/** Append a route for `hostname` if none exists (any-TLD exact match), using
    the same in-place write discipline as setRoutePort -- portless follows the
    inode. Returns true when a route was appended. */
export function ensureRoute(hostname: string, port: number): boolean {
  const path = routesPath();
  let routes: Array<Record<string, unknown>>;
  try {
    routes = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  if (routes.some((r) => String(r.hostname) === hostname)) return false;
  routes.push({ hostname, port, pid: 0 });
  writeFileSync(path, JSON.stringify(routes, null, 2));
  return true;
}
