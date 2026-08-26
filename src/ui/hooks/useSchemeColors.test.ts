import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { staticSchemeColors, useSchemeColors } from '@ui/hooks/useSchemeColors';

describe('useSchemeColors', () => {
  it('returns level1 as the --ui-bg-1 CSS var reference', () => {
    const { result } = renderHook(() => useSchemeColors());
    expect(result.current.bg.level1).toBe('var(--ui-bg-1)');
  });

  it('returns four distinct background levels', () => {
    const { result } = renderHook(() => useSchemeColors());
    const { level1, level2, level3, level4 } = result.current.bg;
    expect(new Set([level1, level2, level3, level4]).size).toBe(4);
  });

  it('matches staticSchemeColors, the non-hook variant usable outside React', () => {
    const { result } = renderHook(() => useSchemeColors());
    expect(result.current).toBe(staticSchemeColors);
  });

  it('returns text.dimmed as the per-scheme --ui-text-dimmed var (not a fixed shade)', () => {
    const { result } = renderHook(() => useSchemeColors());
    // The value must be the scheme-vars.css indirection: a fixed
    // --mantine-color-gray-N here would render wrong in one scheme.
    expect(result.current.text.dimmed).toBe('var(--ui-text-dimmed)');
  });
});
