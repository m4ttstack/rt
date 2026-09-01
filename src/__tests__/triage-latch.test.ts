import { describe, expect, test } from "bun:test";
import { mkdirSync, cpSync } from "fs";
import { join } from "path";
import type { MRDetail } from "@mattstack/glance";
import { parseTriageBlock } from "../triage/config.ts";
import { emptyMrMemory, type DispatchMemory } from "../triage/memory.ts";
import { armedLatchBody, spentLatchBody } from "../latch/markers.ts";
import type { LatchGateway } from "../latch/post.ts";
import type { ReviewState } from "../review-state.ts";
import { runLatchPass, type LatchMrFacts, type LatchPassDeps } from "../triage/latch.ts";
import { APP_ROOT } from "../app-root.ts";

// test-setup.ts points BOARD_APP_ROOT at a throwaway temp dir per test file,
// so postLatch's default banner path (derived from APP_ROOT) misses the real
// committed band unless this file seeds it too, same as latch-post.test.ts.
mkdirSync(join(APP_ROOT, "assets"), { recursive: true });
cpSync(join(import.meta.dir, "..", "..", "assets", "latch-band.png"), join(APP_ROOT, "assets", "latch-band.png"));

const NOW = 1_000_000_000;
const MR = "https://gitlab.com/acme/web/-/merge_requests/2317";
const IMG = "![re-review latch](/uploads/ab12/latch-2317.png)";
const cfg = parseTriageBlock({ enabled: true, cooldownMinutes: 30, dailyAttemptBudget: 3 });

const facts: LatchMrFacts = {
  mrUrl: MR, iid: 2317, projectId: 42, projectPath: "acme/web",
  rtRepo: "acme-web", isApproved: false,
};
const commented: ReviewState = {
  mrUrl: MR, iid: 2317, status: "done", outcome: "comment", startedAt: 0, updatedAt: 0,
};

function disc(id: string, body: string, createdAt: string, resolved: boolean) {
  return {
    id, resolvable: true, resolved,
    notes: [{
      id: 1, body, author: { id: 1, username: "matt", name: "Matt", avatarUrl: null },
      createdAt, system: false, type: "DiscussionNote", resolvable: true, resolved, position: null,
    }],
  };
}
const detail = (...d: ReturnType<typeof disc>[]) =>
  ({ mrIid: 2317, repositoryId: "gitlab:42", discussions: d } as unknown as MRDetail);

function harness(over: Partial<LatchPassDeps> & { detail?: MRDetail | null } = {}) {
  const calls: string[] = [];
  const launches: string[] = [];
  const gateway: LatchGateway = {
    async uploadFile() { calls.push("upload"); return { alt: "", url: "", full_path: "", markdown: IMG }; },
    async createDiscussion() { calls.push("createDiscussion"); return { id: "new", notes: [{ id: 1 }] }; },
    async updateNote(_p, _i, id) { calls.push(`updateNote:${id}`); },
    async resolveDiscussion(_p, _i, id) { calls.push(`resolve:${id}`); },
    async unresolveDiscussion(_p, _i, id) { calls.push(`unresolve:${id}`); },
    async createNote(_p, _i, _b, d) { calls.push(`reply:${d}`); return { id: 9 }; },
  };
  const memory: DispatchMemory = { identity: null, mrs: {} };
  const deps: LatchPassDeps = {
    readReviewStates: () => new Map([[MR, commented]]),
    fetchLatchMrs: async () => [facts],
    readDetail: async () => (over.detail === undefined ? detail() : over.detail),
    gateway,
    launchReReview: async (u) => { launches.push(u); return { kind: "launched" }; },
    memory, cfg, appendAudit: () => {}, notify: async () => {}, now: () => NOW,
    ...over,
  };
  return { deps, calls, launches, memory };
}

describe("step 0: no latch", () => {
  test("posts one on a comment-outcome state", async () => {
    const { deps, calls } = harness({ detail: detail() });
    const r = await runLatchPass(deps);
    expect(r.posted).toBe(1);
    expect(calls).toEqual(["upload", "createDiscussion"]);
  });

  test("posts nothing on an approve-outcome state", async () => {
    const approved: ReviewState = { ...commented, outcome: "approve" };
    const { deps, calls } = harness({
      detail: detail(), readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  // Descoped: a spent relic with no live latch is left alone. Arming a second
  // cycle is the server's job.
  test("posts nothing when a spent relic exists but no live latch", async () => {
    const { deps, calls } = harness({
      detail: detail(disc("relic", spentLatchBody(IMG), "2026-08-01T10:00:00Z", true)),
    });
    expect((await runLatchPass(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
  });

  test("ignores a done state with no outcome at all", async () => {
    const noOutcome: ReviewState = { ...commented, outcome: undefined };
    const { deps, calls } = harness({
      detail: detail(), readReviewStates: () => new Map([[MR, noOutcome]]),
    });
    expect((await runLatchPass(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe("step 1: spent latch", () => {
  test("a spent resolved latch draws no writes and never dispatches", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });

  test("a spent unresolved latch is re-resolved, never rearmed", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(["resolve:d1"]);
    expect(launches).toEqual([]);
  });

  // Revoked approval must not resurrect a spent latch.
  test("a spent latch on an unapproved MR is still left alone", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
      fetchLatchMrs: async () => [{ ...facts, isApproved: false }],
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
    expect(launches).toEqual([]);
  });
});

describe("step 2: armed and unresolved", () => {
  test("does nothing on a comment-outcome state", async () => {
    const { deps, calls } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
    });
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test("spends on an approve-outcome state, completing a missed server spend", async () => {
    const approved: ReviewState = { ...commented, outcome: "approve" };
    const { deps, calls } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(calls).toEqual(["updateNote:1", "resolve:d1"]);
  });
});

describe("step 3: armed and resolved", () => {
  test("dispatches, replies, and unresolves to rearm", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(["reply:d1", "unresolve:d1"]);
  });

  test("an approved MR spends instead of dispatching", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
      fetchLatchMrs: async () => [{ ...facts, isApproved: true }],
    });
    expect((await runLatchPass(deps)).spent).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(["updateNote:1", "resolve:d1"]);
  });

  test("a refusal replies with the reason and still unresolves", async () => {
    const memory: DispatchMemory = {
      identity: null,
      mrs: { [MR]: { ...emptyMrMemory("1970-01-12"), lastDispatchAt: NOW - 60_000 } },
    };
    const { deps, calls, launches } = harness({
      detail: detail(disc("d1", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true)),
      memory,
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toEqual(["reply:d1", "unresolve:d1"]);
  });
});

describe("idempotence across ticks", () => {
  // The write-loop the design eliminated: a spent latch must draw no writes on
  // any later tick, not merely on the tick that spent it.
  test("a second tick over an already-spent latch writes nothing", async () => {
    const spentDetail = detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", true));
    const { deps, calls } = harness({ detail: spentDetail });
    await runLatchPass(deps);
    await runLatchPass(deps);
    expect(calls).toEqual([]);
  });

  test("an approve-outcome state repairs a spent-but-unresolved latch once", async () => {
    const approved: ReviewState = { ...commented, outcome: "approve" };
    const { deps, calls } = harness({
      detail: detail(disc("d1", spentLatchBody(IMG), "2026-09-01T10:00:00Z", false)),
      readReviewStates: () => new Map([[MR, approved]]),
    });
    expect((await runLatchPass(deps)).repaired).toBe(1);
    expect(calls).toEqual(["resolve:d1"]);
  });
});

describe("dedupe", () => {
  // A spent relic must never outrank a fresh latch, or the feature silently
  // disables itself on this MR forever.
  test("a fresh latch beats a spent relic", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc("relic", spentLatchBody(IMG), "2026-08-01T10:00:00Z", true),
        disc("fresh", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true),
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toEqual(["reply:fresh", "unresolve:fresh", "updateNote:1", "resolve:relic"]
      .filter((c) => !c.startsWith("updateNote") && !c.startsWith("resolve:relic")));
  });

  // Resolving the duplicate is still asking, and the request must be consumed
  // in BOTH copies or it re-fires on every re-entry into scope.
  test("a resolved extra triggers the request and is spent by the disposal", async () => {
    const { deps, calls, launches } = harness({
      detail: detail(
        disc("canon", armedLatchBody(IMG), "2026-09-01T10:00:00Z", false),
        disc("extra", armedLatchBody(IMG), "2026-09-01T09:00:00Z", true),
      ),
    });
    expect((await runLatchPass(deps)).dispatched).toBe(1);
    expect(launches).toEqual([MR]);
    expect(calls).toContain("reply:canon");
    expect(calls).toContain("updateNote:1");
    expect(calls).toContain("resolve:extra");
  });

  // The request bit must be consumed on the refusal path too, not just on
  // dispatch. Left in the extra, it re-fires on every re-entry into scope:
  // one unrequested dispatch per cooldown expiry, forever.
  test("a refusal consumes a resolved extra, not just the canonical latch", async () => {
    const memory: DispatchMemory = {
      identity: null,
      mrs: { [MR]: { ...emptyMrMemory("1970-01-12"), lastDispatchAt: NOW - 60_000 } },
    };
    const { deps, calls, launches } = harness({
      detail: detail(
        disc("canon", armedLatchBody(IMG), "2026-09-01T10:00:00Z", true),
        disc("extra", armedLatchBody(IMG), "2026-09-01T09:00:00Z", true),
      ),
      memory,
    });
    expect((await runLatchPass(deps)).rejected).toBe(1);
    expect(launches).toEqual([]);
    expect(calls).toContain("reply:canon");
    expect(calls).toContain("unresolve:canon");
    expect(calls).toContain("resolve:extra");
  });
});
