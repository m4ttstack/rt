import { useEffect, useState } from 'react';

/**
 * useState whose value is mirrored to localStorage, so a selection survives a page reload.
 * Falls back to `initial` when nothing is stored or storage/JSON is unavailable.
 */
export function usePersistentState<T>(
  key: string,
  initial: T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [key, value]);

  return [value, setValue];
}
