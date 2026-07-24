import { readFileSync, writeFileSync, renameSync } from "fs";
import { ROUTES_PATH } from "./discover.ts";

// Rewrite one route's port in routes.json atomically, preserving all other
// fields (pid, etc.). Accepts a bare name or a full <name>.localhost hostname.
// Returns false (no write) when no matching entry exists or the file is unreadable.
export function setRoutePort(hostname: string, port: number): boolean {
  const bare = hostname.replace(/\.localhost$/, "");
  let routes: Array<Record<string, unknown>>;
  try {
    routes = JSON.parse(readFileSync(ROUTES_PATH, "utf8"));
  } catch {
    return false;
  }
  const entry = routes.find(
    (r) => String(r.hostname).replace(/\.localhost$/, "") === bare,
  );
  if (!entry) return false;
  entry.port = port;
  const tmp = ROUTES_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(routes, null, 2));
  renameSync(tmp, ROUTES_PATH);
  return true;
}
