import { useEffect, useRef, useState } from 'react';
import type {
  SettingDefWire,
  SettingsScopeState,
} from '@mattstack/settings-kit/react';
import { targetScope } from '@mattstack/settings-kit/shapes';

export type RowStore = Pick<SettingsScopeState, 'set' | 'unset' | 'move'>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

const SAVED_FLASH_MS = 1400;

/** Save-on-commit, no staging: `undefined` means "clear this layer". */
export function useRowSave(store: RowStore, def: SettingDefWire) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async (op: () => Promise<string | null>) => {
    setStatus('saving');
    setError(null);
    const err = await op();
    if (err) {
      setStatus('idle');
      setError(err);
      return false;
    }
    setStatus('saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), SAVED_FLASH_MS);
    return true;
  };

  const scope = targetScope(def);
  return {
    status,
    error,
    save: (value: unknown) =>
      run(() =>
        value === undefined
          ? store.unset(def.key, scope)
          : store.set(def.key, scope, value)
      ),
    clear: (at: string) => run(() => store.unset(def.key, at)),
    move: (from: string, to: string) =>
      run(() => store.move(def.key, from, to)),
  };
}
