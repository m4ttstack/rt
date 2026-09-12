import type { EventBridgeRule } from '@mattstack/app-server/event-bridge';
import { domainForKind } from '@mattstack/gate-kit';
import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';
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
    (`mr:...`) -- the board's cache tracks those -- OR a `pane-attention`
    gate, whose subject targets an agent/pane rather than an MR and is
    accepted on kind alone so it can still reach `queueExtras`. Any other
    non-`mr:` subject (a `run:` kind belonging to W3's console, say) is left
    alone. */
function isBoardGateFrame(frame: GateEventFrame): boolean {
  if (!GATE_BUS_TOPIC_RE.test(frame.topic)) return false;
  if (!isRecord(frame.payload)) return false;
  const subject = frame.payload.subject;
  if (typeof subject !== 'string' || !subject) return false;
  if (subject.startsWith('mr:')) return true;
  return frame.payload.kind === 'pane-attention';
}

/**
 * Feeds one relay push into the cache: a matching `gate/**` + `mr:` frame
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

type GateListPayload = {
  subjectPrefix?: string;
  kind?: string;
  cursor?: number;
  limit?: number;
};
type GateListResult = {
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

/**
 * Client-shaped rows for the board's decision queue: a human-owned gate
 * (pane-attention or otherwise) whose subject is NOT `mr:`-prefixed --
 * admission is by subject prefix, not by "no MR row currently matches it".
 * An `mr:` gate whose MR dropped out of the polled snapshot (merged/closed
 * while the gate stays open) must still attach through the normal MR join,
 * not leak in here as a queue item. A herd-owned gate is excluded UNLESS
 * the daemon has already escalated it to a human (`escalatedAt` set) --
 * that herd's own board (or shepherd) owns it otherwise, not this one --
 * and a closed row never renders, same rule `attachGates` applies to
 * MR-attached gates.
 */
export function buildQueueExtras(rows: FacilityGateRow[]): GateRow[] {
  const out: GateRow[] = [];
  for (const row of rows) {
    const isHuman = row.owner === 'human';
    const isEscalatedHerd =
      typeof row.owner === 'string' &&
      row.owner.startsWith('herd:') &&
      row.escalatedAt != null;
    if (!isHuman && !isEscalatedHerd) continue;
    if (row.subject.startsWith('mr:')) continue;
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
    });
  }
  return out;
}

// ── Bridge rule: the board's own entry in rt.notify.eventBridges ──────────

/** The rule this board contributes so opening a gate raises a desktop
    notification that opens the gate in the board on click. `{label}` and
    `{question}` interpolate from the `gate/opened/*` payload -- `label` is
    the `meta.label` the wrapper sets at open time (e.g. "review gate
    !4821"), already formatted for display, so the template needs no
    `iid`/`kind` lookup of its own. `subjectPrefix: 'mr:'` is the rule's
    identity half that keeps it from colliding with console's `run:` rule
    on the same `gate/opened/*` pattern. Suppression is payload-driven on
    the daemon side (a payload `paneId` matching the focused pane drops the
    notification): no field on the rule itself. */
export function boardBridgeRule(boardUrl: string): EventBridgeRule {
  return {
    pattern: 'gate/opened/*',
    subjectPrefix: 'mr:',
    category: 'gate',
    title: '{label}',
    message: '{question}',
    url: `${boardUrl}/?gate={id}`,
  };
}
