import { describe, expect, test } from 'bun:test';

import { sectionStatus } from '../sections.ts';

describe('sectionStatus', () => {
  const known = ['Billing - #pod-billing', 'Acme - #pod-acme', 'Platform QA'];

  test('an exact match is known', () => {
    expect(sectionStatus('Platform QA', known)).toEqual({
      unknown: false,
      suggestion: null,
    });
  });

  test('null known never judges', () => {
    expect(sectionStatus('Anything', null)).toEqual({
      unknown: false,
      suggestion: null,
    });
  });

  test('a renamed section suggests the entry that starts with the old name, ignoring case', () => {
    expect(sectionStatus('acme', known)).toEqual({
      unknown: true,
      suggestion: 'Acme - #pod-acme',
    });
  });

  test('the match is exact on case: a lower-cased header is unknown and suggests the real one', () => {
    expect(sectionStatus('platform qa', known)).toEqual({
      unknown: true,
      suggestion: 'Platform QA',
    });
  });

  test('falls back to an entry that contains the name', () => {
    expect(sectionStatus('QA', known)).toEqual({
      unknown: true,
      suggestion: 'Platform QA',
    });
  });

  test('no resemblance yields no suggestion', () => {
    expect(sectionStatus('Fraud', known)).toEqual({
      unknown: true,
      suggestion: null,
    });
  });

  test('an empty known list marks every section unknown without a suggestion', () => {
    expect(sectionStatus('Fraud', [])).toEqual({
      unknown: true,
      suggestion: null,
    });
  });
});
