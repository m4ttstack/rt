/**
 * gate-push — envelope-wrapped pane push on gate answered, plus subscription
 * fan-out on both opened and answered. Delivery is always fire-and-forget
 * from the caller's side (handlers/gate.ts): every outcome here is recorded
 * on the store, never thrown, so a delivery failure can never fail a gate:*
 * verb.
 *
 * Binding rule: the pane push targets `row.nudge.session` ONLY. The opener records its own session id at `gate open`. No nudge means no push --
 * the unattended-gate case blocks in `gate wait` with nothing to wake.
 *
 * The Escape injection passes `origin.paneId` (or the top-level `row.pane`),
 * `nudge.session`, and `origin.worktree` as resolver hints -- a stale or
 * missing paneId still resolves via session or worktree before the
 * injector gives up and leaves the gate doorbell-only.
 *
 * Self-answer rule (RT-133): a surface that RECORDED the answer is never
 * notified of it -- not on the pane channel, not in the fan-out. It already
 * holds the authoritative row (`gate:answer` returns it), so a notice there
 * is pure noise that reads to an operator as a conflict that never happened.
 *
 * Answers never travel in the push body: it is always the fixed
 * envelope-wrapped phrase, so a stale or racing pane is told to re-read the
 * registry rather than trust a value that may already be stale by delivery
 * time.
 */

import type { Logger } from "pino";
import { deliverToInbox, wrapCrossSession } from "./inbox.ts";
import type { GateRow, GateSubscription, GatesStore } from "./gates-store.ts";
import { GATE_BY_PANE, answeredBySession, answeredByNudgedPane } from "./gates-store.ts";
import type { EscapeInjector } from "./gate-escape.ts";
import type { PaneHints } from "./pane-resolve-live.ts";

/** Shared hint-construction for the Escape injector here and for the
    answer-time executor guarantee (handlers/gate.ts): origin.paneId wins
    over the top-level pane column, matching sameOpenerPane's own
    precedence. */
export function gateHints(row: Pick<GateRow, "origin" | "pane" | "nudge">): PaneHints {
  return {
    paneId: row.origin?.paneId || row.pane || undefined,
    sessionId: row.nudge?.session,
    worktree: row.origin?.worktree,
  };
}

/** `by` is caller-supplied free text (`gate answer --by <surface>`) that rides
    into a model-visible cross-session body, so it is a prompt-injection
    surface: only a known surface is named back; anything else collapses to one
    generic label rather than reaching an agent's context verbatim. The strip +
    cap still runs on the lookup key so a known name survives odd whitespace and
    an unknown one is bounded before it is discarded. */
const SURFACE_CAP = 32;
const KNOWN_SURFACES: Record<string, string> = {
  [GATE_BY_PANE]: "pane",
  console: "console",
  board: "board",
  shepherd: "shepherd",
  human: "human",
};
const UNKNOWN_SURFACE = "another surface";
export function safeSurface(by: string | undefined): string {
  const cleaned = (by ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!cleaned) return UNKNOWN_SURFACE;
  const key = cleaned.length > SURFACE_CAP ? cleaned.slice(0, SURFACE_CAP) : cleaned;
  return KNOWN_SURFACES[key] ?? UNKNOWN_SURFACE;
}

/** Names the answering surface rather than saying "elsewhere" (RT-133), so a
    watcher that recognizes its own surface can no-op. Still carries no
    answer: see the header's no-answers-in-the-body rule. */
export const GATE_ANSWERED_PHRASE = (id: string, by?: string) =>
  `[gate] ${id} answered by ${safeSurface(by)}; re-read the registry and proceed on the recorded answer.`;

export { answeredBySession };

/** Sibling of GATE_ANSWERED_PHRASE for the supersede/close paths, which end
    a gate with no answer ever coming -- a form pane waiting on it needs the
    same doorbell-then-Escape nudge, worded so it never reads as "answered". */
export const GATE_CLOSED_PHRASE = (id: string, reason: GateRow["closedReason"]) =>
  reason === "superseded"
    ? `[gate] ${id} superseded by a newer gate; re-read the registry and proceed.`
    : `[gate] ${id} closed; re-read the registry and proceed.`;

/** Fan-out notification: push text is data, never instructions, and carries
    no opener-controlled content -- `subject` is opener-set and must never
    ride a cross-session message body. id + status + presentation + owner
    only, so a shepherd reading the doorbell already knows whether Escape
    fires and who is on the hook to answer -- never the opener-set subject. */
export const GATE_SUBSCRIPTION_PHRASE = (row: Pick<GateRow, "id" | "status" | "origin" | "owner" | "answer">) => {
  const presentation = row.origin?.presentation ?? "wait";
  const owner = row.owner ?? "human";
  const by = row.status === "answered" && row.answer ? ` by ${safeSurface(row.answer.by)}` : "";
  return `[gate] ${row.id} is now ${row.status}${by} (${presentation}, owner ${owner}); re-read the gate registry.`;
};

const DEFAULT_DEAD_AFTER_FAILURES = 3;
const DEFAULT_MAX_PANE_RETRIES = 20;

export interface GatePush {
  /** Pane push (attended gates with a nudge) + subscription fan-out. */
  onAnswered(row: GateRow): Promise<void>;
  /** Subscription fan-out only -- there is no pane to wake on open. */
  onOpened(row: GateRow): Promise<void>;
  /** Pane push only, on a gate that ends WITHOUT an answer (supersede or
      gate:close). Same doorbell-then-Escape delivery as onAnswered -- a
      form-blocked pane otherwise never learns its gate ended. */
  onClosed(row: GateRow): Promise<void>;
  /** Retry dead-pane nudges up to maxPaneRetries per gate, plus the
      answered-unconsumed re-delivery sweep. */
  retryDeadPanes(): Promise<{ retried: number; delivered: number; gaveUp: number; reNudged: number }>;
}

export function createGatePush(opts: {
  store: GatesStore;
  deliver: typeof deliverToInbox;
  resolveSession: (sessionId: string) => { socketPath: string } | null;
  /** Batch form for fan-out: one directory scan per event instead of one
      per subscriber. Optional so existing callers (and tests) that only
      wire `resolveSession` keep working unchanged, falling back to a
      per-subscriber resolveSession call. */
  resolveAll?: () => Map<string, { socketPath: string }>;
  log: Logger;
  deadAfterFailures?: number;
  injectEscape?: EscapeInjector;
  maxPaneRetries?: number;
}): GatePush {
  const { store, deliver, resolveSession, resolveAll, log } = opts;
  const deadAfterFailures = opts.deadAfterFailures ?? DEFAULT_DEAD_AFTER_FAILURES;
  const maxPaneRetries = opts.maxPaneRetries ?? DEFAULT_MAX_PANE_RETRIES;

  // Consecutive-failure counts live only in daemon memory, not the store:
  // the store's `lastDelivery` is a single observable outcome, not a running
  // tally. A daemon restart resets the count, which just means a
  // borderline-dead subscription gets a fresh run of chances -- acceptable,
  // since the alternative (persisting a counter) buys nothing `dead` doesn't
  // already give a reader.
  const consecutiveFailures = new Map<string, number>();
  const paneAttempts = new Map<string, number>();
  // Re-delivery sweep state, keyed by gate id, mirroring the paneAttempts
  // idiom above: a daemon restart resets these, which just restarts a
  // borderline row's cadence rather than losing correctness.
  const consumeSweepCounter = new Map<string, number>();
  const consumeAttempts = new Map<string, number>();
  const consumeGivenUp = new Set<string>();
  let paneRetriesInFlight = false;

  async function safeDeliver(socketPath: string, body: string, context: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await deliver(socketPath, body);
      return result.ok;
    } catch (err) {
      log.warn({ err, ...context }, "gate-push: delivery threw");
      return false;
    }
  }

  /** The doorbell half of a pane push: resolves the nudge session, delivers
      the wrapped phrase, and (unless `recordDelivery` is false) records the
      outcome exactly as pushToPane does. No Escape injection -- the
      re-delivery sweep calls this directly so a re-fired doorbell every 4th
      sweep never risks interrupting the very consumption turn it is trying
      to trigger.
      `recordDelivery: false` is the re-delivery sweep's own mode: a
      transient failure there must never demote a confirmed row into the
      dead-pane retry pass (which injects Escape), and a transient success
      must never overwrite a `confirmed` outcome herd status already reads.
      The row keeps whatever delivery outcome it had before the sweep touched
      it, either way. */
  async function pushDoorbell(row: GateRow, phrase: string, opts: { recordDelivery?: boolean } = {}): Promise<boolean> {
    const recordDelivery = opts.recordDelivery ?? true;
    const sessionId = row.nudge?.session;
    if (!sessionId) return false;
    const binding = resolveSession(sessionId);
    if (!binding) {
      if (recordDelivery) store.markDelivery(row.id, "dead-pane");
      return false;
    }
    const body = wrapCrossSession("gate-facility", phrase);
    const ok = await safeDeliver(binding.socketPath, body, { gateId: row.id, sessionId });
    if (recordDelivery) store.markDelivery(row.id, ok ? "delivered" : "dead-pane");
    return ok;
  }

  async function pushToPane(row: GateRow, phrase: string): Promise<void> {
    const ok = await pushDoorbell(row, phrase);
    // Escape only ever follows an ACCEPTED doorbell: the dismissed form's
    // next input must be the queued frame, and a dead pane has nothing
    // queued to find.
    if (!ok || !opts.injectEscape) return;
    if (row.origin?.presentation !== "form") return;
    // Same self-answer test as the doorbell: a form the nudged pane answered
    // itself has already dismissed, so Escape would land on the wrong frame.
    // A foreign surface's `by: "pane"` must not gate this off -- session wins.
    if (answeredByNudgedPane(row)) return;
    const hints = gateHints(row);
    const injected = await opts.injectEscape(hints);
    if (injected.ok) {
      log.debug({ gateId: row.id, paneRef: injected.paneRef }, "gate-push: escape injected");
    } else {
      log.warn({ gateId: row.id, hints, error: injected.error }, "gate-push: escape injection failed; doorbell-only");
    }
  }

  function recordSubscriptionOutcome(sub: GateSubscription, ok: boolean): void {
    store.markSubscriptionDelivery(sub.id, ok ? "delivered" : "failed");
    if (ok) {
      consecutiveFailures.delete(sub.id);
      return;
    }
    const count = (consecutiveFailures.get(sub.id) ?? 0) + 1;
    if (count >= deadAfterFailures) {
      store.markSubscriptionDead(sub.id);
      consecutiveFailures.delete(sub.id);
    } else {
      consecutiveFailures.set(sub.id, count);
    }
  }

  async function pushToSubscription(
    row: GateRow,
    sub: GateSubscription,
    registry: Map<string, { socketPath: string }> | null,
  ): Promise<void> {
    const binding = registry ? (registry.get(sub.session) ?? null) : resolveSession(sub.session);
    if (!binding) {
      recordSubscriptionOutcome(sub, false);
      return;
    }
    const body = wrapCrossSession("gate-facility", GATE_SUBSCRIPTION_PHRASE(row));
    const ok = await safeDeliver(binding.socketPath, body, { gateId: row.id, subId: sub.id });
    recordSubscriptionOutcome(sub, ok);
  }

  async function fanOut(row: GateRow): Promise<void> {
    // liveIds must span EVERY live subscription, not just this event's
    // prefix-filtered subset: pruning against `subs` would wipe the failure
    // counter of a live subscriber watching a different prefix on every
    // fan-out that doesn't match it, so a chronically-failing subscriber on
    // an untouched prefix could never reach deadAfterFailures.
    const allLive = store.subscriptions({ live: true });
    const matched = allLive.filter((sub) =>
      sub.scope === "owner" ? row.owner !== null && row.owner === sub.ownerRef : row.subject.startsWith(sub.subjectPrefix),
    );
    // One session can hold both a prefix row and an owner row that both
    // match the same gate (e.g. a herd shepherd's own job gate, which is
    // both under its herd: prefix and owned by it) -- dedupe to one push per
    // session, first match wins, so the other row's delivery outcome is left
    // untouched rather than double-recorded.
    const seenSessions = new Set<string>();
    const subs: GateSubscription[] = [];
    for (const sub of matched) {
      if (seenSessions.has(sub.session)) continue;
      seenSessions.add(sub.session);
      // Self-answer rule: the subscriber that wrote this answer already has
      // it. Skipping is silent on purpose -- no delivery outcome is recorded,
      // because nothing was attempted and a "failed" mark would push a
      // healthy subscription toward `dead`.
      if (answeredBySession(row, sub.session)) continue;
      subs.push(sub);
    }
    // Batch registry resolution: one scan for the whole fan-out (resolveAll,
    // when wired) rather than resolveSession re-scanning per subscriber.
    const registry = resolveAll ? resolveAll() : null;
    // Lazy prune: a subscription no longer in the live set (unsubscribed, or
    // pruned dead by a prior failure run) has nothing more to fail, so its
    // failure count would otherwise leak forever.
    const liveIds = new Set(allLive.map((s) => s.id));
    for (const key of [...consecutiveFailures.keys()]) {
      if (!liveIds.has(key)) consecutiveFailures.delete(key);
    }
    await Promise.all(subs.map((sub) => pushToSubscription(row, sub, registry)));
  }

  return {
    async onAnswered(row) {
      // Self-answer rule: no doorbell back to the pane that recorded it. No
      // delivery stamp either, so the row never enters deadPanePushes() and
      // retryDeadPanes has nothing to redeliver.
      const pane = answeredByNudgedPane(row)
        ? Promise.resolve()
        : pushToPane(row, GATE_ANSWERED_PHRASE(row.id, row.answer?.by));
      await Promise.all([pane, fanOut(row)]);
    },
    async onOpened(row) {
      await fanOut(row);
    },
    async onClosed(row) {
      await pushToPane(row, GATE_CLOSED_PHRASE(row.id, row.closedReason));
    },
    async retryDeadPanes() {
      if (paneRetriesInFlight) return { retried: 0, delivered: 0, gaveUp: 0, reNudged: 0 };
      paneRetriesInFlight = true;
      try {
        let retried = 0, delivered = 0, gaveUp = 0;
        const live = new Set<string>();
        for (const row of store.deadPanePushes()) {
          live.add(row.id);
          const attempts = paneAttempts.get(row.id) ?? 0;
          if (attempts >= maxPaneRetries) continue;
          retried++;
          paneAttempts.set(row.id, attempts + 1);
          await pushToPane(row, GATE_ANSWERED_PHRASE(row.id, row.answer?.by));
          const after = store.get(row.id);
          if (after?.delivery?.outcome === "delivered") { delivered++; paneAttempts.delete(row.id); }
          else if (attempts + 1 >= maxPaneRetries) { gaveUp++; log.warn({ gateId: row.id, session: row.nudge?.session }, "gate-push: pane nudge gave up; worker was never woken"); }
        }
        for (const id of [...paneAttempts.keys()]) if (!live.has(id)) paneAttempts.delete(id);

        // Re-delivery sweep: doorbell-only, via pushDoorbell rather than
        // pushToPane -- re-firing Escape on a cadence risks interrupting
        // the very consumption turn this sweep is chasing.
        let reNudged = 0;
        const unconsumedLive = new Set<string>();
        for (const row of store.unconsumedAnsweredPushes()) {
          unconsumedLive.add(row.id);
          const counter = (consumeSweepCounter.get(row.id) ?? 0) + 1;
          consumeSweepCounter.set(row.id, counter);
          if (counter % 4 !== 0) continue;
          if (consumeGivenUp.has(row.id)) continue;
          const consumeAttemptCount = consumeAttempts.get(row.id) ?? 0;
          if (consumeAttemptCount < 5) {
            consumeAttempts.set(row.id, consumeAttemptCount + 1);
            await pushDoorbell(row, GATE_ANSWERED_PHRASE(row.id, row.answer?.by), { recordDelivery: false });
            reNudged++;
          } else {
            consumeGivenUp.add(row.id);
            log.warn({ gateId: row.id, session: row.nudge?.session }, "gate-push: answer never consumed; giving up");
          }
        }
        for (const id of [...consumeSweepCounter.keys()]) {
          if (!unconsumedLive.has(id)) {
            consumeSweepCounter.delete(id);
            consumeAttempts.delete(id);
            consumeGivenUp.delete(id);
          }
        }

        return { retried, delivered, gaveUp, reNudged };
      } finally {
        paneRetriesInFlight = false;
      }
    },
  };
}
