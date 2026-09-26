// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBridgeRule } from '@mattstack/app-server/event-bridge';
import { getDef, validateWrite } from '@mattstack/rt-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installConsoleBridgeRule } from './event-bridge';

let home: string;
const origHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'console-bridge-'));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const BOARD_RULE: EventBridgeRule = {
  pattern: 'gate/opened/*',
  subjectPrefix: 'mr:',
  category: 'gate',
  title: '{label}',
  message: '{question}',
  url: 'http://localhost:7930/gates/{id}',
};

describe('the reconciled console rule passes validateWrite', () => {
  it('beside a board rule with deck answering, and alone with deck down', async () => {
    const writes: EventBridgeRule[][] = [];
    await installConsoleBridgeRule({
      read: () => [BOARD_RULE],
      write: next => writes.push(next),
      resolveUrl: async () => 'http://localhost:11001',
    });
    await installConsoleBridgeRule({
      read: () => [],
      write: next => writes.push(next),
      resolveUrl: async () => null,
    });
    // The reconcile may write more than once per install; every write counts.
    expect(writes.length).toBeGreaterThan(0);
    const def = getDef('rt.notify.eventBridges')!;
    for (const value of writes)
      expect(validateWrite(def, value, { scope: 'user' })).toEqual({
        ok: true,
      });
  });
});
