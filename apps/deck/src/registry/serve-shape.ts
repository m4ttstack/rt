import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { isDevMode } from '../api/dev-mode.ts';
import { bundleHelpersDir } from '../services/bundle-layout.ts';
import {
  bundleCatalog,
  MATTSTACK_REGISTRAR,
  type BundleCatalog,
} from './bundle-catalog.ts';
import {
  readDeckManifest,
  startArgv,
  type DeckManifest,
} from './deck-manifest.ts';
import { addIssue, clearIssues, type AppRecord } from './records.ts';

export interface ResolvedShape {
  command: string[];
  cwd: string;
}

/** Prod data dir convention for managed apps: derived from the name, never stored. */
export function dataDir(name: string): string {
  return join(process.env.HOME ?? homedir(), '.mattstack', name);
}

/** The installed bundle binary for a managed app, or null when deck runs outside
    a bundle or the binary is not installed. Existence is checked here so no
    caller can ever build a phantom bundle command. */
export function bundleBinaryPath(
  name: string,
  helpersDir: string | null = bundleHelpersDir()
): string | null {
  if (!helpersDir) return null;
  const bin = join(helpersDir, name);
  return existsSync(bin) ? bin : null;
}

export type LinkedManifest =
  | { state: 'unlinked' }
  | { state: 'broken'; error: string }
  | { state: 'linked'; manifest: DeckManifest; dir: string };

/** The one dir + manifest validity check, shared by the resolver and the
    command-route gate so the two cannot diverge. */
export function readLinkedManifest(record: AppRecord): LinkedManifest {
  const dir = record.dev?.workingDirectory;
  if (!dir) return { state: 'unlinked' };
  if (!existsSync(dir))
    return { state: 'broken', error: `${dir} does not exist` };
  const parsed = readDeckManifest(dir);
  if (parsed === null)
    return { state: 'broken', error: `no mattstack.deck.json in ${dir}` };
  if (!parsed.ok) return { state: 'broken', error: parsed.error };
  return { state: 'linked', manifest: parsed.manifest, dir };
}

/** Command keys the board may show for a record, mirroring the command route's gate. */
export function commandKeysFor(
  record: AppRecord,
  devMode: boolean
): string[] | undefined {
  if (record.managedBy === 'user') {
    const keys = Object.keys(record.commands ?? {});
    return keys.length ? keys : undefined;
  }
  if (!devMode || !record.dev?.workingDirectory) return undefined;
  const link = readLinkedManifest(record);
  if (link.state !== 'linked') return undefined;
  const keys = Object.keys(link.manifest.dev ?? {}).filter(k => k !== 'start');
  return keys.length ? keys : undefined;
}

export interface ServeShapeDeps {
  devMode?: () => boolean;
  /** Test seam for bundleBinaryPath's helpers dir; default derives from the running bundle. */
  helpersDir?: string | null;
  /** Test seam for the served-app catalog; default reads the running bundle's deps.lock. */
  catalog?: BundleCatalog | null;
}

export interface Flavor {
  dev: boolean;
  helpersDir: string | null;
  catalog: BundleCatalog | null;
}

export function resolveFlavor(deps: ServeShapeDeps = {}): Flavor {
  return {
    dev: (deps.devMode ?? isDevMode)(),
    helpersDir:
      deps.helpersDir !== undefined ? deps.helpersDir : bundleHelpersDir(),
    catalog: deps.catalog !== undefined ? deps.catalog : bundleCatalog(),
  };
}

/** Prod serves exactly the bundle's catalog: an rt row outside it keeps its
    record and dev link for the other flavor but runs nowhere here. */
export function notServedHere(
  record: AppRecord,
  deps: ServeShapeDeps = {}
): boolean {
  if (record.managedBy !== MATTSTACK_REGISTRAR) return false;
  const { dev, catalog } = resolveFlavor(deps);
  return !dev && catalog !== null && !catalog.has(record.name);
}

/** rt setup stores the absolute helper path of whichever flavor ran it, so any
    bundle's Helpers/<name> counts, not only the running one's. */
function isBundledHelperPath(argv0: string | undefined, name: string): boolean {
  return !!argv0 && argv0.endsWith(`.app/Contents/Helpers/${name}`);
}

export function sourceShape(record: AppRecord): ResolvedShape | null {
  const link = readLinkedManifest(record);
  if (link.state !== 'linked') return null;
  const start = link.manifest.dev?.start;
  if (!start) return null;
  return { command: startArgv(start), cwd: link.dir };
}

/** A stored command is the bundle shape ONLY when its argv0 lives inside the
    installed bundle's Helpers dir — what rt setup genuinely registers
    (absolute bundled binary, possibly with serve args like gitq's `board`).
    Anything else stored on a managed row is legacy drift and never serves. */
function storedBundleCommand(
  record: AppRecord,
  helpersDir: string | null
): ResolvedShape | null {
  const argv0 = record.command?.[0];
  if (!argv0 || !helpersDir) return null;
  if (!argv0.startsWith(helpersDir + '/') || !existsSync(argv0)) return null;
  return {
    command: record.command!,
    cwd: record.workingDirectory ?? dataDir(record.name),
  };
}

export function bundleShape(
  record: AppRecord,
  helpersDir?: string | null,
  catalog?: BundleCatalog | null
): ResolvedShape | null {
  const dir = helpersDir !== undefined ? helpersDir : bundleHelpersDir();
  const served = catalog !== undefined ? catalog : bundleCatalog();
  const entry = served?.get(record.name);
  if (entry) {
    const bin = bundleBinaryPath(record.name, dir);
    return bin
      ? { command: [bin, ...entry.args], cwd: dataDir(record.name) }
      : null;
  }
  const stored = storedBundleCommand(record, dir);
  if (stored) return stored;
  // With a catalog, a helper outside it is a tool (the gitq CLI), never an app.
  if (served) return null;
  const bin = bundleBinaryPath(record.name, dir);
  return bin ? { command: [bin], cwd: dataDir(record.name) } : null;
}

function issue(name: string, message: string): void {
  addIssue(name, { source: 'dev-link', message, at: new Date().toISOString() });
}

export function serveShape(
  record: AppRecord,
  deps: ServeShapeDeps = {}
): ResolvedShape | null {
  if (record.managedBy === 'user') {
    clearIssues(record.name, 'dev-link');
    return { command: record.command!, cwd: record.workingDirectory! };
  }

  const { dev, helpersDir, catalog } = resolveFlavor(deps);
  const source = sourceShape(record);
  const bundle = bundleShape(record, helpersDir, catalog);
  const linkBroken = readLinkedManifest(record).state === 'broken';
  const chosen = dev ? (source ?? bundle) : (bundle ?? source);
  // A stored command that is not the bundled binary is a pre-manifest row —
  // it never serves, and staying quiet about it would hide real drift.
  const legacyIgnored =
    !!record.command?.length &&
    storedBundleCommand(record, helpersDir) === null &&
    !(
      catalog?.has(record.name) &&
      isBundledHelperPath(record.command[0], record.name)
    );

  if (!chosen) {
    const legacyHint = legacyIgnored
      ? '; legacy stored command ignored — run `deck register --dir <source repo>` to relink'
      : '';
    issue(
      record.name,
      `no runnable shape for ${record.name} (no bundle, no valid source)${legacyHint}`
    );
    return null;
  }
  if (legacyIgnored) {
    issue(
      record.name,
      `legacy stored command on ${record.name} ignored — run \`deck register --dir <source repo>\` to refresh it`
    );
  } else if (chosen === bundle && linkBroken) {
    issue(
      record.name,
      `dev source ${record.dev!.workingDirectory} missing or invalid; running bundled`
    );
  } else if (chosen === source && !bundle && !dev) {
    issue(
      record.name,
      `bundle for ${record.name} not installed; serving source`
    );
  } else {
    clearIssues(record.name, 'dev-link');
  }
  return chosen;
}
