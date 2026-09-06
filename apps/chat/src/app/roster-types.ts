import type { BuddyStatus, PresenceRow } from '@mattstack/rt-client';

/** `/api/chat/buddies`' own shape: the daemon's `PresenceRow` plus the
    status it joins on, the room tags `chat.ts`'s handler inverts from a
    `who` call per room, and the live herdr pane title `chat.ts` joins in
    by session id -- `PresenceRow` itself has no such field since rt-client
    cannot see herdr panes. */
export type RosterBuddy = PresenceRow & {
  status: BuddyStatus;
  rooms: string[];
  paneTitle?: string;
};
