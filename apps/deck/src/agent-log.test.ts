import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

// The redirect's whole point is that output written after it lands in the
// agent log file, uncaught-crash output included... so the assertion runs in
// a subprocess whose HOME is a scratch dir, not in this test's process.
test('redirectAgentOutput sends stdout, stderr, and crashes to agent.log', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-log-'));
  const script = join(home, 'probe.ts');
  await Bun.write(
    script,
    `import { redirectAgentOutput } from '${join(import.meta.dir, 'agent-log.ts')}';
redirectAgentOutput();
console.log('OUT-MARKER');
console.error('ERR-MARKER');
throw new Error('CRASH-MARKER');
`
  );
  const proc = Bun.spawn(['bun', script], {
    env: { ...process.env, HOME: home },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await proc.exited;
  const log = readFileSync(
    join(home, '.mattstack', 'deck', 'logs', 'agent.log'),
    'utf8'
  );
  expect(log).toContain('OUT-MARKER');
  expect(log).toContain('ERR-MARKER');
  expect(log).toContain('CRASH-MARKER');
  // 15s, not the 5s default: the probe spawns a cold `bun` child, which
  // takes well over 5s when the rest of the suite is saturating the machine
  // (solo it runs in under a second).
}, 15000);
