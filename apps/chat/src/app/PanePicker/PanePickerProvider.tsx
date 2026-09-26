import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

import { PanePickerModal } from './PanePickerModal';
import type { ChatPane, PickPanes, PickPanesOptions } from './types';

const PickContext = createContext<PickPanes | null>(null);

interface PendingPick {
  opts: PickPanesOptions;
  resolve: (r: ChatPane[] | null) => void;
}

/** Hosts the one picker modal, inside the app's providers, so any caller
    below can `usePanePicker()` and await a result. */
export function PanePickerProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPick | null>(null);
  const pick = useCallback<PickPanes>(
    opts =>
      new Promise(resolve => {
        setPending(prev => {
          prev?.resolve(null);
          return { opts: opts ?? {}, resolve };
        });
      }),
    []
  );
  return (
    <PickContext.Provider value={pick}>
      {children}
      {pending && (
        <PanePickerModal
          opts={pending.opts}
          onDone={result => {
            pending.resolve(result);
            setPending(null);
          }}
        />
      )}
    </PickContext.Provider>
  );
}

export function usePanePicker(): PickPanes {
  const pick = useContext(PickContext);
  if (!pick)
    throw new Error('usePanePicker needs a PanePickerProvider above it');
  return pick;
}
