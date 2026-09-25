import {
  reconcileEventBridgeRule,
  type EventBridgeRule,
} from '@mattstack/app-server/event-bridge';
import { domainForKind } from '@mattstack/gate-kit';
import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
import { cachedDelivery, cachedExecution } from './cache.ts';
import { isHumanOwned, runIdOf } from './run-mr.ts';
import type { GateAnswers, GateQuestion, GateRow } from './store.ts';

/** Shape shared by a relay `("event", frame)` push and an `events:list` row --
    both carry a bus topic and its payload, which is all the cache feed and
    boot reconcile need. */
export interface GateEventFrame {
  topic: string;
  payload: unknown;
}

/** Minimal surface `ingestRelayFrame` feeds -- `GateCache` satisfies this
    without ingest.ts importing cache.ts back (cache.ts already imports
    `GateEventFrame` from here). */
export interface GateCacheTarget {
  applyEvent(frame: GateEventFrame): void;
}

/** Minimal surface the boot reconcile feeds. */
export interface GateReconcileTarget {
  reconcile(rows: FacilityGateRow[]): void;
}

const GATE_BUS_TOPIC_RE = /^gate\/[^/]+\/[^/]+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** True for a `gate/**` bus frame whose payload names an MR-scoped subject
    (`mr:...`) or a pipeline run (`run:...`, joined to its run's MR at read
    time) -- the board's cache tracks those -- OR a `pane-attention` gate,
    whose subject targets an agent/pane rather than an MR and is accepted on
    kind alone so it can still reach `queueExtras`. Any other subject is left
    alone. */
function isBoardGateFrame(frame: GateEventFrame): boolean {
  if (!GATE_BUS_TOPIC_RE.test(frame.topic)) return false;
  if (!isRecord(frame.payload)) return false;
  const subject = frame.payload.subject;
  if (typeof subject !== 'string' || !subject) return false;
  if (subject.startsWith('mr:') || runIdOf(subject) !== null) return true;
  return frame.payload.kind === 'pane-attention';
}

/**
 * Feeds one relay push into the cache: a matching `gate/**` frame
 * updates the cache and runs `notify` (the board's SSE nudge) so open tabs
 * refresh; anything else is dropped silently.
 */
export function ingestRelayFrame(
  cache: GateCacheTarget,
  frame: GateEventFrame,
  notify: () => void
): void {
  if (!isBoardGateFrame(frame)) return;
  cache.applyEvent(frame);
  notify();
}

export type GateListPayload = {
  subjectPrefix?: string;
  kind?: string;
  cursor?: number;
  limit?: number;
};
export type GateListResult = {
  ok: boolean;
  data?: { gates: FacilityGateRow[]; cursor: number };
  error?: string;
};

/** Page size for every `gate:list` paging loop in this module. The daemon's
    `cursor` is a resume position, not a done-signal -- it is non-zero on
    every page once any row exists, including the last one (it becomes the
    store's max rowid). A short page (fewer rows than this limit) is the
    only reliable end-of-data signal; see the paging loops below. */
export const GATE_LIST_PAGE_LIMIT = 200;

/** Shared paging loop for both boot reconciles below: pages `list` to
    exhaustion under one query shape. A partial page ends the pass; the
    repeated-cursor check is a safety net against a daemon that returns a
    full page with no forward progress. */
async function pageGateList(
  list: (payload: GateListPayload) => Promise<GateListResult>,
  query: GateListPayload,
  errorLabel: string
): Promise<FacilityGateRow[]> {
  const rows: FacilityGateRow[] = [];
  let cursor: number | undefined;
  for (;;) {
    const res = await list({ ...query, cursor, limit: GATE_LIST_PAGE_LIMIT });
    if (!res.ok || !res.data) {
      console.error(
        `${errorLabel}: gate:list failed: ${res.error ?? 'unknown error'}`
      );
      break;
    }
    rows.push(...res.data.gates);
    if (
      res.data.gates.length < GATE_LIST_PAGE_LIMIT ||
      res.data.cursor === cursor
    )
      break;
    cursor = res.data.cursor;
  }
  return rows;
}

/**
 * Boot-time cache warm: pages `gateList({subjectPrefix: "mr:"})` to
 * exhaustion and reconciles every row gathered in one call, so a board that
 * was down still opens with current gates rather than an empty cache
 * waiting on the next bus event.
 */
export async function reconcileGatesOnBoot(
  list: (payload: GateListPayload) => Promise<GateListResult>,
  cache: GateReconcileTarget
): Promise<void> {
  const rows = await pageGateList(
    list,
    { subjectPrefix: 'mr:' },
    'gate boot reconcile'
  );
  cache.reconcile(rows);
}

/**
 * Boot-time cache warm for the attention queue: pages
 * `gateList({kind: "pane-attention"})` to exhaustion -- no `subjectPrefix`,
 * since these rows target an agent/pane subject rather than `mr:` -- and
 * reconciles them into the same cache `reconcileGatesOnBoot` warms, so a
 * human-owned attention gate still shows up in `queueExtras` after a board
 * restart rather than waiting on the next bus event.
 */
export async function reconcileAttentionGatesOnBoot(
  list: (payload: GateListPayload) => Promise<GateListResult>,
  cache: GateReconcileTarget
): Promise<void> {
  const rows = await pageGateList(
    list,
    { kind: 'pane-attention' },
    'gate boot reconcile (attention)'
  );
  cache.reconcile(rows);
}

/** Re-lists every gate scope the board caches. The relay is broadcast-only
    with no replay, so frames sent while it was disconnected are lost; this
    is what brings the cache back in line after a gap. Overlapping calls
    collapse into the one already running. */
export class GateResync {
  private inFlight: Promise<boolean> | null = null;

  constructor(
    private readonly list: (
      payload: GateListPayload
    ) => Promise<GateListResult>,
    private readonly cache: GateReconcileTarget & {
      readonly revision: number;
      get(subject: string, kind: string): FacilityGateRow | undefined;
    },
    private readonly onError: (message: string) => void
  ) {}

  run(): Promise<boolean> {
    if (this.inFlight) return Promise.resolve(false);
    const before = this.cache.revision;
    this.inFlight = (async () => {
      try {
        await reconcileGatesOnBoot(this.list, this.cache);
        await reconcileAttentionGatesOnBoot(this.list, this.cache);
        await resyncRunGates(this.list, this.cache);
      } catch (err) {
        this.onError(
          `gate resync failed: ${err instanceof Error ? err.message : err}`
        );
      } finally {
        this.inFlight = null;
      }
      return this.cache.revision !== before;
    })();
    return this.inFlight;
  }
}

/**
 * Boot-time cache warm for pipeline gates: pages
 * `gateList({subjectPrefix: "run:"})` to exhaustion, so a run gate opened
 * while the board was down still joins its MR's row. Only live rows reach
 * the cache, since a settled run gate never renders; `gate:list`'s `open`
 * filter would drop parked rows, so the filter runs here.
 */
export async function reconcileRunGatesOnBoot(
  list: (payload: GateListPayload) => Promise<GateListResult>,
  cache: GateReconcileTarget
): Promise<void> {
  const rows = await pageGateList(
    list,
    { subjectPrefix: 'run:' },
    'gate boot reconcile (runs)'
  );
  cache.reconcile(newestLiveRows(rows));
}

/** A run gate settled during a relay gap must reach a cache that still
    holds it as open, or it stays counted; a settled row the cache never held
    is not added, the same as the boot warm. */
async function resyncRunGates(
  list: (payload: GateListPayload) => Promise<GateListResult>,
  cache: GateReconcileTarget & {
    get(subject: string, kind: string): FacilityGateRow | undefined;
  }
): Promise<void> {
  const rows = await pageGateList(
    list,
    { subjectPrefix: 'run:' },
    'gate resync (runs)'
  );
  cache.reconcile(
    newestRows(rows).filter(
      row => isLive(row) || cache.get(row.subject, row.kind) !== undefined
    )
  );
}

function isLive(row: FacilityGateRow): boolean {
  return row.status === 'open' || row.status === 'parked';
}

/** Each subject+kind's newest row. A newer settled row must still shadow an
    older parked one: opening a gate supersedes only an `open` row of its
    kind, never a `parked` one. */
function newestRows(rows: FacilityGateRow[]): FacilityGateRow[] {
  const newest = new Map<string, FacilityGateRow>();
  for (const row of rows) {
    const key = `${row.subject}::${row.kind}`;
    const seen = newest.get(key);
    if (!seen || row.openedAt >= seen.openedAt) newest.set(key, row);
  }
  return [...newest.values()];
}

function newestLiveRows(rows: FacilityGateRow[]): FacilityGateRow[] {
  return newestRows(rows).filter(isLive);
}

/**
 * Client-shaped rows for the board's decision queue: a human-owned gate
 * (pane-attention or otherwise) whose subject is neither `mr:` nor `run:`
 * -- admission is by subject prefix, not by "no MR row currently matches
 * it". An `mr:` gate whose MR dropped out of the polled snapshot
 * (merged/closed while the gate stays open) must still attach through the
 * normal MR join, not leak in here as a queue item, and a `run:` gate shows
 * only through its run's MR (a run with no MR on the board stays the
 * console's). A herd-owned gate is excluded UNLESS the daemon has already
 * escalated it to a human (`escalatedAt` set) -- that herd's own board (or
 * shepherd) owns it otherwise, not this one -- and a closed row never
 * renders, same rule `attachGates` applies to MR-attached gates.
 */
export function buildQueueExtras(rows: FacilityGateRow[]): GateRow[] {
  const out: GateRow[] = [];
  for (const row of rows) {
    if (!isHumanOwned(row)) continue;
    if (row.subject.startsWith('mr:') || runIdOf(row.subject) !== null)
      continue;
    if (row.status === 'closed') continue;
    const label =
      typeof row.meta?.label === 'string' ? row.meta.label : row.kind;
    out.push({
      gateId: row.id,
      subject: row.subject,
      kind: row.kind,
      label,
      status: row.status,
      openedAt: row.openedAt,
      questions: row.questions as GateQuestion[],
      answers: row.answer?.answers as GateAnswers | undefined,
      answeredBy: row.answer?.by,
      answeredAt: row.answer?.answeredAt,
      context: row.context ?? undefined,
      origin: row.origin ?? undefined,
      domain: domainForKind(row.kind),
      meta: row.meta ?? undefined,
      escalatedAt: row.escalatedAt ?? undefined,
      owner: row.owner ?? undefined,
      delivery: cachedDelivery(row),
      execution: cachedExecution(row),
    });
  }
  return out;
}

// ── Bridge rule: the board's own entry in rt.notify.eventBridges ──────────

/** The rule this board contributes so opening a gate raises a desktop
    notification that opens the gate in the board on click. `{headline}` and
    `{summary}` are rt's computed fields: the `meta.headline` /
    `meta.summary` gateOpen sets (see gateNotifyCopy), falling back to the
    label and first question for a gate opened without them. An rt whose
    notify bridge predates those two fields renders them literally.
    `subjectPrefix: 'mr:'` is the rule's identity half that
    keeps it from colliding with console's `run:` rule on the same
    `gate/opened/*` pattern. Suppression is payload-driven on the daemon side
    (a payload `paneId` matching the focused pane drops the notification): no
    field on the rule itself. */
export function boardBridgeRule(boardUrl: string): EventBridgeRule {
  return {
    pattern: 'gate/opened/*',
    subjectPrefix: 'mr:',
    category: 'gate',
    title: '{headline}',
    message: '{summary}',
    url: `${boardUrl}/?gate={id}`,
  };
}

/** Boot step: reconcile `boardBridgeRule` against the url deck resolved (see
    `reconcileEventBridgeRule` for the deck-unreachable case). `stillWriter`
    is rechecked after the lookup: the await is long enough to lose the
    writer lease, and installing the rule then would point every gate
    notification at a board that has already stood down. */
export async function installBoardBridgeRule(opts: {
  read: () => EventBridgeRule[];
  write: (next: EventBridgeRule[]) => void;
  resolveUrl: () => Promise<string | null>;
  stillWriter: () => boolean;
}): Promise<void> {
  const deckUrl = await opts.resolveUrl();
  if (!opts.stillWriter()) return;
  reconcileEventBridgeRule({
    app: 'board',
    deckUrl,
    rule: boardBridgeRule,
    read: opts.read,
    write: opts.write,
    replacePatterns: ['board/gate/opened/*'],
  });
}
