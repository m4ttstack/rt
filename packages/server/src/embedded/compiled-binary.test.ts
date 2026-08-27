// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isCompiledBinaryMain } from './compiled-binary';

describe('isCompiledBinaryMain', () => {
  it('is true for the virtual path Bun compiles the entrypoint into', () => {
    expect(isCompiledBinaryMain('/$bunfs/root/console')).toBe(true);
  });

  it('is false for a normal filesystem path (bun run of source)', () => {
    expect(
      isCompiledBinaryMain('/Users/matt/console/src/server/index.ts')
    ).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(isCompiledBinaryMain('')).toBe(false);
  });
});
