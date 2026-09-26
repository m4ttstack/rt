import type {
  GateRow as FacilityGateRow,
  RtResponse,
  RunDetail,
} from '@mattstack/rt-client';

const RUN_SUBJECT_PREFIX = 'run:';

/** A run that has not recorded its MR yet usually records it later (the
    ship stage writes `mr`), so a miss is retried after this long. A daemon
    error waits the same interval before the next lookup. */
export const RUN_MR_MISS_TTL_MS = 30_000;

export const RUN_MR_HIT_TTL_MS = 5 * 60_000;

/** Run ids keyed by the MR url each run recorded. */
export type RunMrLinks = ReadonlyMap<string, readonly string[]>;

export function runIdOf(subject: string): string | null {
  if (!subject.startsWith(RUN_SUBJECT_PREFIX)) return null;
  return subject.slice(RUN_SUBJECT_PREFIX.length) || null;
}

export function normalizeMrUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Human-owned, or herd-owned once the daemon escalated it: a herd's own
    shepherd answers the rest, and the daemon rejects anyone else. */
export function isHumanOwned(row: FacilityGateRow): boolean {
  if (row.owner === 'human') return true;
  return (
    typeof row.owner === 'string' &&
    row.owner.startsWith('herd:') &&
    row.escalatedAt != null
  );
}

/** A pipeline gate the board shows on its MR: still waiting, and a
    human's to answer. An answered one leaves the row, since the pipeline
    run, not the board, carries it forward. */
export function isLiveRunGate(row: FacilityGateRow): boolean {
  if (runIdOf(row.subject) === null) return false;
  if (row.status !== 'open' && row.status !== 'parked') return false;
  return isHumanOwned(row);
}

/** The run's latest `mr` field when it holds a url; pipelines write `-` to
    clear a field. */
export function mrUrlFromRun(detail: RunDetail): string | null {
  let latest: { value: string; at: number } | null = null;
  for (const field of detail.fields) {
    if (field.key !== 'mr') continue;
    if (!latest || field.at >= latest.at) latest = field;
  }
  if (!latest || !/^https?:\/\//.test(latest.value)) return null;
  return normalizeMrUrl(latest.value);
}

export interface RunMrResolverIo {
  getRun(runId: string): Promise<RtResponse<RunDetail>>;
  /** Fires when a lookup changes which MR a run links to. */
  onChange?: () => void;
  now?: () => number;
}

type Lookup = { kind: 'found'; mrUrl: string | null } | { kind: 'error' };

interface Entry {
  mrUrl: string | null;
  expiresAt: number;
}

/** Resolves pipeline runs to the MR each one recorded, through the
    daemon's `runs:get`, without ever making a caller wait on the daemon:
    `links` answers from what is cached and looks up the rest in the
    background, firing `onChange` when a mapping lands or moves. A found MR
    is rechecked after `ttl.hitMs` (a run can re-record or clear `mr`), a
    miss after `ttl.missMs`; a daemon error keeps the last known MR and
    retries after `ttl.missMs`. */
export class RunMrResolver {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly io: RunMrResolverIo,
    private readonly ttl = {
      hitMs: RUN_MR_HIT_TTL_MS,
      missMs: RUN_MR_MISS_TTL_MS,
    }
  ) {
    this.now = io.now ?? Date.now;
  }

  /** Links for every run with a live gate among `rows`, as cached now. */
  links(rows: FacilityGateRow[]): RunMrLinks {
    const live = new Set<string>();
    for (const row of rows) {
      if (isLiveRunGate(row)) live.add(runIdOf(row.subject)!);
    }
    for (const runId of this.entries.keys()) {
      if (!live.has(runId) && !this.inflight.has(runId))
        this.entries.delete(runId);
    }
    const now = this.now();
    const out = new Map<string, string[]>();
    for (const runId of live) {
      const entry = this.entries.get(runId);
      if (!entry || entry.expiresAt <= now) this.refresh(runId);
      if (!entry?.mrUrl) continue;
      const ids = out.get(entry.mrUrl);
      if (ids) ids.push(runId);
      else out.set(entry.mrUrl, [runId]);
    }
    return out;
  }

  /** Resolves once every lookup in flight has landed. */
  async settled(): Promise<void> {
    await Promise.all([...this.inflight.values()]);
  }

  private refresh(runId: string): void {
    if (this.inflight.has(runId)) return;
    const task = this.lookup(runId).then(result => {
      const prev = this.entries.get(runId)?.mrUrl ?? null;
      const mrUrl = result.kind === 'found' ? result.mrUrl : prev;
      const ttlMs =
        result.kind === 'found' && mrUrl !== null
          ? this.ttl.hitMs
          : this.ttl.missMs;
      this.entries.set(runId, { mrUrl, expiresAt: this.now() + ttlMs });
      this.inflight.delete(runId);
      if (mrUrl !== prev) this.io.onChange?.();
    });
    this.inflight.set(runId, task);
  }

  private async lookup(runId: string): Promise<Lookup> {
    try {
      const res = await this.io.getRun(runId);
      if (res.ok && res.data)
        return { kind: 'found', mrUrl: mrUrlFromRun(res.data) };
      return res.error === 'run not found'
        ? { kind: 'found', mrUrl: null }
        : { kind: 'error' };
    } catch {
      return { kind: 'error' };
    }
  }
}
