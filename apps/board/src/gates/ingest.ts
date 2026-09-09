import type { EventBridgeRule } from '@mattstack/app-server/event-bridge';
import type { GateRow as FacilityGateRow } from '@mattstack/rt-client';

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
    (`mr:...`) -- the only frames the board's cache tracks. A `run:` subject
    belongs to W3's console and is left alone. */
function isBoardGateFrame(frame: GateEventFrame): boolean {
  if (!GATE_BUS_TOPIC_RE.test(frame.topic)) return false;
  if (!isRecord(frame.payload)) return false;
  const subject = frame.payload.subject;
  return typeof subject === 'string' && subject.startsWith('mr:');
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
  subjectPrefix: string;
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
  const rows: FacilityGateRow[] = [];
  let cursor: number | undefined;
  for (;;) {
    const res = await list({
      subjectPrefix: 'mr:',
      cursor,
      limit: GATE_LIST_PAGE_LIMIT,
    });
    if (!res.ok || !res.data) {
      console.error(
        `gate boot reconcile: gate:list failed: ${res.error ?? 'unknown error'}`
      );
      break;
    }
    rows.push(...res.data.gates);
    // A partial page ends the pass; the repeated-cursor check is a safety
    // net against a daemon that returns a full page with no forward progress.
    if (
      res.data.gates.length < GATE_LIST_PAGE_LIMIT ||
      res.data.cursor === cursor
    )
      break;
    cursor = res.data.cursor;
  }
  cache.reconcile(rows);
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
