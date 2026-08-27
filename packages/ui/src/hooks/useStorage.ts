import {
  useLocalStorage as mantineUseLocalStorage,
  useSessionStorage as mantineUseSessionStorage,
} from '@mantine/hooks';

/**
 * Mantine's storage-hook options MINUS `getInitialValueInEffect`: the
 * shadows below own that flag, so callers can't set it (see why below).
 */
export type StorageHookProps<T> = Omit<
  Parameters<typeof mantineUseLocalStorage<T>>[0],
  'getInitialValueInEffect'
>;

// Mantine's own `getInitialValueInEffect` defaults to `true`, which reads the
// stored value in an effect (after first paint) -- a guaranteed flash of the
// default value. The shadows hard-code `false` (spread FIRST, so the flag
// cannot be overridden) and drop it from the public props type: enabling it
// is a reliable source of hydration/flicker bugs, and every kit consumer
// wants the synchronous read.
export function useLocalStorage<T = string>(props: StorageHookProps<T>) {
  return mantineUseLocalStorage<T>({
    ...props,
    getInitialValueInEffect: false,
  });
}

export function useSessionStorage<T = string>(props: StorageHookProps<T>) {
  return mantineUseSessionStorage<T>({
    ...props,
    getInitialValueInEffect: false,
  });
}
