import { describe, expect, it } from 'vitest';

import { spliceGenerated } from '../scripts/generate.ts';

const BEGIN = '/* BEGIN GENERATED: x */';
const END = '/* END GENERATED */';

describe('spliceGenerated', () => {
  it('splices the body between a well-formed marker pair', () => {
    const css = `a {\n  ${BEGIN}\n  old\n  ${END}\n}\n`;
    const result = spliceGenerated(css, BEGIN, '  new');
    expect(result).toBe(`a {\n  ${BEGIN}\n  new\n  ${END}\n}\n`);
  });

  it('throws on a duplicated BEGIN marker rather than splicing the first', () => {
    const css = `a {\n  ${BEGIN}\n  old\n  ${END}\n}\nb {\n  ${BEGIN}\n  old2\n  ${END}\n}\n`;
    expect(() => spliceGenerated(css, BEGIN, '  new')).toThrow(/duplicate/i);
  });

  it('throws instead of splicing across a missing END into the next block', () => {
    // No END after the first BEGIN: the only END in the file belongs to the
    // second block. A naive `indexOf` would match it and splice `body`
    // across both blocks' boundary.
    const css = `a {\n  ${BEGIN}\n  old\n}\nb {\n  /* BEGIN GENERATED: y */\n  old2\n  ${END}\n}\n`;
    expect(() => spliceGenerated(css, BEGIN, '  new')).toThrow(
      /no END GENERATED/i
    );
  });
});
