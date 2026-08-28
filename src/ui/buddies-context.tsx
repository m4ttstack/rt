import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { RosterBuddy } from './Roster';

export interface BuddyActions {
  /** Insert `@handle` into the composer (the buddy is in the open room). */
  mention: (handle: string) => void;
  /** Open the DM room with `handle` and move to it. */
  dm: (handle: string) => void;
}

export interface BuddiesContextValue {
  byHandle: Map<string, RosterBuddy>;
  /** Handles in the open room: decides whether a card offers @mention or DM. */
  roomMembers: string[];
  now: number;
  reachable: boolean;
  actions?: BuddyActions;
}

const BuddiesContext = createContext<BuddiesContextValue | null>(null);

/** The one place presence is looked up by handle, so `AgentName` can render
    anywhere a handle appears (roster, sender, chip, DM pair) with the same
    data the roster has. Outside a provider a name is just a name. */
export function BuddiesProvider({
  buddies,
  roomMembers,
  now,
  reachable,
  actions,
  children,
}: Omit<BuddiesContextValue, 'byHandle'> & {
  buddies: RosterBuddy[];
  children: ReactNode;
}) {
  const value = useMemo<BuddiesContextValue>(
    () => ({
      byHandle: new Map(buddies.map(b => [b.handle, b])),
      roomMembers,
      now,
      reachable,
      actions,
    }),
    [buddies, roomMembers, now, reachable, actions]
  );
  return (
    <BuddiesContext.Provider value={value}>{children}</BuddiesContext.Provider>
  );
}

export function useBuddies(): BuddiesContextValue | null {
  return useContext(BuddiesContext);
}
