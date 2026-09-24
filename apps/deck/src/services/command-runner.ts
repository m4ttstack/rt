import { randomBytes } from 'crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { isAlive, logsDir } from '../api/state.ts';

export type SpawnFn = (
  argv: string[],
  opts: { cwd: string; stdout: number; stderr: number; detached: boolean }
) => { exited: Promise<number>; pid?: number };

// A detached run outlives the deck that started it, and with it the in-memory
// `runs` entry, so it is also recorded on disk for the next deck to see. A pid
// alone could be reused by an unrelated process after the run ends, so the
// record also holds the process's start time; the command line cannot serve,
// since `sh -c` execs a lone command in place and ps then shows that command.
const runPidFile = (dir: string, name: string) => join(dir, `${name}.run.pid`);

// lstart's text follows LANG and TZ, which differ between a launchd deck and
// one started from a terminal, so both sides of the comparison pin them.
function startTimeOf(pid: number): string {
  const ps = Bun.spawnSync(['/bin/ps', '-o', 'lstart=', '-p', String(pid)], {
    env: { LC_ALL: 'C', TZ: 'UTC' },
  });
  return ps.stdout.toString().trim();
}

function removeQuietly(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    /* a leftover record is re-checked, and removed, on the next start */
  }
}

function detachedRunAlive(dir: string, name: string): boolean {
  const file = runPidFile(dir, name);
  let rec: { pid?: unknown; started?: unknown };
  try {
    rec = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  const { pid, started } = rec;
  const live =
    typeof pid === 'number' &&
    Number.isInteger(pid) &&
    pid > 0 &&
    typeof started === 'string' &&
    started !== '' &&
    isAlive(pid) &&
    startTimeOf(pid) === started;
  if (!live) removeQuietly(file);
  return live;
}

interface Run {
  runId: string;
  cmd: string;
  status: 'running' | 'exited';
  exitCode?: number;
}

const runs = new Map<string, Run>(); // keyed by app name: one in-flight run per app

export function resetRuns(): void {
  runs.clear();
}

// Explicit env: Bun otherwise spawns with the PATH the process started on,
// never the one adoptHelperPath composes.
const defaultSpawn: SpawnFn = (argv, opts) =>
  Bun.spawn(argv, { ...opts, env: process.env }) as unknown as {
    exited: Promise<number>;
    pid: number;
  };

export function startCommandRun(
  input: {
    name: string;
    cmd: string;
    shell: string;
    workingDirectory: string;
    detached?: boolean;
  },
  deps: { spawn?: SpawnFn; logDir?: string } = {}
): { started: true; runId: string } | { started: false; reason: 'busy' } {
  const active = runs.get(input.name);
  if (active && active.status === 'running')
    return { started: false, reason: 'busy' };

  const dir = deps.logDir ?? logsDir();
  if (detachedRunAlive(dir, input.name))
    return { started: false, reason: 'busy' };
  mkdirSync(dir, { recursive: true });
  // Append into the app's existing deck log, so `deck logs` shows command output.
  const out = openSync(join(dir, `${input.name}.out.log`), 'a');
  const errFd = openSync(join(dir, `${input.name}.err.log`), 'a');

  const runId = randomBytes(8).toString('hex');
  const run: Run = { runId, cmd: input.cmd, status: 'running' };
  runs.set(input.name, run);

  let proc: ReturnType<SpawnFn>;
  try {
    proc = (deps.spawn ?? defaultSpawn)(['sh', '-c', input.shell], {
      cwd: input.workingDirectory,
      stdout: out,
      stderr: errFd,
      detached: input.detached ?? false,
    });
  } catch (err) {
    // A synchronous spawn failure must not leave the app permanently busy or
    // leak the two fds opened above -- nothing else will ever close them.
    runs.delete(input.name);
    try {
      closeSync(out);
    } catch {
      /* already closed */
    }
    try {
      closeSync(errFd);
    } catch {
      /* already closed */
    }
    throw err;
  }
  const pidFile = runPidFile(dir, input.name);
  const recorded = input.detached && proc.pid !== undefined;
  if (recorded) {
    try {
      writeFileSync(
        pidFile,
        JSON.stringify({ pid: proc.pid, started: startTimeOf(proc.pid!) })
      );
    } catch {
      /* unrecorded: only a restarted deck loses the busy guard */
    }
  }
  proc.exited.then(code => {
    run.status = 'exited';
    run.exitCode = code;
    // Bun.spawn's ownership of numeric stdio fds is ambiguous; a bare closeSync
    // could double-close and throw EBADF, so each close is independently guarded.
    try {
      closeSync(out);
    } catch {
      /* already closed */
    }
    try {
      closeSync(errFd);
    } catch {
      /* already closed */
    }
    if (recorded) removeQuietly(pidFile);
  });

  return { started: true, runId };
}

export function commandRunStatus(
  name: string,
  runId: string
): { status: 'running' | 'exited'; exitCode?: number } | null {
  const run = runs.get(name);
  if (!run || run.runId !== runId) return null;
  return run.exitCode === undefined
    ? { status: run.status }
    : { status: run.status, exitCode: run.exitCode };
}
