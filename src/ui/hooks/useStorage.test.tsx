import { renderHook } from '@testing-library/react';

import { useLocalStorage } from '@ui/hooks';

test('reads the stored value on first render (no effect flicker)', () => {
  window.localStorage.setItem('k', JSON.stringify('stored'));
  const { result } = renderHook(() =>
    useLocalStorage<string>({ key: 'k', defaultValue: 'default' })
  );
  expect(result.current[0]).toBe('stored');
});
