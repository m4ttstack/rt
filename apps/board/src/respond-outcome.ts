/** Shared by the server, the status CLI and the browser client, so this module
    must never import `fs`: server.ts bundles client.tsx for the browser. */

export type RespondStatus =
  'queued' | 'triaging' | 'implementing' | 'drafting' | 'done' | 'error';

export type RespondOutcome =
  'posted' | 'held' | 'partial' | 'drafted' | 'none' | 'unknown';

function isCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/** What the run did with its drafted replies, derived from the counts the
    respond wrapper reports rather than from an enum it also reports. One fact
    to get right means it cannot claim "posted" over a zero, and the endings a
    single `done` used to blur stay distinguishable. `held` counts threads
    whose reply was deliberately withheld at the posting gate: those threads
    are finished business, not replies still sitting in the pane, so they
    complete the run instead of leaving it partial. An invalid held is
    ignored rather than degrading the pair to unknown, since every pre-held
    state row simply lacks it. */
export function respondOutcome(
  posted?: number,
  threads?: number,
  held?: number
): RespondOutcome {
  if (!isCount(posted) || !isCount(threads)) return 'unknown';
  if (threads === 0) return 'none';
  const answered = Math.min(posted, threads);
  const settled = Math.min(answered + (isCount(held) ? held : 0), threads);
  if (settled === threads) return answered === 0 ? 'held' : 'posted';
  return answered === 0 ? 'drafted' : 'partial';
}

export function respondDoneLabel(
  posted?: number,
  threads?: number,
  held?: number
): string {
  const outcome = respondOutcome(posted, threads, held);
  const h = isCount(held) ? Math.min(held, threads ?? 0) : 0;
  switch (outcome) {
    case 'posted':
      return h > 0 ? `replies posted, ${h} held` : 'replies posted';
    case 'held':
      return 'replies held, none posted';
    case 'drafted':
      return 'replies drafted, not posted';
    case 'none':
      return 'no threads to answer';
    case 'partial': {
      // Both counts are integers here by construction; the fallbacks only exist
      // to keep this arithmetic free of non-null assertions.
      const base = `${Math.min(posted ?? 0, threads ?? 0)} of ${threads ?? 0} posted`;
      return h > 0 ? `${base}, ${h} held` : base;
    }
    case 'unknown':
      return 'responded';
  }
}

/** Outcomes where replies are still sitting unposted in the agent's pane, so
    the badge should nag rather than read as a clean finish. A held reply is
    not one of them: the posting gate decided it stays down. */
export function respondNeedsAttention(outcome: RespondOutcome): boolean {
  return outcome === 'partial' || outcome === 'drafted';
}
