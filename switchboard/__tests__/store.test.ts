import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { SwitchboardStore, ENVELOPE_TTL_MS } from "../store.ts";
import type { DraftEnvelope } from "../../src/peer/envelope.ts";

function makeStore(): SwitchboardStore {
  return new SwitchboardStore(new Database(":memory:"));
}
function draft(id: string, to: string): DraftEnvelope {
  return { id, to, type: "review-state", sentAt: 1, payload: { k: id } };
}

describe("boards", () => {
  test("register mints a token that auths back to the canonical username", () => {
    const s = makeStore();
    const { token } = s.registerBoard(" Grace ");
    expect(s.authBoard(token)).toBe("grace");
    expect(s.authBoard("wrong")).toBeNull();
  });
  test("re-register rotates: old token dies, new token works", () => {
    const s = makeStore();
    const first = s.registerBoard("ada").token;
    const second = s.registerBoard("ada").token;
    expect(s.authBoard(first)).toBeNull();
    expect(s.authBoard(second)).toBe("ada");
  });
});

describe("publish/inbox/ack", () => {
  test("addressed publish lands only in the recipient inbox, stamped from+receivedAt", () => {
    const s = makeStore();
    s.registerBoard("ada");
    s.registerBoard("grace");
    const r = s.publish("ada", draft("e1", "grace"), 500);
    expect(r).toEqual({ ok: true, delivered: 1 });
    const inbox = s.inbox("grace");
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.from).toBe("ada");
    expect(inbox[0]!.receivedAt).toBe(500);
    expect(s.inbox("ada").length).toBe(0);
  });
  test("unknown recipient is rejected", () => {
    const s = makeStore();
    s.registerBoard("ada");
    expect(s.publish("ada", draft("e1", "nobody"), 1)).toEqual({ ok: false, error: "unknown-recipient" });
  });
  test("broadcast fans out to everyone except the sender", () => {
    const s = makeStore();
    for (const u of ["ada", "grace", "linus"]) s.registerBoard(u);
    const r = s.publish("ada", draft("e1", "*"), 1);
    expect(r).toEqual({ ok: true, delivered: 2 });
    expect(s.inbox("grace").length).toBe(1);
    expect(s.inbox("ada").length).toBe(0);
  });
  test("duplicate id for the same recipient is idempotent (at-least-once upstream)", () => {
    const s = makeStore();
    s.registerBoard("ada");
    s.registerBoard("grace");
    s.publish("ada", draft("e1", "grace"), 1);
    s.publish("ada", draft("e1", "grace"), 2);
    expect(s.inbox("grace").length).toBe(1);
  });
  test("ack deletes only the named ids for that recipient", () => {
    const s = makeStore();
    s.registerBoard("ada");
    s.registerBoard("grace");
    s.publish("ada", draft("e1", "grace"), 1);
    s.publish("ada", draft("e2", "grace"), 2);
    expect(s.ack("grace", ["e1"])).toBe(1);
    expect(s.inbox("grace").map((e) => e.id)).toEqual(["e2"]);
  });
  test("inbox is oldest first by receivedAt", () => {
    const s = makeStore();
    s.registerBoard("ada");
    s.registerBoard("grace");
    s.publish("ada", draft("e2", "grace"), 200);
    s.publish("ada", draft("e1", "grace"), 100);
    expect(s.inbox("grace").map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});

describe("prune", () => {
  test("drops envelopes older than the ttl", () => {
    const s = makeStore();
    s.registerBoard("ada");
    s.registerBoard("grace");
    s.publish("ada", draft("old", "grace"), 0);
    s.publish("ada", draft("new", "grace"), ENVELOPE_TTL_MS);
    expect(s.prune(ENVELOPE_TTL_MS + 1)).toBe(1);
    expect(s.inbox("grace").map((e) => e.id)).toEqual(["new"]);
  });
});
