import { expect, test } from 'vitest';

import { domainForKind, GATE_KINDS } from '@mattstack/gate-kit';

test('every registered kind maps to a domain, and the map covers only registered kinds', () => {
  expect(GATE_KINDS).toEqual([
    'review-post',
    'respond-plan',
    'respond-post',
    'doctor-escalation',
  ]);
  expect(domainForKind('review-post')).toBe('review');
  expect(domainForKind('respond-plan')).toBe('respond');
  expect(domainForKind('respond-post')).toBe('respond');
  expect(domainForKind('doctor-escalation')).toBe('doctor');
  for (const kind of GATE_KINDS) {
    expect(domainForKind(kind)).toBeDefined();
  }
});

test('an unregistered kind maps to undefined, never a guess', () => {
  expect(domainForKind('self-review')).toBeUndefined();
  expect(domainForKind('clarify')).toBeUndefined();
  expect(domainForKind('')).toBeUndefined();
});
