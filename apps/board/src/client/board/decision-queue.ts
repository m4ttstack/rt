import { useCallback, useEffect, useRef, useState } from 'react';

import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import type { TriageGateState } from './DecisionQueueModal.tsx';
import { cleanTitle } from './format.ts';

export interface QueueEntry {
  gate: GateRow;
  /** Absent for a `queueExtras` entry (a human-owned gate with no MR row --
      a pane-attention gate is the first kind of these) -- the modal renders
      its strip and face off `gate` alone when this is undefined. */
  mr?: BoardMRWithReview;
}

export interface QueueView {
  open: boolean;
  active: QueueEntry | null;
  position: number;
  states: TriageGateState[];
  nextPeek: string | undefined;
  canBack: boolean;
  canNext: boolean;
  complete: boolean;
  /** In the order they were answered. */
  answeredIds: readonly string[];
}

export interface DecisionQueue extends QueueView {
  /** The last entry this session saw for each gate, the recap's fallback
      for a gate the board's rows no longer hold. */
  seenEntries: ReadonlyMap<string, QueueEntry>;
  openAtStart: () => void;
  openAt: (gateId: string) => void;
  close: () => void;
  next: () => void;
  back: () => void;
  noteAnswered: (gateId: string) => void;
  hold: (gateId: string | null) => void;
}

/** The queue's own state: `order` is append-only for the life of a session
    (closing resets it) so polling entries never reshuffles the pips a user
    is already looking at. */
export interface QueueSession {
  order: string[];
  answered: string[];
  activeId: string | null;
}

const CLOSED_SESSION: QueueSession = {
  order: [],
  answered: [],
  activeId: null,
};

function entryFor(
  entries: QueueEntry[],
  gateId: string | null
): QueueEntry | null {
  if (gateId === null) return null;
  return entries.find(e => e.gate.gateId === gateId) ?? null;
}

function stateFor(session: QueueSession, gateId: string): TriageGateState {
  if (session.activeId === gateId) return 'active';
  if (session.answered.includes(gateId)) return 'done';
  return 'todo';
}

/** Adds `gateId` to `answered` if it is not there already. */
export function markAnswered(
  session: QueueSession,
  gateId: string
): Pick<QueueSession, 'answered'> {
  return {
    answered: session.answered.includes(gateId)
      ? session.answered
      : [...session.answered, gateId],
  };
}

export function queueView(
  session: QueueSession,
  entries: QueueEntry[]
): QueueView {
  const states = session.order.map(id => stateFor(session, id));
  const active = entryFor(entries, session.activeId);
  const position = session.activeId
    ? session.order.indexOf(session.activeId) + 1
    : 0;
  const nextId = forwardTo(session, entries, session.activeId);
  const nextEntry = entryFor(entries, nextId);
  return {
    open: false,
    active,
    position,
    states,
    nextPeek: nextEntry
      ? nextEntry.mr
        ? `!${nextEntry.mr.iid} · ${cleanTitle(nextEntry.mr.title)}`
        : nextEntry.gate.label
      : undefined,
    canBack: backTo(session, entries, session.activeId) !== null,
    canNext: nextId !== null,
    complete: session.activeId === null && session.order.length > 0,
    answeredIds: session.answered,
  };
}

/** The finished queue's recap, in answer order: each answered gate's latest
    row where the board still holds one (it carries the answer once a poll
    catches up), else the entry the queue last saw for it. */
export function decidedEntries(
  answeredIds: readonly string[],
  rows: {
    mrs: readonly BoardMRWithReview[];
    queueExtras?: readonly GateRow[];
  },
  seen: ReadonlyMap<string, QueueEntry>
): QueueEntry[] {
  const wanted = new Set(answeredIds);
  const latest = new Map<string, QueueEntry>();
  for (const mr of rows.mrs)
    for (const gate of mr.gates)
      if (wanted.has(gate.gateId)) latest.set(gate.gateId, { gate, mr });
  for (const gate of rows.queueExtras ?? [])
    if (wanted.has(gate.gateId)) latest.set(gate.gateId, { gate });
  return answeredIds.flatMap(id => {
    const entry = latest.get(id) ?? seen.get(id);
    return entry ? [entry] : [];
  });
}

/** The first unanswered gate after `from` in `order` (from the start when
    `from` is null), without wrapping. */
export function advance(
  session: QueueSession,
  entries: QueueEntry[],
  from: string | null
): string | null {
  const startIndex = from === null ? -1 : session.order.indexOf(from);
  for (let i = startIndex + 1; i < session.order.length; i++) {
    const id = session.order[i]!;
    if (session.answered.includes(id)) continue;
    if (entryFor(entries, id)) return id;
  }
  return null;
}

/** `advance` only ever walks forward from `from`, so a gate retired mid-order
    (entered via a row chip, or the sole vanished active gate) would otherwise
    hit `complete` while earlier gates are still todo. Falling back to a
    from-null walk wraps to the first remaining gate instead. */
export function advanceOrWrap(
  session: QueueSession,
  entries: QueueEntry[],
  from: string
): string | null {
  return advance(session, entries, from) ?? advance(session, entries, null);
}

/** `from`'s nearest predecessor in `order` that still has an entry. Never
    consults `answered`: looking back is a view change, not a decision. A
    gate answered here has left `entries`, so there is nothing to land on. */
export function backTo(
  session: QueueSession,
  entries: QueueEntry[],
  from: string | null
): string | null {
  if (from === null) return null;
  const idx = session.order.indexOf(from);
  for (let i = idx - 1; i >= 0; i--) {
    const id = session.order[i]!;
    if (entryFor(entries, id)) return id;
  }
  return null;
}

/** `backTo`'s mirror: `from`'s successor in `order` that still has an
    entry. Also a view change, so it never consults `answered` and never
    wraps; null on the last gate. */
export function forwardTo(
  session: QueueSession,
  entries: QueueEntry[],
  from: string | null
): string | null {
  if (from === null) return null;
  const idx = session.order.indexOf(from);
  if (idx < 0) return null;
  for (let i = idx + 1; i < session.order.length; i++) {
    const id = session.order[i]!;
    if (entryFor(entries, id)) return id;
  }
  return null;
}

/** The previous-gate control's transition, `stepForward`'s mirror. */
export function stepBack(
  session: QueueSession,
  entries: QueueEntry[]
): QueueSession {
  const target = backTo(session, entries, session.activeId);
  return target === null ? session : { ...session, activeId: target };
}

/** The next-gate control's transition: onto the successor in order,
    changing nothing else; the session unchanged on the last gate. */
export function stepForward(
  session: QueueSession,
  entries: QueueEntry[]
): QueueSession {
  const target = forwardTo(session, entries, session.activeId);
  return target === null ? session : { ...session, activeId: target };
}

/** Appends unseen actionable gates to `order` without touching existing
    positions, then retires an activeId that has vanished from entries ONLY
    when `answeredIds` positively shows it answered elsewhere -- absence
    alone is not evidence (a restarted board server briefly serves gate-less
    MRs while its cache re-ingests, and a failed poll looks the same), so a
    merely-missing active gate stays active until the data says otherwise.
    `heldId` outranks even answer evidence: the lost-answer face is showing
    the winning answer and must survive the refresh that reports it. */
export function reconcile(
  session: QueueSession,
  entries: QueueEntry[],
  heldId: string | null = null,
  answeredIds?: ReadonlySet<string>
): QueueSession {
  const seen = new Set(session.order);
  const appended = entries.map(e => e.gate.gateId).filter(id => !seen.has(id));
  const order = appended.length
    ? [...session.order, ...appended]
    : session.order;

  if (
    session.activeId !== null &&
    !entryFor(entries, session.activeId) &&
    (heldId === null || heldId !== session.activeId) &&
    answeredIds?.has(session.activeId)
  ) {
    const next = {
      ...session,
      order,
      ...markAnswered(session, session.activeId),
    };
    return {
      ...next,
      activeId: advanceOrWrap(next, entries, session.activeId),
    };
  }

  return order === session.order ? session : { ...session, order };
}

export function useDecisionQueue(
  entries: QueueEntry[],
  answeredIds?: ReadonlySet<string>
): DecisionQueue {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<QueueSession>(CLOSED_SESSION);
  const [heldId, setHeldId] = useState<string | null>(null);
  // The last snapshot's entry for the current active gate, so the modal can
  // keep rendering it through a transient snapshot that dropped the gate
  // without answering it.
  const lastActiveEntry = useRef<QueueEntry | null>(null);
  const seen = useRef<Map<string, QueueEntry> | null>(null);
  const seenEntries = (seen.current ??= new Map());

  useEffect(() => {
    if (!open) return;
    const map = (seen.current ??= new Map());
    for (const e of entries) map.set(e.gate.gateId, e);
  }, [open, entries]);

  useEffect(() => {
    if (!open) return;
    setSession(s => reconcile(s, entries, heldId, answeredIds));
  }, [open, entries, heldId, answeredIds]);

  const openAtStart = useCallback(() => {
    const order = entries.map(e => e.gate.gateId);
    setSession({ order, answered: [], activeId: order[0] ?? null });
    setOpen(true);
  }, [entries]);

  const openAt = useCallback(
    (gateId: string) => {
      if (!entryFor(entries, gateId)) {
        openAtStart();
        return;
      }
      const order = entries.map(e => e.gate.gateId);
      setSession({ order, answered: [], activeId: gateId });
      setOpen(true);
    },
    [entries, openAtStart]
  );

  const close = useCallback(() => {
    setOpen(false);
    setSession(CLOSED_SESSION);
    setHeldId(null);
    lastActiveEntry.current = null;
    seen.current = null;
  }, []);

  const next = useCallback(() => {
    setSession(s => stepForward(s, entries));
  }, [entries]);

  const noteAnswered = useCallback(
    (gateId: string) => {
      setHeldId(h => (h === gateId ? null : h));
      setSession(s => {
        const next = { ...s, ...markAnswered(s, gateId) };
        return { ...next, activeId: advanceOrWrap(next, entries, gateId) };
      });
    },
    [entries]
  );

  const back = useCallback(() => {
    setSession(s => stepBack(s, entries));
  }, [entries]);

  const hold = useCallback((gateId: string | null) => {
    setHeldId(gateId);
  }, []);

  const view = queueView(session, entries);

  // Bridge a transient snapshot: an active gate reconcile kept (absent but
  // not evidenced answered) has no entry this render, so serve the last
  // snapshot's copy rather than blanking the open modal.
  if (view.active) {
    lastActiveEntry.current = view.active;
  } else if (
    session.activeId !== null &&
    lastActiveEntry.current?.gate.gateId === session.activeId
  ) {
    view.active = lastActiveEntry.current;
  }

  return {
    ...view,
    seenEntries,
    open,
    openAtStart,
    openAt,
    close,
    next,
    back,
    noteAnswered,
    hold,
  };
}
