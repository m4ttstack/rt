import { useCallback, useEffect, useState } from 'react';

import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import type { TriageGateState } from './DecisionQueueModal.tsx';
import { cleanTitle } from './format.ts';

export interface QueueEntry {
  gate: GateRow;
  mr: BoardMRWithReview;
}

export interface QueueView {
  open: boolean;
  active: QueueEntry | null;
  position: number;
  states: TriageGateState[];
  nextPeek: string | undefined;
  complete: boolean;
  answeredCount: number;
  skippedCount: number;
}

export interface DecisionQueue extends QueueView {
  openAtStart: () => void;
  openAt: (gateId: string) => void;
  close: () => void;
  skip: () => void;
  noteAnswered: (gateId: string) => void;
}

/** The queue's own state: `order` is append-only for the life of a session
    (closing resets it) so polling entries never reshuffles the pips a user
    is already looking at. */
export interface QueueSession {
  order: string[];
  answered: string[];
  skipped: string[];
  activeId: string | null;
}

const CLOSED_SESSION: QueueSession = {
  order: [],
  answered: [],
  skipped: [],
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
  if (session.answered.includes(gateId)) return 'done';
  if (session.skipped.includes(gateId)) return 'skipped';
  if (session.activeId === gateId) return 'active';
  return 'todo';
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
  const nextId = session.activeId
    ? advance(session, entries, session.activeId)
    : null;
  const nextEntry = entryFor(entries, nextId);
  return {
    open: false,
    active,
    position,
    states,
    nextPeek: nextEntry
      ? `!${nextEntry.mr.iid} · ${cleanTitle(nextEntry.mr.title)}`
      : undefined,
    complete: session.activeId === null && session.order.length > 0,
    answeredCount: session.answered.length,
    skippedCount: session.skipped.length,
  };
}

/** Walks `order` forward from `from`'s successor only, so a skipped gate
    never comes back around this session (no wraparound to earlier ids). */
export function advance(
  session: QueueSession,
  entries: QueueEntry[],
  from: string | null
): string | null {
  const startIndex = from === null ? -1 : session.order.indexOf(from);
  for (let i = startIndex + 1; i < session.order.length; i++) {
    const id = session.order[i]!;
    if (session.answered.includes(id) || session.skipped.includes(id)) continue;
    if (entryFor(entries, id)) return id;
  }
  return null;
}

/** Appends unseen actionable gates to `order` without touching existing
    positions, then auto-answers an activeId that has vanished from entries
    (the gate was resolved elsewhere) and advances past it. */
export function reconcile(
  session: QueueSession,
  entries: QueueEntry[]
): QueueSession {
  const seen = new Set(session.order);
  const appended = entries.map(e => e.gate.gateId).filter(id => !seen.has(id));
  const order = appended.length
    ? [...session.order, ...appended]
    : session.order;

  if (session.activeId !== null && !entryFor(entries, session.activeId)) {
    const answered = session.answered.includes(session.activeId)
      ? session.answered
      : [...session.answered, session.activeId];
    const next = { ...session, order, answered };
    return { ...next, activeId: advance(next, entries, session.activeId) };
  }

  return order === session.order ? session : { ...session, order };
}

export function useDecisionQueue(entries: QueueEntry[]): DecisionQueue {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<QueueSession>(CLOSED_SESSION);

  useEffect(() => {
    if (!open) return;
    setSession(s => reconcile(s, entries));
  }, [open, entries]);

  const openAtStart = useCallback(() => {
    const order = entries.map(e => e.gate.gateId);
    setSession({
      order,
      answered: [],
      skipped: [],
      activeId: order[0] ?? null,
    });
    setOpen(true);
  }, [entries]);

  const openAt = useCallback(
    (gateId: string) => {
      if (!entryFor(entries, gateId)) {
        openAtStart();
        return;
      }
      const order = entries.map(e => e.gate.gateId);
      setSession({ order, answered: [], skipped: [], activeId: gateId });
      setOpen(true);
    },
    [entries, openAtStart]
  );

  const close = useCallback(() => {
    setOpen(false);
    setSession(CLOSED_SESSION);
  }, []);

  const skip = useCallback(() => {
    setSession(s => {
      if (s.activeId === null) return s;
      const skipped = [...s.skipped, s.activeId];
      const next = { ...s, skipped };
      return { ...next, activeId: advance(next, entries, s.activeId) };
    });
  }, [entries]);

  const noteAnswered = useCallback(
    (gateId: string) => {
      setSession(s => {
        const answered = s.answered.includes(gateId)
          ? s.answered
          : [...s.answered, gateId];
        const next = { ...s, answered };
        return { ...next, activeId: advance(next, entries, gateId) };
      });
    },
    [entries]
  );

  const view = queueView(session, entries);

  return {
    ...view,
    open,
    openAtStart,
    openAt,
    close,
    skip,
    noteAnswered,
  };
}
