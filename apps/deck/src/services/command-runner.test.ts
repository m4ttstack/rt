import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

import {
  commandRunStatus,
  resetRuns,
  startCommandRun,
} from './command-runner.ts';

beforeEach(() => resetRuns());

function fakeSpawn(exit: Promise<number>) {
  const calls: Array<{ argv: string[]; cwd: string; detached?: boolean }> = [];
  const spawn = (
    argv: string[],
    opts: { cwd: string; stdout: number; stderr: number; detached: boolean }
  ) => {
    calls.push({ argv, cwd: opts.cwd, detached: opts.detached });
    return { exited: exit };
  };
  return { spawn, calls };
}

test('a detached run is spawned in its own process group; others are not', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const { spawn, calls } = fakeSpawn(new Promise(() => {}));
  startCommandRun(
    {
      name: 'deck',
      cmd: 'deploy',
      shell: 'bun run deploy',
      workingDirectory: '/tmp/deck',
      detached: true,
    },
    { spawn, logDir }
  );
  startCommandRun(
    { name: 'chat', cmd: 'deploy', shell: 's', workingDirectory: '/tmp' },
    { spawn, logDir }
  );
  expect(calls.map(c => c.detached)).toEqual([true, false]);
});

test('a detached run still in flight keeps the app busy after deck restarts', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const input = {
    name: 'deck',
    cmd: 'deploy',
    shell: 'sleep 30',
    workingDirectory: logDir,
    detached: true,
  };
  expect(startCommandRun(input, { logDir }).started).toBe(true);
  const { pid } = JSON.parse(
    readFileSync(join(logDir, 'deck.run.pid'), 'utf8')
  ) as { pid: number };
  // Long enough for sh to exec its single command in place, which changes
  // what ps reports as the process's command line.
  await new Promise(res => setTimeout(res, 300));
  try {
    resetRuns();
    expect(startCommandRun(input, { logDir })).toEqual({
      started: false,
      reason: 'busy',
    });
  } finally {
    process.kill(-pid);
  }
});

test('a pid file naming a live but unrelated process is stale: the run starts and the file is replaced', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  writeFileSync(
    join(logDir, 'deck.run.pid'),
    JSON.stringify({ pid: process.pid, started: 'Thu Jan  1 00:00:00 1970' })
  );
  const spawn = () => ({ exited: new Promise<number>(() => {}), pid: 4242 });
  const r = startCommandRun(
    {
      name: 'deck',
      cmd: 'deploy',
      shell: 'bun run deploy',
      workingDirectory: '/tmp',
      detached: true,
    },
    { spawn, logDir }
  );
  expect(r.started).toBe(true);
  expect(
    JSON.parse(readFileSync(join(logDir, 'deck.run.pid'), 'utf8')).pid
  ).toBe(4242);
});

test('a detached run that exits in the same deck removes its pid file', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const spawn = () => ({ exited: Promise.resolve(0), pid: 4242 });
  startCommandRun(
    {
      name: 'deck',
      cmd: 'deploy',
      shell: 's',
      workingDirectory: '/tmp',
      detached: true,
    },
    { spawn, logDir }
  );
  await new Promise(res => setTimeout(res, 10));
  expect(existsSync(join(logDir, 'deck.run.pid'))).toBe(false);
});

test('a detached run whose process is gone does not keep the app busy', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const dead = () => ({
    exited: new Promise<number>(() => {}),
    pid: 2 ** 22 + 7,
  });
  const input = {
    name: 'deck',
    cmd: 'deploy',
    shell: 's',
    workingDirectory: '/tmp',
    detached: true,
  };
  expect(startCommandRun(input, { spawn: dead, logDir }).started).toBe(true);
  resetRuns();
  expect(startCommandRun(input, { spawn: dead, logDir }).started).toBe(true);
});

test('the default spawn really gives a detached run its own process group', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const r = startCommandRun(
    {
      name: 'probe',
      cmd: 'pgid',
      shell: 'ps -o pgid= -p $$',
      workingDirectory: logDir,
      detached: true,
    },
    { logDir }
  );
  if (!r.started) throw new Error('unreachable');
  for (let i = 0; i < 100; i++) {
    if (commandRunStatus('probe', r.runId)?.status === 'exited') break;
    await new Promise(res => setTimeout(res, 20));
  }
  const own = Bun.spawnSync(['ps', '-o', 'pgid=', '-p', String(process.pid)])
    .stdout.toString()
    .trim();
  const child = (await Bun.file(join(logDir, 'probe.out.log')).text()).trim();
  expect(child).not.toBe('');
  expect(child).not.toBe(own);
});

test('spawns sh -c in the working directory and returns a runId', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const { spawn, calls } = fakeSpawn(new Promise(() => {})); // never resolves = still running
  const r = startCommandRun(
    {
      name: 'chat',
      cmd: 'deploy',
      shell: 'bun run deploy',
      workingDirectory: '/tmp/app',
    },
    { spawn, logDir }
  );
  expect(r.started).toBe(true);
  if (!r.started) throw new Error('unreachable');
  expect(calls[0].argv).toEqual(['sh', '-c', 'bun run deploy']);
  expect(calls[0].cwd).toBe('/tmp/app');
  expect(commandRunStatus('chat', r.runId)!.status).toBe('running');
});

test('refuses a second run while one is in flight (busy)', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const { spawn } = fakeSpawn(new Promise(() => {}));
  const first = startCommandRun(
    { name: 'chat', cmd: 'deploy', shell: 's', workingDirectory: '/tmp' },
    { spawn, logDir }
  );
  expect(first.started).toBe(true);
  const second = startCommandRun(
    { name: 'chat', cmd: 'build', shell: 's', workingDirectory: '/tmp' },
    { spawn, logDir }
  );
  expect(second.started).toBe(false);
});

test('status flips to exited with the code when the process ends', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const { spawn } = fakeSpawn(Promise.resolve(0));
  const r = startCommandRun(
    { name: 'chat', cmd: 'deploy', shell: 's', workingDirectory: '/tmp' },
    { spawn, logDir }
  );
  if (!r.started) throw new Error('unreachable');
  await new Promise(res => setTimeout(res, 10)); // let the exited handler run
  expect(commandRunStatus('chat', r.runId)).toEqual({
    status: 'exited',
    exitCode: 0,
  });
});

test('unknown run is null', () => {
  expect(commandRunStatus('chat', 'nope')).toBeNull();
});

test('a synchronous spawn failure cleans up the run record instead of leaving the app stuck busy', () => {
  const logDir = mkdtempSync(join(tmpdir(), 'runlog-'));
  const throwingSpawn = () => {
    throw new Error('spawn failed');
  };
  expect(() =>
    startCommandRun(
      {
        name: 'chat',
        cmd: 'deploy',
        shell: 'bun run deploy',
        workingDirectory: '/tmp/app',
      },
      { spawn: throwingSpawn, logDir }
    )
  ).toThrow('spawn failed');

  const { spawn } = fakeSpawn(new Promise(() => {}));
  const retry = startCommandRun(
    {
      name: 'chat',
      cmd: 'deploy',
      shell: 'bun run deploy',
      workingDirectory: '/tmp/app',
    },
    { spawn, logDir }
  );
  expect(retry.started).toBe(true);
});
