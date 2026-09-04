import type { GateRow as FacilityGateRow } from "@mattstack/rt-client";

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
  return typeof v === "object" && v !== null;
}

/** True for a `gate/**` bus frame whose payload names an MR-scoped subject
    (`mr:...`) -- the only frames the board's cache tracks. A `run:` subject
    belongs to W3's console and is left alone. */
function isBoardGateFrame(frame: GateEventFrame): boolean {
  if (!GATE_BUS_TOPIC_RE.test(frame.topic)) return false;
  if (!isRecord(frame.payload)) return false;
  const subject = frame.payload.subject;
  return typeof subject === "string" && subject.startsWith("mr:");
}

/**
 * Feeds one relay push into the cache: a matching `gate/**` + `mr:` frame
 * updates the cache and runs `notify` (the board's SSE nudge) so open tabs
 * refresh; anything else is dropped silently.
 */
export function ingestRelayFrame(cache: GateCacheTarget, frame: GateEventFrame, notify: () => void): void {
  if (!isBoardGateFrame(frame)) return;
  cache.applyEvent(frame);
  notify();
}

type GateListPayload = { subjectPrefix: string; cursor?: number };
type GateListResult = { ok: boolean; data?: { gates: FacilityGateRow[]; cursor: number }; error?: string };

/**
 * Boot-time cache warm: pages `gateList({subjectPrefix: "mr:"})` to
 * exhaustion (a non-zero `cursor` means another page follows) and reconciles
 * every row gathered in one call, so a board that was down still opens with
 * current gates rather than an empty cache waiting on the next bus event.
 */
export async function reconcileGatesOnBoot(list: (payload: GateListPayload) => Promise<GateListResult>, cache: GateReconcileTarget): Promise<void> {
  const rows: FacilityGateRow[] = [];
  let cursor: number | undefined;
  for (;;) {
    const res = await list({ subjectPrefix: "mr:", cursor });
    if (!res.ok || !res.data) {
      console.error(`gate boot reconcile: gate:list failed: ${res.error ?? "unknown error"}`);
      break;
    }
    rows.push(...res.data.gates);
    if (!res.data.cursor) break;
    cursor = res.data.cursor;
  }
  cache.reconcile(rows);
}

// ── Bridge rule: the board's own entry in rt.notify.eventBridges ──────────

export interface EventBridgeRule {
  pattern: string;
  category: string;
  title: string;
  message: string;
}

/** The board's pre-facility bridge pattern, kept only so `ensureBridgeRule`
    can replace a rule a prior board version left behind. */
const LEGACY_GATE_OPENED_PATTERN = "board/gate/opened/*";

/** The rule this board contributes so opening a gate raises a desktop
    notification. `{label}` and `{subject}` interpolate straight from the
    `gate/opened/*` payload -- `label` is the `meta.label` the wrapper sets
    at open time (e.g. "review gate !4821"), already formatted for display,
    so the template needs no `iid`/`kind` lookup of its own. Suppression is
    payload-driven on the daemon side (a payload `paneId` matching the
    focused pane drops the notification): no field on the rule itself. */
export const GATE_OPENED_BRIDGE_RULE: EventBridgeRule = {
  pattern: "gate/opened/*",
  category: "gate",
  title: "{label}",
  message: "{subject}",
};

/**
 * Merge-not-clobber upsert: appends the board's gate-opened bridge rule to
 * whatever `read()` returns. A rule already at the current pattern is a
 * no-op; a rule still at the legacy `board/gate/opened/*` pattern (a prior
 * board version's entry) is replaced in place rather than left as a dead
 * duplicate alongside the new one. Every other entry -- other apps' rules,
 * hand edits -- rides along untouched.
 */
export function ensureBridgeRule(read: () => EventBridgeRule[], write: (next: EventBridgeRule[]) => void): void {
  const current = read();
  if (current.some((r) => r.pattern === GATE_OPENED_BRIDGE_RULE.pattern)) return;
  const withoutLegacy = current.filter((r) => r.pattern !== LEGACY_GATE_OPENED_PATTERN);
  write([...withoutLegacy, GATE_OPENED_BRIDGE_RULE]);
}
