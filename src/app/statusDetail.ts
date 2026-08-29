import type { BuddyStatus } from '@mattstack/rt-client';

/** The short status word shown beside a buddy's dot. */
export const STATUS_WORD: Record<BuddyStatus, string> = {
  live: 'working',
  idle: 'idle',
  offline: 'offline',
};

/**
 * A millisecond delta as the shortest unit that still reads at a glance.
 * Shared by `statusDetail`'s phrases and `DaemonBanner`'s "down Nm" readout,
 * since both are formatting the same kind of `now - timestamp` delta.
 */
export function formatElapsed(ms: number): string {
  // Clamped: a heartbeat a few ms in the future (clock skew between the
  // daemon's clock and the browser's) would otherwise render "-1s ago",
  // which reads as a bug in the fleet rather than in the arithmetic.
  ms = Math.max(0, ms);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

/**
 * Deliberately looser than `PresenceRow`: every field but `status` is
 * optional here because `statusDetail` has to explain rows missing any of
 * them. `lastSeenAt` heartbeats on sign-in and on every successful delivery
 * (push delivery v2, not a polled tail) -- there is no separate "armed" or
 * "tail" heartbeat left to track.
 */
export interface StatusDetailRow {
  status: BuddyStatus;
  lastSeenAt?: number;
  signedOutAt?: number;
}

/**
 * Explains the daemon's own status verdict for a row; never re-derives or
 * contradicts it. `status` always comes from the daemon (see `STATUS_WORD`);
 * this only phrases the timestamp that backs it up.
 */
export function statusDetail(row: StatusDetailRow, now: number): string {
  switch (row.status) {
    case 'live':
      return row.lastSeenAt !== undefined
        ? `seen ${formatElapsed(now - row.lastSeenAt)} ago`
        : 'mid-turn';
    case 'idle':
      return row.lastSeenAt !== undefined
        ? `seen ${formatElapsed(now - row.lastSeenAt)} ago`
        : 'idle';
    case 'offline':
      return row.signedOutAt !== undefined
        ? `signed out ${formatElapsed(now - row.signedOutAt)} ago`
        : 'signed out';
  }
}
