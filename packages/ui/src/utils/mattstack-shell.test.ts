import { afterEach, describe, expect, it, vi } from 'vitest';

import { isInsideMattstackShell } from '@mattstack/app-kit/utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isInsideMattstackShell', () => {
  it('is true when the UA carries the shell marker', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 mattstack-shell/1.0',
    });
    expect(isInsideMattstackShell()).toBe(true);
  });

  it('is false for an ordinary browser UA', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15',
    });
    expect(isInsideMattstackShell()).toBe(false);
  });

  it('requires the leading space, not just the bare marker text', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0mattstack-shell/1.0',
    });
    expect(isInsideMattstackShell()).toBe(false);
  });
});
