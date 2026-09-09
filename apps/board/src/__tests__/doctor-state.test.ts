import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';

import { openStateDb } from '../state/db.ts';
import {
  doctorFilePath,
  doctorResumeDispatchFields,
  parseDoctorRequestBody,
  writeDoctorState,
} from '../doctor-state.ts';
import { dispatchPrompt } from '../herdr.ts';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('doctor state origin', () => {
  test('origin persists across subsequent patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      { mrUrl: 'https://x/mr/1', iid: 1, status: 'queued', origin: 'auto' },
      1000,
      db
    );
    const next = writeDoctorState(path, { status: 'diagnosing' }, 2000, db);
    expect(next.origin).toBe('auto');
  });
});

describe('writeDoctorState identity', () => {
  test('a write with no prior row and no identity throws loudly', () => {
    expect(() =>
      writeDoctorState(
        doctorFilePath('https://x/mr/1'),
        { status: 'diagnosing' },
        1000,
        db
      )
    ).toThrow(/no prior row and no identity/);
  });
});

describe('doctor state gate fields (merge-list widening)', () => {
  test('gateId, gateKind, and resumedGateId all persist across subsequent patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        status: 'fixing',
        gateId: 'gate-1',
        gateKind: 'doctor-escalation',
      },
      1000,
      db
    );
    const next = writeDoctorState(
      path,
      { status: 'fixing', tabId: 'w1:t1' },
      2000,
      db
    );
    expect(next.gateId).toBe('gate-1');
    expect(next.gateKind).toBe('doctor-escalation');

    const answered = writeDoctorState(
      path,
      { status: 'fixing', resumedGateId: 'gate-1' },
      3000,
      db
    );
    expect(answered.resumedGateId).toBe('gate-1');
  });
});

describe('doctor state tier/fixClasses fields (merge-list widening)', () => {
  test('tier and fixClasses persist across subsequent patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      {
        mrUrl: 'https://x/mr/1',
        iid: 1,
        status: 'queued',
        origin: 'auto',
        tier: 'api',
        fixClasses: ['lint', 'types'],
      },
      1000,
      db
    );
    const next = writeDoctorState(
      path,
      { status: 'fixing', tabId: 'w1:t1' },
      2000,
      db
    );
    expect(next.tier).toBe('api');
    expect(next.fixClasses).toEqual(['lint', 'types']);
  });

  test('a manual doctor with no tier stays untiered across patches', () => {
    const path = doctorFilePath('https://x/mr/1');
    writeDoctorState(
      path,
      { mrUrl: 'https://x/mr/1', iid: 1, status: 'queued', origin: 'manual' },
      1000,
      db
    );
    const next = writeDoctorState(
      path,
      { status: 'fixing', tabId: 'w1:t1' },
      2000,
      db
    );
    expect(next.tier).toBeUndefined();
    expect(next.fixClasses).toBeUndefined();
  });
});

describe('resumed doctor dispatch carries its original tier/fixClasses', () => {
  test('an api-tier doctor with fix classes resumes with --tier, --fix-classes, and --draft-bin', async () => {
    const state = { tier: 'api', fixClasses: ['lint', 'types'] };
    const prompt = await dispatchPrompt('board:doctor', {
      mrUrl: 'https://x/mr/1',
      statePath: '/state/doctors/x.json',
      statusBin: '/bin/board',
      resumedGate: 'gate-1',
      ...doctorResumeDispatchFields(state),
    });
    expect(prompt).toContain('--tier api');
    expect(prompt).toContain('--fix-classes lint,types');
    expect(prompt).toContain('--draft-bin');
  });

  test('a manual checkout-tier doctor (no tier on file) resumes without --tier or --fix-classes', async () => {
    const prompt = await dispatchPrompt('board:doctor', {
      mrUrl: 'https://x/mr/1',
      statePath: '/state/doctors/x.json',
      statusBin: '/bin/board',
      resumedGate: 'gate-1',
      ...doctorResumeDispatchFields(undefined),
    });
    expect(prompt).not.toContain('--tier');
    expect(prompt).not.toContain('--fix-classes');
    expect(prompt).toContain('--draft-bin');
  });
});

describe('parseDoctorRequestBody', () => {
  const base = { mrUrl: 'https://gitlab.com/o/r/-/merge_requests/3', iid: 3 };

  test('plain launch body parses without a mode', () => {
    expect(parseDoctorRequestBody(base)).toEqual({ ...base, mode: undefined });
  });

  test('mode rebase is carried through', () => {
    expect(parseDoctorRequestBody({ ...base, mode: 'rebase' })).toEqual({
      ...base,
      mode: 'rebase',
    });
  });

  test('an unknown mode is rejected', () => {
    expect(parseDoctorRequestBody({ ...base, mode: 'fix-all' })).toBeNull();
  });
});
