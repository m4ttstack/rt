import {
  parseNudgeOutcomePayload, parseReReviewRequestPayload, parseReviewStatePayload,
  type Envelope, type NudgeResult,
} from "./envelope.ts";
import type { PeerReviewState } from "./peer-reviews.ts";
import type { NudgeState } from "./nudges.ts";

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
