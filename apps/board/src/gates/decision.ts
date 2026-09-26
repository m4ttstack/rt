import type { Member } from '../config.ts';
import { visibleMrsFor, type BoardMR } from '../data.ts';
import { boardBadge, type BoardBadge } from './badge.ts';
import { attachGates, type GateCache, type GateHost } from './cache.ts';
import { buildQueueExtras } from './ingest.ts';
import type { RunMrResolver } from './run-mr.ts';
import type { GateRow } from './store.ts';

export type RunMrLinker = Pick<RunMrResolver, 'links'>;

export interface DecisionGates<T> {
  mrs: Array<T & { gates: GateRow[] }>;
  queueExtras: GateRow[];
}

/** The decision queue's gate set: each visible MR's gates, including the
    gates of the runs that recorded it, plus the queue's extras. /data.json
    serves it and /api/badge counts it, so the badge never counts a gate the
    queue does not show, or misses one it does. */
export function decisionGates<T extends BoardMR & GateHost>(
  mrs: T[],
  visible: Member[],
  cache: GateCache,
  runMrs: RunMrLinker
): DecisionGates<T> {
  const rows = cache.rows();
  return {
    mrs: attachGates(visibleMrsFor(mrs, visible), cache, runMrs.links(rows)),
    queueExtras: buildQueueExtras(rows),
  };
}

export function decisionBadge(
  mrs: BoardMR[],
  visible: Member[],
  cache: GateCache,
  runMrs: RunMrLinker,
  now: number
): BoardBadge {
  const { mrs: gated, queueExtras } = decisionGates(
    mrs,
    visible,
    cache,
    runMrs
  );
  return boardBadge([...gated.flatMap(mr => mr.gates), ...queueExtras], now);
}
