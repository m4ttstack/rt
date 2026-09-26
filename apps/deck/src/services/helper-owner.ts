/**
 * Who supervises deck: the mattstack.app bundle's SMAppService helper
 * (`com.mattstack.deck.dev`, or `com.mattstack.deck` in the prod flavor) or
 * a hand-installed LaunchAgent that `deck setup` wrote before the bundle
 * existed. Both loaded at once is two supervisors fighting over one port set
 * and one state dir, so a helper-owned machine never keeps a hand agent.
 */

import { existsSync, mkdirSync, renameSync } from 'fs';
import { join, resolve } from 'path';

import { adoptHelperPath, composeServicePath } from './exec-env.ts';
import { PLATFORM_LABEL } from './manager.ts';

/** Read-only command runner; `launchctl print` goes through it. */
export type Probe = (
  argv: string[]
) => Promise<{ code: number; stdout: string }>;

export const HELPER_LABELS = [`${PLATFORM_LABEL}.dev`, PLATFORM_LABEL];

export const liveProbe: Probe = async argv => {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'ignore' });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout };
};

export const liveRun = async (argv: string[]): Promise<number> =>
  await Bun.spawn(argv, { stdout: 'ignore', stderr: 'ignore' }).exited;

const SMAPPSERVICE = 'com.apple.xpc.ServiceManagement';

interface LoadedJob {
  path: string | null;
  managedBy: string | null;
  pid: number | null;
}

function uid(): number {
  return process.getuid?.() ?? 0;
}

async function printJob(
  probe: Probe,
  label: string,
  userId: number
): Promise<LoadedJob | null> {
  const { code, stdout } = await probe([
    'launchctl',
    'print',
    `gui/${userId}/${label}`,
  ]);
  if (code !== 0) return null;
  // Top-level keys sit one tab in; nested dicts are deeper.
  const field = (key: string) =>
    new RegExp(`^\\t${key} = (.+)$`, 'm').exec(stdout)?.[1]?.trim() ?? null;
  const pid = field('pid');
  return {
    path: field('path'),
    managedBy: field('managed_by'),
    pid: pid ? Number(pid) : null,
  };
}

/** The label of the SMAppService-submitted deck job, under either flavor. */
async function helperLabel(
  probe: Probe,
  userId: number
): Promise<string | null> {
  for (const label of HELPER_LABELS) {
    const job = await printJob(probe, label, userId);
    if (job?.managedBy === SMAPPSERVICE) return label;
  }
  return null;
}

/** True when this process is the bundle helper, or launchd reports an
    SMAppService-submitted deck job under either flavor's label. */
export async function bundleHelperOwnsDeck(
  probe: Probe,
  bundleRoot: string | null,
  userId: number = uid()
): Promise<boolean> {
  if (bundleRoot) return true;
  return (await helperLabel(probe, userId)) !== null;
}

/** How to bring deck up, for a message that follows "Deck isn't running."
    `deck setup` refuses on a helper-owned machine, so it is never offered there. */
export async function deckStartHint(
  probe: Probe,
  bundleRoot: string | null,
  userId: number = uid()
): Promise<string> {
  const label = await helperLabel(probe, userId);
  if (label) {
    return `Open the mattstack app, or restart its deck helper with \`launchctl kickstart -k gui/${userId}/${label}\`.`;
  }
  if (bundleRoot) return 'Open or restart the mattstack app; it owns deck.';
  return 'Start it with `deck serve` or install it with `deck setup`.';
}

/** Who supervises deck, as the API and CLI flows need to know it. */
export interface DeckOwner {
  helperOwned(): Promise<boolean>;
  /** The launchd label of the deck serving right now; null when launchd reports none. */
  runningLabel(): Promise<string | null>;
  /** The launchd label running this very process; null when no deck job's
      pid is this one, as for a hand-started `deck serve`. */
  selfLabel(): Promise<string | null>;
}

/** The label launchd runs `pid` under, the dev helper's or the bare one the
    prod helper and a hand agent share. With no job serving as `pid`, the
    first label launchd reports running; null when neither has a process. */
export async function runningDeckLabel(
  probe: Probe,
  pid: number | null,
  userId: number = uid()
): Promise<string | null> {
  let firstRunning: string | null = null;
  for (const label of HELPER_LABELS) {
    const job = await printJob(probe, label, userId);
    if (job?.pid == null) continue;
    if (job.pid === pid) return label;
    firstRunning ??= label;
  }
  return firstRunning;
}

/** Unlike runningDeckLabel, never another deck's label: a hand-started
    deck showing the helper's label would restart the helper instead. */
export async function selfDeckLabel(
  probe: Probe,
  pid: number,
  userId: number = uid()
): Promise<string | null> {
  for (const label of HELPER_LABELS) {
    const job = await printJob(probe, label, userId);
    if (job?.pid === pid) return label;
  }
  return null;
}

export const SELF_LABEL_RETRY_MS = 60_000;

/** A process's launchd job never changes, so a found label is kept for the
    life of the process; a miss is asked again at most every
    SELF_LABEL_RETRY_MS, since launchd may not report the pid yet at boot. */
export function selfLabelCache(
  owner: DeckOwner | undefined,
  now: () => number = Date.now
): () => Promise<string | null> {
  let found: string | null = null;
  let retryAt = 0;
  let asking: Promise<string | null> | null = null;
  return async () => {
    if (found || !owner) return found;
    if (!asking && now() < retryAt) return null;
    asking ??= owner
      .selfLabel()
      .then(label => {
        found = label;
        if (!label) retryAt = now() + SELF_LABEL_RETRY_MS;
        return label;
      })
      .finally(() => {
        asking = null;
      });
    return asking;
  };
}

export function liveDeckOwner(
  bundleRoot: string | null,
  pid: number | null,
  probe: Probe = liveProbe
): DeckOwner {
  return {
    helperOwned: () => bundleHelperOwnsDeck(probe, bundleRoot),
    runningLabel: () => runningDeckLabel(probe, pid),
    selfLabel: async () => (pid === null ? null : selfDeckLabel(probe, pid)),
  };
}

export interface RetireDeps {
  probe: Probe;
  run: (argv: string[]) => Promise<number>;
  agentsDir: string;
  archiveDir: string;
  uid: number;
  selfPid: number;
}

function loadedFromAgentsDir(job: LoadedJob | null, agentsDir: string) {
  return job?.path?.startsWith(`${resolve(agentsDir)}/`) ?? false;
}

function archivePath(archiveDir: string): string {
  mkdirSync(archiveDir, { recursive: true });
  const base = join(archiveDir, `${PLATFORM_LABEL}.plist.retired`);
  return existsSync(base) ? `${base}.${Date.now()}` : base;
}

/**
 * Retire a hand-installed `com.mattstack.deck`: archive its plist so the
 * next login cannot load it, and boot it out only when launchd reports that
 * label loaded from the LaunchAgents dir. The prod helper shares the label,
 * so an SMAppService job is never booted out. A hand plist that execs a
 * bundle binary would otherwise boot itself out, and launchctl's exit code
 * is no proof the job is gone, so both are checked against launchd's report.
 */
export async function retireHandAgent(deps: RetireDeps): Promise<boolean> {
  const plist = join(resolve(deps.agentsDir), `${PLATFORM_LABEL}.plist`);
  const job = await printJob(deps.probe, PLATFORM_LABEL, deps.uid);
  if (loadedFromAgentsDir(job, deps.agentsDir)) {
    if (job!.pid === deps.selfPid) return false;
    await deps.run([
      'launchctl',
      'bootout',
      `gui/${deps.uid}/${PLATFORM_LABEL}`,
    ]);
    const after = await printJob(deps.probe, PLATFORM_LABEL, deps.uid);
    if (loadedFromAgentsDir(after, deps.agentsDir)) return false;
  }
  if (!existsSync(plist)) return false;
  renameSync(plist, archivePath(deps.archiveDir));
  return true;
}

export interface HelperBootDeps {
  bundleRoot: string | null;
  env: Record<string, string | undefined>;
  compose?: () => string;
  retire: RetireDeps;
  log: (...args: unknown[]) => void;
}

/** Runs before any port is claimed: a hand agent still holding the ports
    would otherwise win every race against the helper that owns deck. */
export async function prepareHelperBoot(deps: HelperBootDeps): Promise<void> {
  if (!deps.bundleRoot) return;
  adoptHelperPath(
    deps.env,
    deps.bundleRoot,
    deps.compose ?? composeServicePath
  );
  try {
    if (await retireHandAgent(deps.retire)) {
      deps.log(
        `[helper] retired the hand-installed ${PLATFORM_LABEL} agent and archived its plist`
      );
    }
  } catch (err) {
    deps.log('[helper] hand agent retirement failed:', err);
  }
}
