import { describe, expect, test } from 'bun:test';

import type { TriageConfig } from '../triage/config.ts';
import type { DispatchMemory } from '../triage/memory.ts';
import {
  IDENTITY_TTL_MS,
  manualDoctorFields,
  resolveDispatchIdentity,
} from '../triage/run.ts';

function memoryWith(identity: DispatchMemory['identity']): DispatchMemory {
  return { identity, mrs: {} };
}

const TRIAGE = {
  tier: 'api',
  fixClasses: {
    retryFlake: true,
    inheritedNoteDraft: true,
    cleanApiRebase: false,
    mechanicalLint: true,
    codeFix: false,
  },
} as TriageConfig;

describe('resolveDispatchIdentity', () => {
  test('fresh cache wins without a token round-trip', async () => {
    const mem = memoryWith({ username: 'octo-cat', fetchedAt: 1000 });
    const identity = await resolveDispatchIdentity(
      mem,
      async () => {
        throw new Error('must not be called');
      },
      () => 1000 + IDENTITY_TTL_MS - 1
    );
    expect(identity).toBe('octo-cat');
  });

  test('stale cache re-validates and writes back', async () => {
    const mem = memoryWith({ username: 'old', fetchedAt: 0 });
    const identity = await resolveDispatchIdentity(
      mem,
      async () => ({ username: 'fresh' }),
      () => IDENTITY_TTL_MS + 1
    );
    expect(identity).toBe('fresh');
    expect(mem.identity).toEqual({
      username: 'fresh',
      fetchedAt: IDENTITY_TTL_MS + 1,
    });
  });

  test('a failed validation resolves null (branch-writing classes stay off)', async () => {
    const identity = await resolveDispatchIdentity(
      memoryWith(null),
      async () => {
        throw new Error('no token');
      }
    );
    expect(identity).toBeNull();
  });
});

describe('manualDoctorFields', () => {
  test('composes exactly as the auto path: tier mapping plus author-gated classes', () => {
    const own = manualDoctorFields(TRIAGE, 'octo-cat', 'octo-cat');
    expect(own.tier).toBe('api');
    expect(own.fixClasses).toEqual([
      'retry-flake',
      'inherited-note-draft',
      'mechanical-lint',
    ]);
    const foreign = manualDoctorFields(TRIAGE, 'someone-else', 'octo-cat');
    expect(foreign.fixClasses).toEqual(['retry-flake', 'inherited-note-draft']);
    const checkout = manualDoctorFields(
      { ...TRIAGE, tier: 'checkout' } as TriageConfig,
      'a',
      null
    );
    expect(checkout.tier).toBeUndefined();
  });
});
