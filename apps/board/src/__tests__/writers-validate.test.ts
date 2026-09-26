import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { getDef, validateWrite } from '@mattstack/rt-client';
import { boardBridgeRule } from '../gates/ingest.ts';

let home: string;
const origHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'board-writers-'));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

test('the gate bridge rule passes validateWrite alone and beside another rule', () => {
  const def = getDef('rt.notify.eventBridges')!;
  const rule = boardBridgeRule('http://localhost:7930');
  expect(validateWrite(def, [rule], { scope: 'user' })).toEqual({ ok: true });
  expect(
    validateWrite(
      def,
      [
        rule,
        {
          pattern: 'gate/opened/*',
          subjectPrefix: 'run:',
          category: 'gate',
          title: '{label}',
          message: '{question}',
          url: 'http://localhost:11001/gates/{id}',
          owner: 'human',
        },
      ],
      { scope: 'user' }
    )
  ).toEqual({ ok: true });
});
