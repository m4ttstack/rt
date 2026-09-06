import { existsSync } from "fs";
import { buildStatus, type BuildStatusOpts } from "./status.ts";
import { listRecords } from "../registry/records.ts";
import { isPlatformManagedBy } from "../services/manager.ts";
import { iconPathFor } from "../registry/manifest.ts";

export interface DiscoveryApp {
  name: string;
  displayName: string;
  description?: string;
  url: string;
  /** The app's own name when it has a stored icon, null otherwise. The route
      turns this into an absolute /api/apps/<name>/icon URL. */
  icon: string | null;
}

/**
 * The launcher's app list: managed products only, deck's own platform row and
 * all user apps excluded. `url` is reused verbatim from buildStatus (never
 * recomputed) so it matches deck's routing. No internal record field
 * (command, workingDirectory, env, port, health) crosses this boundary.
 */
export async function buildDiscoveryApps(opts: BuildStatusOpts): Promise<DiscoveryApp[]> {
  const status = await buildStatus(opts);
  const urlByName = new Map(status.apps.map((row) => [row.name, row.url]));
  const apps: DiscoveryApp[] = [];
  for (const record of listRecords()) {
    if (record.managedBy === "user" || isPlatformManagedBy(record.managedBy)) continue;
    const url = urlByName.get(record.name);
    if (!url) continue;
    apps.push({
      name: record.name,
      displayName: record.displayName ?? record.name,
      description: record.description,
      url,
      icon: record.icon ? record.name : null,
    });
  }
  apps.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.name.localeCompare(b.name));
  return apps;
}

/** Serves an app's stored icon svg, 404 when none has been ingested. */
export function iconResponse(name: string): Response {
  const p = iconPathFor(name);
  if (!existsSync(p)) return new Response("not found", { status: 404 });
  return new Response(Bun.file(p), {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" },
  });
}
