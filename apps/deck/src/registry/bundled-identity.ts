import { isAbsolute, join, relative, resolve } from 'path';

import { bundleResourcesDir } from '../services/bundle-layout.ts';
import { isPlatformManagedBy } from '../services/manager.ts';
import { readDeckManifest } from './deck-manifest.ts';
import { iconPathFor, readSvgIcon } from './manifest.ts';
import type { AppRecord } from './records.ts';

export interface AppIdentity {
  displayName: string;
  description?: string;
  badge?: string;
  /** The svg served at /api/apps/<name>/icon; null when the row advertises no icon. */
  iconFile: string | null;
}

/**
 * The identity repo-tools' build.sh lands at Contents/Resources/apps/<name>/
 * for a served app. Null when the dir is absent or anything in it fails the
 * checks ingestManifest applies to a checkout: the icon must stay inside the
 * dir, be svg-rooted and be at most 64 KB.
 */
export function readBundledIdentity(
  resourcesDir: string,
  name: string
): (AppIdentity & { iconFile: string }) | null {
  const dir = join(resourcesDir, 'apps', name);
  const parsed = readDeckManifest(dir);
  if (!parsed || !parsed.ok) return null;
  const m = parsed.manifest;
  if (m.name !== name || !m.displayName || !m.icon) return null;
  const iconFile = resolve(dir, m.icon);
  const rel = relative(dir, iconFile);
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    return null;
  if (readSvgIcon(iconFile) === null) return null;
  return {
    displayName: m.displayName,
    ...(m.description !== undefined ? { description: m.description } : {}),
    ...(m.badge !== undefined ? { badge: m.badge } : {}),
    iconFile,
  };
}

let resourcesOverride: string | null | undefined;

/** Test seam: pins the Resources dir identity is read from; undefined restores the running bundle's. */
export function setBundledResourcesDir(dir: string | null | undefined): void {
  resourcesOverride = dir;
}

function currentResourcesDir(): string | null {
  return resourcesOverride !== undefined
    ? resourcesOverride
    : bundleResourcesDir();
}

function storedIdentity(record: AppRecord): AppIdentity {
  return {
    displayName: record.displayName ?? record.name,
    ...(record.description !== undefined
      ? { description: record.description }
      : {}),
    ...(record.badge ? { badge: record.badge } : {}),
    iconFile: record.icon ? iconPathFor(record.name) : null,
  };
}

export function effectiveIdentity(
  record: AppRecord,
  resourcesDir: string | null = currentResourcesDir()
): AppIdentity {
  const stored = storedIdentity(record);
  if (record.managedBy === 'user' || isPlatformManagedBy(record.managedBy))
    return stored;
  // A linked checkout's identity was ingested from source, which is newer
  // than the copy the bundle was built with.
  if (record.dev?.workingDirectory && record.displayName !== undefined)
    return stored;
  const bundled = resourcesDir
    ? readBundledIdentity(resourcesDir, record.name)
    : null;
  return bundled ?? stored;
}

/** The icon URL a status row carries, relative to deck's own origin. */
export function statusIconUrl(record: AppRecord): string | null {
  if (isPlatformManagedBy(record.managedBy)) return '/favicon.svg';
  return effectiveIdentity(record).iconFile
    ? `/api/apps/${record.name}/icon`
    : null;
}
