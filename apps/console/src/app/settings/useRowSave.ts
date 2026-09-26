import { useEffect, useRef, useState } from 'react';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { useSettingsRepo, type ConsoleStore } from './useConsoleSettings';
import { targetAt, writeTarget, type WriteTarget } from './view';

export type RowStore = Pick<ConsoleStore, 'set' | 'unset' | 'move'>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

const SAVED_FLASH_MS = 1400;

/** Save-on-commit, no staging: `undefined` means "clear this layer". A
    write with no repo passes no repo argument at all. */
export function useRowSave(store: RowStore, def: SettingDefWire) {
  const repo = useSettingsRepo();
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

  const setTo = (t: WriteTarget, value: unknown) =>
    t.repo === undefined
      ? store.set(def.key, t.scope, value)
      : store.set(def.key, t.scope, value, t.repo);
  const unsetAt = (t: WriteTarget) =>
    t.repo === undefined
      ? store.unset(def.key, t.scope)
      : store.unset(def.key, t.scope, t.repo);
  const at = (layer: string) => {
    const t = targetAt(layer, repo);
    return t ?? `${layer} is not a writable layer here`;
  };

  const target = writeTarget(def, repo);
  return {
    status,
    error,
    target,
    save: (value: unknown) =>
      run(() => (value === undefined ? unsetAt(target) : setTo(target, value))),
    setAt: (layer: string, value: unknown) =>
      run(async () => {
        const t = at(layer);
        return typeof t === 'string' ? t : setTo(t, value);
      }),
    clear: (layer: string) =>
      run(async () => {
        const t = at(layer);
        return typeof t === 'string' ? t : unsetAt(t);
      }),
    move: (from: string, to: string) =>
      run(() => store.move(def.key, from, to)),
  };
}
