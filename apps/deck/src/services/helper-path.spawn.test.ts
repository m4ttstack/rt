import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

// Bun resolves a spawn's argv0, and seeds the child's environment, from the
// PATH it saw at process start: assigning process.env.PATH later changes
// neither unless the spawn passes env explicitly. So the proof has to be a
// real process that starts on launchd's bare PATH.
const BARE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function fakeToolDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deck-helper-path-'));
  const tool = (name: string, body: string) => {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  };
  tool('cloudflared', '#!/bin/sh\necho \'[{"id":"u-1","name":"t"}]\'\n');
  // portless is a node script: its shebang only resolves if the child
  // itself inherits the composed PATH, not just the spawn's argv0 lookup.
  tool('fakenode', '#!/bin/sh\nexit 0\n');
  tool('portless', '#!/usr/bin/env fakenode\n');
  return dir;
}

async function runAsHelper(script: string, dir: string): Promise<string> {
  const file = join(dir, 'probe.ts');
  writeFileSync(file, script);
  const proc = Bun.spawn([process.execPath, file], {
    env: { HOME: dir, PATH: BARE_PATH, LOCAL_STATE_DIR: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return (out + err).trim();
}

const prelude = (dir: string) => `
import { adoptHelperPath } from '${join(import.meta.dir, 'exec-env.ts')}';
adoptHelperPath(process.env, '/Applications/m.app', () => '${dir}:${BARE_PATH}');
`;

test('a bundle helper finds cloudflared on its composed PATH', async () => {
  const dir = fakeToolDir();
  const out = await runAsHelper(
    `${prelude(dir)}
import { CloudflaredCli } from '${join(import.meta.dir, '..', 'edge', 'tunnel.ts')}';
console.log(JSON.stringify(await new CloudflaredCli().list()));
`,
    dir
  );

  expect(out).toBe('[{"name":"t","uuid":"u-1","connections":0}]');
}, 15_000);

test('a bundle helper runs portless with the composed PATH in its env', async () => {
  const dir = fakeToolDir();
  const out = await runAsHelper(
    `${prelude(dir)}
import { PortlessCli } from '${join(import.meta.dir, '..', 'edge', 'portless.ts')}';
await new PortlessCli().alias('x', 1234);
console.log('aliased');
`,
    dir
  );

  expect(out).toBe('aliased');
}, 15_000);

test('a bundle helper runs a dev command with the composed PATH in its env', async () => {
  const dir = fakeToolDir();
  const out = await runAsHelper(
    `${prelude(dir)}
import { commandRunStatus, startCommandRun } from '${join(import.meta.dir, 'command-runner.ts')}';
const run = startCommandRun({ name: 'x', cmd: 'build', shell: 'fakenode', workingDirectory: '${dir}' }, { logDir: '${dir}' });
if (!run.started) throw new Error('busy');
let status = commandRunStatus('x', run.runId);
while (status?.status === 'running') {
  await Bun.sleep(20);
  status = commandRunStatus('x', run.runId);
}
console.log('exit', status?.exitCode);
`,
    dir
  );

  expect(out).toBe('exit 0');
}, 15_000);
