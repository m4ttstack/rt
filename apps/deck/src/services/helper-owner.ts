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

/** True when this process is the bundle helper, or launchd reports an
    SMAppService-submitted deck job under either flavor's label. */
export async function bundleHelperOwnsDeck(
  probe: Probe,
  bundleRoot: string | null,
  userId: number = uid()
): Promise<boolean> {
  if (bundleRoot) return true;
  for (const label of HELPER_LABELS) {
    const job = await printJob(probe, label, userId);
    if (job?.managedBy === SMAPPSERVICE) return true;
  }
  return false;
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
