import type { BuddyStatus } from '@mattstack/rt-client';

/** The short status word shown beside a buddy's dot. */
export const STATUS_WORD: Record<BuddyStatus, string> = {
  live: 'listening',
  idle: 'idle',
  deaf: 'deaf',
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
 * them (an idle buddy with no `tailSeenAt`, an offline one with no
 * `signedOutAt` yet). `lastSeenAt` is the PresenceRow SESSION heartbeat
 * (when the human last prompted) -- never `ChatMember.lastSeenAt`, which is
 * the tail's own heartbeat and means something else entirely.
 */
export interface StatusDetailRow {
  status: BuddyStatus;
  armedAt?: number;
  lastSeenAt?: number;
  tailSeenAt?: number;
  signedOutAt?: number;
}

/**
 * Explains the daemon's own status verdict for a row; never re-derives or
 * contradicts it. `status` always comes from the daemon (see `STATUS_WORD`);
 * this only phrases the timestamps that back it up.
 */
export function statusDetail(row: StatusDetailRow, now: number): string {
  const tailFragment =
    row.tailSeenAt !== undefined
      ? `touched ${formatElapsed(now - row.tailSeenAt)} ago`
      : 'no tail';

  switch (row.status) {
    case 'live': {
      const parts: string[] = [];
      if (row.armedAt !== undefined) parts.push('armed');
      parts.push(tailFragment);
      return parts.join(' · ');
    }
    case 'idle': {
      const parts = [tailFragment];
      if (row.lastSeenAt !== undefined) {
        parts.push(`prompted ${formatElapsed(now - row.lastSeenAt)} ago`);
      }
      return parts.join(' · ');
    }
    case 'deaf': {
      const silent =
        row.tailSeenAt !== undefined
          ? `silent ${formatElapsed(now - row.tailSeenAt)}`
          : 'silent';
      return row.armedAt !== undefined
        ? `armed, ${silent} — tail died`
        : silent;
    }
    case 'offline':
      return row.signedOutAt !== undefined
        ? `signed out ${formatElapsed(now - row.signedOutAt)} ago`
        : 'signed out';
  }
}
