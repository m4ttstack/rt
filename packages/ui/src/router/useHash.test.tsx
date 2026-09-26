import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import { useHash } from './useHash';

test('tracks window.location.hash across hashchange', () => {
  window.location.hash = '#m-1';
  const { result } = renderHook(() => useHash());
  expect(result.current).toBe('#m-1');
  act(() => {
    window.location.hash = '#m-2';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(result.current).toBe('#m-2');
});
