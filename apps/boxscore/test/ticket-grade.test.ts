import { describe, expect, it } from 'vitest';

import { textRefGrade } from '../src/server/linear/ticket.js';

const base = {
  title: 'Refactor widgets',
  sourceBranch: 'refactor-widgets',
  description: null as string | null,
};

describe('textRefGrade', () => {
  it('grades a title reference closing', () => {
    expect(
      textRefGrade(
        { ...base, title: 'ACME-3027: delete v1 components' },
        'ACME-3027'
      )
    ).toBe('closing');
  });

  it('grades a branch reference closing, in dash and underscore forms', () => {
    expect(
      textRefGrade(
        { ...base, sourceBranch: 'acme-3027-delete-v1' },
        'ACME-3027'
      )
    ).toBe('closing');
    expect(
      textRefGrade(
        { ...base, sourceBranch: 'acme_3027_delete_v1' },
        'ACME-3027'
      )
    ).toBe('closing');
  });

  it('grades a closing keyword in the description closing, through markdown links', () => {
    const description =
      'Closes [ACME-2994](https://linear.app/acme/issue/ACME-2994/foo).';
    expect(textRefGrade({ ...base, description }, 'ACME-2994')).toBe('closing');
  });

  it('grades a bare description mention as mention', () => {
    expect(
      textRefGrade(
        { ...base, description: 'context from ACME-28 applies here' },
        'ACME-28'
      )
    ).toBe('mention');
  });

  it('keeps a keyword too far from the identifier at mention grade', () => {
    const description = `Fixes the flaky loader. ${'x'.repeat(40)} ACME-28 is related.`;
    expect(textRefGrade({ ...base, description }, 'ACME-28')).toBe('mention');
  });

  it('does not prefix-match identifiers in title or branch', () => {
    expect(
      textRefGrade({ ...base, title: 'ACME-3027: thing' }, 'ACME-302')
    ).toBeNull();
    expect(
      textRefGrade({ ...base, sourceBranch: 'acme-3027-delete-v1' }, 'ACME-302')
    ).toBeNull();
  });

  it('returns null when the identifier appears nowhere', () => {
    expect(textRefGrade(base, 'ACME-1')).toBeNull();
  });

  it('caps revert MRs at mention grade even with a title reference', () => {
    expect(
      textRefGrade(
        { ...base, title: 'Revert "ACME-3027: delete v1 components"' },
        'ACME-3027'
      )
    ).toBe('mention');
  });

  it('accepts the colon identifier form', () => {
    expect(
      textRefGrade({ ...base, description: 'fixes ACME:28' }, 'ACME-28')
    ).toBe('closing');
  });
});
