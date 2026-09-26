import { readFileSync } from 'fs';
import { join } from 'path';

import { bundleResourcesDir } from '../services/bundle-layout.ts';

/** The registrar id every mattstack-shipped row carries. */
export const MATTSTACK_REGISTRAR = 'rt';

export interface CatalogEntry {
  port: number;
  args: string[];
}

export type BundleCatalog = Map<string, CatalogEntry>;

/**
 * The apps a bundle serves: bundled helper rows of deps.lock that carry
 * `serve`. Parity anchor: repo-tools lib/bundle-layout.ts parseDepsLock
 * validates the same field, and both repos test their parser against the
 * byte-identical deps-lock-serve.fixture.json.
 */
export function parseServeCatalog(text: string): BundleCatalog {
  const raw = JSON.parse(text) as { schema?: unknown; tools?: unknown };
  if (raw.schema !== 1)
    throw new Error(`deps.lock: unsupported schema ${String(raw.schema)}`);
  if (!Array.isArray(raw.tools))
    throw new Error('deps.lock: tools must be an array');
  const catalog: BundleCatalog = new Map();
  for (const row of raw.tools as Array<Record<string, unknown> | null>) {
    if (!row || row.serve === undefined) continue;
    if (row.kind !== 'helper' || row.status !== 'bundled') continue;
    const name = row.name;
    if (typeof name !== 'string' || !name)
      throw new Error('deps.lock: a served row has no name');
    const serve = row.serve as { port?: unknown; args?: unknown } | null;
    if (typeof serve !== 'object' || serve === null)
      throw new Error(`deps.lock: ${name} serve must be an object`);
    const { port, args } = serve;
    if (
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error(`deps.lock: ${name} serve.port must be an integer port`);
    if (!Array.isArray(args) || !args.every(a => typeof a === 'string'))
      throw new Error(
        `deps.lock: ${name} serve.args must be an array of strings`
      );
    if (catalog.has(name))
      throw new Error(`deps.lock: duplicate served app ${name}`);
    catalog.set(name, { port, args: [...args] });
  }
  return catalog;
}

/**
 * The catalog in `<resourcesDir>/deps.lock`, or null when there is none to
 * enforce: outside a bundle, no readable lock, an invalid one, or a lock from
 * before any row carried `serve`. Null keeps the pre-catalog serve rules, so
 * an older bundle can never read as "serve nothing".
 */
export function readBundleCatalog(
  resourcesDir: string | null
): BundleCatalog | null {
  if (!resourcesDir) return null;
  const path = join(resourcesDir, 'deps.lock');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const catalog = parseServeCatalog(text);
    return catalog.size > 0 ? catalog : null;
  } catch (err) {
    console.error(`[catalog] ignoring ${path}: ${String(err)}`);
    return null;
  }
}

let memo: BundleCatalog | null | undefined;

/** The running bundle's catalog; a live deck's bundle does not change under it. */
export function bundleCatalog(): BundleCatalog | null {
  if (memo === undefined) memo = readBundleCatalog(bundleResourcesDir());
  return memo;
}
