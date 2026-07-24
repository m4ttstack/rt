import { readFileSync, writeFileSync, renameSync } from "fs";
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
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(routes, null, 2));
  renameSync(tmp, path);
  return true;
}
