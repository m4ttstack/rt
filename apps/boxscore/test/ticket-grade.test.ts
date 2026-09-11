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
        { ...base, title: 'CV-3027: delete v1 components' },
        'CV-3027'
      )
    ).toBe('closing');
  });

  it('grades a branch reference closing, in dash and underscore forms', () => {
    expect(
      textRefGrade({ ...base, sourceBranch: 'cv-3027-delete-v1' }, 'CV-3027')
    ).toBe('closing');
    expect(
      textRefGrade({ ...base, sourceBranch: 'cv_3027_delete_v1' }, 'CV-3027')
    ).toBe('closing');
  });

  it('grades a closing keyword in the description closing, through markdown links', () => {
    const description =
      'Closes [CV-2994](https://linear.app/acme/issue/CV-2994/foo).';
    expect(textRefGrade({ ...base, description }, 'CV-2994')).toBe('closing');
  });

  it('grades a bare description mention as mention', () => {
    expect(
      textRefGrade(
        { ...base, description: 'context from CV-28 applies here' },
        'CV-28'
      )
    ).toBe('mention');
  });

  it('keeps a keyword too far from the identifier at mention grade', () => {
    const description = `Fixes the flaky loader. ${'x'.repeat(40)} CV-28 is related.`;
    expect(textRefGrade({ ...base, description }, 'CV-28')).toBe('mention');
  });

  it('does not prefix-match identifiers in title or branch', () => {
    expect(
      textRefGrade({ ...base, title: 'CV-3027: thing' }, 'CV-302')
    ).toBeNull();
    expect(
      textRefGrade({ ...base, sourceBranch: 'cv-3027-delete-v1' }, 'CV-302')
    ).toBeNull();
  });

  it('returns null when the identifier appears nowhere', () => {
    expect(textRefGrade(base, 'CV-1')).toBeNull();
  });

  it('caps revert MRs at mention grade even with a title reference', () => {
    expect(
      textRefGrade(
        { ...base, title: 'Revert "CV-3027: delete v1 components"' },
        'CV-3027'
      )
    ).toBe('mention');
  });

  it('accepts the colon identifier form', () => {
    expect(textRefGrade({ ...base, description: 'fixes CV:28' }, 'CV-28')).toBe(
      'closing'
    );
  });
});
