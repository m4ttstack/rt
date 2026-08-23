// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { decideServingMode } from './serving-mode';

describe('decideServingMode', () => {
  it('serves embedded when the manifest loaded, compiled or not', () => {
    expect(
      decideServingMode({ manifestLoaded: true, isCompiledBinary: true })
    ).toEqual({ mode: 'embedded' });
    expect(
      decideServingMode({ manifestLoaded: true, isCompiledBinary: false })
    ).toEqual({ mode: 'embedded' });
  });

  it('falls back to disk when not a compiled binary and no manifest loaded', () => {
    expect(
      decideServingMode({ manifestLoaded: false, isCompiledBinary: false })
    ).toEqual({ mode: 'disk' });
  });

  it('is fatal for a compiled binary with no manifest -- no dist/ to fall back to', () => {
    const decision = decideServingMode({
      manifestLoaded: false,
      isCompiledBinary: true,
    });

    expect(decision.mode).toBe('fatal');
    expect(decision).toMatchObject({
      message: expect.stringContaining('generate:embedded'),
    });
  });
});
