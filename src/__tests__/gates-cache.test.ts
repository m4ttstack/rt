import { describe, expect, test } from "bun:test";
import { GateCache } from "../gates/cache.ts";
import type { GateRow as FacilityGateRow } from "@mattstack/rt-client";
import { attachGates } from "../gates/cache.ts";

const SUBJECT_A = "mr:https://gitlab.com/acme/webapp/-/merge_requests/4821";
const SUBJECT_B = "mr:https://gitlab.com/acme/webapp/-/merge_requests/1";

function row(overrides: Partial<FacilityGateRow> = {}): FacilityGateRow {
  return {
    id: "gate-1",
    subject: SUBJECT_A,
    kind: "review-post",
    questions: [{ id: "q1", label: "Ship it?", multi: false, options: ["yes", "no"] }],
    meta: null,
    status: "open",
    answer: null,
    openedAt: 1000,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    ...overrides,
  };
}

describe("GateCache.applyRow / reconcile", () => {
  test("applyRow sets a row, retrievable by subject", () => {
    const cache = new GateCache();
    cache.applyRow(row());
    expect(cache.get(SUBJECT_A)?.id).toBe("gate-1");
  });

  test("reconcile replaces matching subjects and leaves others alone", () => {
    const cache = new GateCache();
    cache.applyRow(row({ subject: SUBJECT_A, status: "open" }));
    cache.applyRow(row({ subject: SUBJECT_B, id: "gate-2", status: "parked" }));

    cache.reconcile([row({ subject: SUBJECT_A, status: "answered", answer: { answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 } })]);

    expect(cache.get(SUBJECT_A)?.status).toBe("answered");
    // SUBJECT_B wasn't in the reconcile list -- untouched.
    expect(cache.get(SUBJECT_B)?.status).toBe("parked");
  });
});

describe("GateCache.applyEvent", () => {
  test("opened frame creates a fresh row from full context", () => {
    const cache = new GateCache();
    cache.applyEvent({
      topic: "gate/opened/gate-9",
      payload: {
        id: "gate-9",
        subject: SUBJECT_A,
        kind: "review-post",
        questions: [{ id: "q1", label: "Ship it?", multi: false, options: ["yes", "no"] }],
        meta: { label: "review gate !4821" },
        openedAt: 5000,
      },
    });
    const cached = cache.get(SUBJECT_A);
    expect(cached?.id).toBe("gate-9");
    expect(cached?.status).toBe("open");
    expect(cached?.openedAt).toBe(5000);
    expect(cached?.questions).toEqual([{ id: "q1", label: "Ship it?", multi: false, options: ["yes", "no"] }]);
  });

  test("opened frame for an already-cached subject replaces it wholesale (re-review)", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "answered", answer: { answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 } }));

    cache.applyEvent({
      topic: "gate/opened/gate-2",
      payload: { id: "gate-2", subject: SUBJECT_A, kind: "review-post", questions: [], meta: null, openedAt: 9000 },
    });

    const cached = cache.get(SUBJECT_A);
    expect(cached?.id).toBe("gate-2");
    expect(cached?.status).toBe("open");
    expect(cached?.answer).toBeNull();
  });

  test("answered frame (full context) patches an existing row by id", () => {
    const cache = new GateCache();
    cache.applyRow(row());

    cache.applyEvent({
      topic: "gate/answered/gate-1",
      payload: { id: "gate-1", subject: SUBJECT_A, kind: "review-post", answers: { q1: "yes" }, by: "pane", paneId: "pane-1" },
    });

    const cached = cache.get(SUBJECT_A);
    expect(cached?.status).toBe("answered");
    expect(cached?.answer?.answers).toEqual({ q1: "yes" });
    expect(cached?.answer?.by).toBe("pane");
  });

  test.each(["parked", "closed", "released"] as const)("%s frame (thin) patches an existing row by id", (kind) => {
    const cache = new GateCache();
    cache.applyRow(row());

    cache.applyEvent({
      topic: `gate/${kind}/gate-1`,
      payload: { id: "gate-1", subject: SUBJECT_A, kind: "review-post" },
    });

    const cached = cache.get(SUBJECT_A)!;
    if (kind === "parked") expect(cached.status).toBe("parked");
    if (kind === "closed") expect(cached.status).toBe("closed");
    if (kind === "released") expect(cached.released).toBe(true);
  });

  test.each(["answered", "parked", "closed", "released"] as const)(
    "%s frame for an unknown id is dropped silently, no throw, no phantom entry",
    (kind) => {
      const cache = new GateCache();
      expect(() =>
        cache.applyEvent({ topic: `gate/${kind}/ghost`, payload: { id: "ghost", subject: SUBJECT_A, kind: "review-post" } }),
      ).not.toThrow();
      expect(cache.get(SUBJECT_A)).toBeUndefined();
      expect(cache.rows()).toEqual([]);
    },
  );

  test("a non-gate topic is ignored", () => {
    const cache = new GateCache();
    expect(() => cache.applyEvent({ topic: "board/other/thing", payload: {} })).not.toThrow();
    expect(cache.rows()).toEqual([]);
  });

  test("a malformed payload is tolerated without throwing", () => {
    const cache = new GateCache();
    expect(() => cache.applyEvent({ topic: "gate/opened/gate-1", payload: "not an object" })).not.toThrow();
    expect(() => cache.applyEvent({ topic: "gate/opened/gate-1", payload: null })).not.toThrow();
    expect(cache.rows()).toEqual([]);
  });
});

describe("attachGates", () => {
  test("an open row renders as the open affordance", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "open" }));
    const [mr] = attachGates([{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821" }], cache);
    expect(mr!.gate).toEqual({
      gateId: "gate-1",
      status: "open",
      openedAt: 1000,
      questions: [{ id: "q1", label: "Ship it?", multi: false, options: ["yes", "no"] }],
      answers: undefined,
    });
  });

  test("a parked row renders as the parked affordance", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "parked" }));
    const [mr] = attachGates([{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821" }], cache);
    expect(mr!.gate?.status).toBe("parked");
  });

  test("an answered row renders while the MR's review state is non-terminal", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "answered", answer: { answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 } }));
    const [mr] = attachGates(
      [{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821", review: { status: "reviewing" as const } }],
      cache,
    );
    expect(mr!.gate?.status).toBe("answered");
    expect(mr!.gate?.answers).toEqual({ q1: "yes" });
  });

  test("an answered row does NOT render once review state is done (never keyed on released)", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "answered", released: false, answer: { answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 } }));
    const [mr] = attachGates(
      [{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821", review: { status: "done" as const } }],
      cache,
    );
    expect(mr!.gate).toBeNull();
  });

  test("an answered row does NOT render once review state is error", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "answered", answer: { answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 } }));
    const [mr] = attachGates(
      [{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821", review: { status: "error" as const } }],
      cache,
    );
    expect(mr!.gate).toBeNull();
  });

  test("an answered row with no review state at all still renders (non-terminal by default)", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "answered", answer: { answers: { q1: "yes" }, by: "board-ui", answeredAt: 2000 } }));
    const [mr] = attachGates([{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821" }], cache);
    expect(mr!.gate?.status).toBe("answered");
  });

  test("a closed row never renders", () => {
    const cache = new GateCache();
    cache.applyRow(row({ status: "closed", closedAt: 3000, closedReason: "abandoned" }));
    const [mr] = attachGates([{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/4821" }], cache);
    expect(mr!.gate).toBeNull();
  });

  test("an MR with no cached gate gets gate: null", () => {
    const cache = new GateCache();
    const [mr] = attachGates([{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/9999" }], cache);
    expect(mr!.gate).toBeNull();
  });

  test("an MR with no webUrl gets gate: null without throwing", () => {
    const cache = new GateCache();
    const [mr] = attachGates([{ webUrl: null }], cache);
    expect(mr!.gate).toBeNull();
  });

  test("empty cache renders no gates for any MR (nothing fed yet)", () => {
    const cache = new GateCache();
    const mrs = attachGates(
      [{ webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/1" }, { webUrl: "https://gitlab.com/acme/webapp/-/merge_requests/2" }],
      cache,
    );
    expect(mrs.every((m) => m.gate === null)).toBe(true);
  });
});
