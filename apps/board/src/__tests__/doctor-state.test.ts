import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  doctorResumeDispatchFields,
  parseDoctorRequestBody,
  writeDoctorState,
} from '../doctor-state.ts';
import { dispatchPrompt } from '../herdr.ts';

describe('doctor state origin', () => {
  test('origin persists across subsequent patches', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'doc-')), 's.json');
    writeDoctorState(path, {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'queued',
      origin: 'auto',
    });
    const next = writeDoctorState(path, { status: 'diagnosing' });
    expect(next.origin).toBe('auto');
  });
});

describe('doctor state gate fields (merge-list widening)', () => {
  test('gateId, gateKind, and resumedGateId all persist across subsequent patches', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'doc-')), 's.json');
    writeDoctorState(path, {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'fixing',
      gateId: 'gate-1',
      gateKind: 'doctor-escalation',
    });
    const next = writeDoctorState(path, { status: 'fixing', tabId: 'w1:t1' });
    expect(next.gateId).toBe('gate-1');
    expect(next.gateKind).toBe('doctor-escalation');

    const answered = writeDoctorState(path, {
      status: 'fixing',
      resumedGateId: 'gate-1',
    });
    expect(answered.resumedGateId).toBe('gate-1');
  });
});

describe('doctor state tier/fixClasses fields (merge-list widening)', () => {
  test('tier and fixClasses persist across subsequent patches', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'doc-')), 's.json');
    writeDoctorState(path, {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'queued',
      origin: 'auto',
      tier: 'api',
      fixClasses: ['lint', 'types'],
    });
    const next = writeDoctorState(path, { status: 'fixing', tabId: 'w1:t1' });
    expect(next.tier).toBe('api');
    expect(next.fixClasses).toEqual(['lint', 'types']);
  });

  test('a manual doctor with no tier stays untiered across patches', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'doc-')), 's.json');
    writeDoctorState(path, {
      mrUrl: 'https://x/mr/1',
      iid: 1,
      status: 'queued',
      origin: 'manual',
    });
    const next = writeDoctorState(path, { status: 'fixing', tabId: 'w1:t1' });
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
