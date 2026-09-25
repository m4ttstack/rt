import { existsSync } from 'fs';

import { effectiveIdentity } from '../registry/bundled-identity.ts';
import { iconPathFor } from '../registry/manifest.ts';
import { getRecord, listRecords } from '../registry/records.ts';
import { notServedHere, type ServeShapeDeps } from '../registry/serve-shape.ts';
import { isPlatformManagedBy } from '../services/manager.ts';
import { buildStatus, type BuildStatusOpts } from './status.ts';

export interface DiscoveryApp {
  name: string;
  displayName: string;
  description?: string;
  url: string;
  /** The app's own name when its effective identity (a linked checkout's
      ingested icon, else the bundle's) has an icon, null otherwise. The route
      turns this into an absolute /api/apps/<name>/icon URL. */
  icon: string | null;
  badge?: string;
}

/**
 * The launcher's app list: managed products this flavor serves, deck's own
 * platform row and all user apps excluded. `url` is reused verbatim from buildStatus (never
 * recomputed) so it matches deck's routing. No internal record field
 * (command, workingDirectory, env, port, health) crosses this boundary.
 */
export async function buildDiscoveryApps(
  opts: BuildStatusOpts,
  flavor: ServeShapeDeps = {}
): Promise<DiscoveryApp[]> {
  const status = await buildStatus(opts);
  const urlByName = new Map(status.apps.map(row => [row.name, row.url]));
  const apps: DiscoveryApp[] = [];
  for (const record of listRecords()) {
    if (record.managedBy === 'user' || isPlatformManagedBy(record.managedBy))
      continue;
    if (notServedHere(record, flavor)) continue;
    const url = urlByName.get(record.name);
    if (!url) continue;
    const identity = effectiveIdentity(record);
    apps.push({
      name: record.name,
      displayName: identity.displayName,
      description: identity.description,
      url,
      icon: identity.iconFile ? record.name : null,
      ...(identity.badge ? { badge: identity.badge } : {}),
    });
  }
  apps.sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) || a.name.localeCompare(b.name)
  );
  return apps;
}

/** Serves the svg the app's effective identity names, 404 when there is none. */
export function iconResponse(name: string): Response {
  const record = getRecord(name);
  const p =
    (record ? effectiveIdentity(record).iconFile : null) ?? iconPathFor(name);
  if (!existsSync(p)) return new Response('not found', { status: 404 });
  return new Response(Bun.file(p), {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=300',
    },
  });
}
