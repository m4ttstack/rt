import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runPeerTick, type MaterializeDeps } from "../peer/inbox.ts";
import { enqueueOutbox, readOutbox } from "../peer/outbox.ts";
import type { SwitchboardClient } from "../peer/client.ts";
import type { DraftEnvelope, Envelope, NudgeResult } from "../peer/envelope.ts";
import type { PeerReviewState } from "../peer/peer-reviews.ts";
import type { NudgeState } from "../peer/nudges.ts";

const URL_A = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

let dir: string | undefined;
function freshDir(): string {
  dir = mkdtempSync(join(tmpdir(), "peer-tick-"));
  return dir;
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const draft = (id: string): DraftEnvelope => ({ id, to: "grace", type: "review-state", sentAt: 1, payload: {} });

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    id: "env-1",
    to: "ada",
    from: "grace",
    type: "review-state",
    sentAt: 100,
    receivedAt: 200,
    payload: { mrUrl: URL_A, iid: 4821, status: "reviewing", updatedAt: 500 },
    ...over,
  };
}

/** Records the order of every relay call, so the test can assert that the
    outbox drains before the inbox is pulled. */
function fakeClient(
  inboxResult: Envelope[] | null,
  over: Partial<SwitchboardClient> = {},
): SwitchboardClient & { calls: string[]; acked: string[][] } {
  const calls: string[] = [];
  const acked: string[][] = [];
  return {
    calls,
    acked,
    async publish(d) {
      calls.push(`publish:${d.id}`);
      return 201;
    },
    async inbox() {
      calls.push("inbox");
      return inboxResult;
    },
    async ack(ids) {
      calls.push("ack");
      acked.push(ids);
      return true;
    },
    ...over,
  };
}

function fakeDeps(): MaterializeDeps & {
  peerReviews: PeerReviewState[];
  nudges: NudgeState[];
  resolutions: Array<{ mrUrl: string; resolution: { result: NudgeResult | "confirmed"; reason?: string; at: number } }>;
  logs: string[];
} {
  const peerReviews: PeerReviewState[] = [];
  const nudges: NudgeState[] = [];
  const resolutions: Array<{ mrUrl: string; resolution: { result: NudgeResult | "confirmed"; reason?: string; at: number } }> = [];
  const logs: string[] = [];
  return {
    peerReviews,
    nudges,
    resolutions,
    logs,
    writePeerReview(s) {
      peerReviews.push(s);
      return true;
    },
    writeNudge(n) {
      nudges.push(n);
    },
    resolveSentNudge(mrUrl, resolution) {
      resolutions.push({ mrUrl, resolution });
    },
    log(line) {
      logs.push(line);
    },
  };
}

describe("runPeerTick", () => {
  test("drains the outbox before pulling the inbox", async () => {
    const outbox = freshDir();
    enqueueOutbox(draft("e1"), outbox, 1);
    const client = fakeClient([]);
    await runPeerTick(client, fakeDeps(), outbox);
    expect(client.calls).toEqual(["publish:e1", "inbox", "ack"]);
    expect(readOutbox(outbox)).toEqual([]);
  });

  test("materializes every fetched envelope and acks all of their ids", async () => {
    const outbox = freshDir();
    const client = fakeClient([
      envelope({ id: "a" }),
      envelope({ id: "b", type: "re-review-request", payload: { mrUrl: URL_A, iid: 4821 } }),
    ]);
    const deps = fakeDeps();
    await runPeerTick(client, deps, outbox);
    expect(deps.peerReviews.map((p) => p.reviewer)).toEqual(["grace"]);
    expect(deps.nudges.map((n) => n.id)).toEqual(["b"]);
    expect(client.acked).toEqual([["a", "b"]]);
  });

  test("acks malformed and unknown envelopes too, so a bad message can't wedge the inbox", async () => {
    const outbox = freshDir();
    const client = fakeClient([
      envelope({ id: "bad", payload: { mrUrl: URL_A } }),
      envelope({ id: "alien", type: "smoke-signal", payload: {} }),
    ]);
    const deps = fakeDeps();
    await runPeerTick(client, deps, outbox);
    expect(deps.peerReviews).toEqual([]);
    expect(deps.logs.length).toBe(2);
    expect(client.acked).toEqual([["bad", "alien"]]);
  });

  test("a throwing materialize doesn't stop the batch or skip the ack", async () => {
    const outbox = freshDir();
    const client = fakeClient([
      envelope({ id: "boom" }),
      envelope({ id: "fine", from: "linus" }),
    ]);
    const deps = fakeDeps();
    // Only the first envelope's store write blows up (a disk error, say).
    let first = true;
    deps.writePeerReview = (s) => {
      if (first) {
        first = false;
        throw new Error("disk on fire");
      }
      deps.peerReviews.push(s);
      return true;
    };
    await runPeerTick(client, deps, outbox);
    expect(deps.peerReviews.map((p) => p.reviewer)).toEqual(["linus"]);
    expect(deps.logs.length).toBe(1);
    expect(deps.logs[0]).toContain("disk on fire");
    expect(client.acked).toEqual([["boom", "fine"]]);
  });

  test("acks nothing when the inbox call fails", async () => {
    const outbox = freshDir();
    const client = fakeClient(null);
    await runPeerTick(client, fakeDeps(), outbox);
    expect(client.calls).toEqual(["inbox"]);
    expect(client.acked).toEqual([]);
  });

  test("never rejects when the relay client throws -- the interval callback must survive", async () => {
    const outbox = freshDir();
    const client = fakeClient([], {
      async inbox() {
        throw new Error("relay exploded");
      },
    });
    const deps = fakeDeps();
    await runPeerTick(client, deps, outbox);
    expect(deps.logs.length).toBe(1);
    expect(deps.logs[0]).toContain("relay exploded");
  });
});
