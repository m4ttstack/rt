// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDef, validateWrite } from '@mattstack/rt-client';
import { asRosterEntries } from './shapes';

let home: string;
const origHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'boxscore-writers-'));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

describe('boxscore writes pass validateWrite', () => {
  it('a roster built the way RosterRow builds it', () => {
    const roster = asRosterEntries([{ username: 'rmarlow' }]);
    const next = [...roster, { username: 'jdoe', name: 'J Doe' }];
    const def = getDef('mattstack.roster')!;
    expect(validateWrite(def, next, { scope: 'team' })).toEqual({ ok: true });
    expect(
      validateWrite(
        def,
        next.filter(e => e.username !== 'rmarlow'),
        {
          scope: 'team',
        }
      )
    ).toEqual({ ok: true });
  });

  it('hidden members', () => {
    const def = getDef('boxscore.hiddenMembers')!;
    expect(validateWrite(def, ['rmarlow'], { scope: 'user' })).toEqual({
      ok: true,
    });
    expect(validateWrite(def, [], { scope: 'user' })).toEqual({ ok: true });
  });
});
