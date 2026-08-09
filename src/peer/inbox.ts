import {
  parseNudgeOutcomePayload, parseReReviewRequestPayload, parseReviewStatePayload,
  type Envelope, type NudgeResult,
} from "./envelope.ts";
import type { PeerReviewState } from "./peer-reviews.ts";
import type { NudgeState } from "./nudges.ts";
import { drainOutbox } from "./outbox.ts";
import type { SwitchboardClient } from "./client.ts";

export interface MaterializeDeps {
  writePeerReview(s: PeerReviewState): unknown;
  writeNudge(n: NudgeState): void;
  resolveSentNudge(mrUrl: string, resolution: { result: NudgeResult | "confirmed"; reason?: string; at: number }): void;
  log(line: string): void;
}

/** The board's entire inbound involvement: materialize, never decide. Every
    branch ends ack-safe -- malformed or unknown envelopes are logged and
    dropped so a bad message can't wedge the inbox forever. */
export function materializeEnvelope(e: Envelope, deps: MaterializeDeps, now: number = Date.now()): void {
  if (e.type === "review-state") {
    const p = parseReviewStatePayload(e.payload);
    if (!p) return deps.log(`peer: malformed review-state from ${e.from} (${e.id})`);
    deps.writePeerReview({ ...p, reviewer: e.from });
    // A reviewing transition confirms any pending sent nudge for this MR: the
    // re-review actually started, whichever of state/outcome lands first.
    if (p.status === "queued" || p.status === "reviewing") {
      deps.resolveSentNudge(p.mrUrl, { result: "confirmed", at: now });
    }
    return;
  }
  if (e.type === "re-review-request") {
    const p = parseReReviewRequestPayload(e.payload);
    if (!p) return deps.log(`peer: malformed re-review-request from ${e.from} (${e.id})`);
    deps.writeNudge({ id: e.id, mrUrl: p.mrUrl, iid: p.iid, from: e.from, note: p.note, receivedAt: e.receivedAt });
    return;
  }
  if (e.type === "nudge-outcome") {
    const p = parseNudgeOutcomePayload(e.payload);
    if (!p) return deps.log(`peer: malformed nudge-outcome from ${e.from} (${e.id})`);
    deps.resolveSentNudge(p.mrUrl, { result: p.result, reason: p.reason, at: now });
    return;
  }
  deps.log(`peer: ignoring unknown envelope type "${e.type}" from ${e.from} (${e.id})`);
}

/** One poll cycle: push what's queued, pull what's pending, materialize, ack.
    Runs on the board's 60s tick and once at startup. Best-effort throughout --
    a dead relay must never affect the board's own rendering, and this is
    called as `void runPeerTick(...)` from an interval, so it swallows and logs
    rather than rejecting into an unhandled rejection. Every fetched id is
    acked, malformed and unknown alike: they were logged, and leaving them
    pending would wedge the inbox forever. */
export async function runPeerTick(
  client: SwitchboardClient,
  deps: MaterializeDeps,
  outboxDir?: string,
): Promise<void> {
  try {
    await drainOutbox((d) => client.publish(d), outboxDir);
    const envelopes = await client.inbox();
    if (!envelopes) return;
    for (const e of envelopes) {
      // Payload parse failures are already handled inside; this catches a
      // throwing store write (fs errors). One bad envelope must not skip the
      // batch's ack, or the batch redelivers and re-throws forever.
      try {
        materializeEnvelope(e, deps);
      } catch (err) {
        deps.log(`peer: materialize failed for ${e.id} from ${e.from}: ${err instanceof Error ? err.message : err}`);
      }
    }
    await client.ack(envelopes.map((e) => e.id));
  } catch (err) {
    deps.log(`peer: tick failed: ${err instanceof Error ? err.message : err}`);
  }
}
