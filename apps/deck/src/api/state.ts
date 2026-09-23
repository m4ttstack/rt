import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// `homedir()` alone is frozen to whatever HOME was at process start -- Bun
// does not track later mutations of process.env.HOME through it, so a
// test's HOME fake (or any late reassignment) never moves it. `process.env.HOME
// ?? homedir()` reads the live env var first, per rt-client's paths.ts
// convention, falling back to `homedir()` only when HOME is unset entirely.
export function stateDir(): string {
  return (
    process.env.LOCAL_STATE_DIR ??
    join(process.env.HOME ?? homedir(), '.mattstack', 'deck')
  );
}

/** Where state lived before the Local -> Deck rename. Adoption source only. */
export function legacyStateDir(): string {
  return (
    process.env.LOCAL_LEGACY_STATE_DIR ??
    join(process.env.HOME ?? homedir(), '.mattstack', 'local')
  );
}

/**
 * Local -> Deck rename (ruled): a machine that ran the platform before this
 * rename has its whole state (registry, settings, logs, api.json) under the
 * pre-rename directory. Adopt it once, at boot, before anything reads or
 * writes stateDir() -- called from boot-env.ts, which is why this has to be
 * a plain function rather than something baked into stateDir() itself:
 * stateDir() is called many times over a process's life and must stay a
 * cheap, pure path computation, not repeat a filesystem check on every call.
 *
 * A rename is the simplest safe move here: both dirs are always siblings
 * under ~/.mattstack, i.e. the same filesystem, so it's atomic. Never
 * overwrites: a no-op whenever the new dir already exists, the legacy dir
 * doesn't, or they resolve to the same path.
 */
export function adoptLegacyStateDir(): void {
  const newDir = stateDir();
  const legacyDir = legacyStateDir();
  if (newDir === legacyDir) return;
  if (existsSync(newDir) || !existsSync(legacyDir)) return;
  renameSync(legacyDir, newDir);
}

export function logsDir(): string {
  return join(stateDir(), 'logs');
}

/** Where the CLI finds a running platform. Written at serve boot. */
export function writeApiInfo(port: number): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(
    join(stateDir(), 'api.json'),
    JSON.stringify({ port, pid: process.pid })
  );
}

export function readApiInfo(): { port: number; pid: number } | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(stateDir(), 'api.json'), 'utf8')
    );
    return Number.isInteger(parsed.port) && Number.isInteger(parsed.pid)
      ? { port: parsed.port, pid: parsed.pid }
      : null;
  } catch {
    return null;
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function apiAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/status`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Serve boot's api.json write. A deck already recorded there that is alive
 * and answering owns the file: a second serve (hand-run, or a launchd retry
 * racing the outgoing instance) must not repoint every CLI call and app
 * lookup at itself. Returns whether this process wrote the file.
 */
export async function claimApiInfo(
  port: number,
  probe: {
    isAlive: (pid: number) => boolean;
    answers: (port: number) => Promise<boolean>;
  } = { isAlive, answers: apiAnswers }
): Promise<boolean> {
  const current = readApiInfo();
  if (
    current &&
    current.pid !== process.pid &&
    // This process already holds `port`, so a record naming it can only be
    // answered by this process: its live pid is a reused one.
    current.port !== port &&
    probe.isAlive(current.pid) &&
    (await probe.answers(current.port))
  ) {
    return false;
  }
  writeApiInfo(port);
  return true;
}
