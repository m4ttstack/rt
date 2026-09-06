import { describe, expect, test } from "bun:test";
import {
  canonicalUsername, makeEnvelope, parseDraftEnvelope, parseEnvelope,
  parseReviewStatePayload, parseReReviewRequestPayload, parseNudgeOutcomePayload,
} from "../peer/envelope.ts";

describe("canonicalUsername", () => {
  test("trims and lowercases", () => {
    expect(canonicalUsername("  M4ttheweric ")).toBe("m4ttheweric");
  });
});

describe("makeEnvelope", () => {
  test("stamps id, canonical to, sentAt", () => {
    const d = makeEnvelope("Grace", "review-state", { a: 1 }, 123);
    expect(d.to).toBe("grace");
    expect(d.sentAt).toBe(123);
    expect(d.type).toBe("review-state");
    expect(d.id.length).toBeGreaterThan(10);
    expect(d.payload).toEqual({ a: 1 });
  });
});

describe("parseDraftEnvelope", () => {
  const good = { id: "abc", to: "grace", type: "review-state", sentAt: 1, payload: {} };
  test("accepts a valid draft and canonicalizes to", () => {
    expect(parseDraftEnvelope({ ...good, to: " Grace " })?.to).toBe("grace");
  });
  test("accepts broadcast to *", () => {
    expect(parseDraftEnvelope({ ...good, to: "*" })?.to).toBe("*");
  });
  for (const key of ["id", "to", "type", "sentAt", "payload"] as const) {
    test(`rejects missing ${key}`, () => {
      const bad: Record<string, unknown> = { ...good };
      delete bad[key];
      expect(parseDraftEnvelope(bad)).toBeNull();
    });
  }
  test("rejects non-object", () => {
    expect(parseDraftEnvelope("nope")).toBeNull();
  });
});

describe("parseEnvelope", () => {
  test("requires from and receivedAt on top of draft fields", () => {
    const draft = { id: "abc", to: "grace", type: "t", sentAt: 1, payload: {} };
    expect(parseEnvelope(draft)).toBeNull();
    expect(parseEnvelope({ ...draft, from: "ada", receivedAt: 2 })?.from).toBe("ada");
  });
});

describe("payload parsers", () => {
  test("review-state requires mrUrl, iid, status, updatedAt", () => {
    expect(parseReviewStatePayload({ mrUrl: "u", iid: 1, status: "done", outcome: "comment", updatedAt: 5 }))
      .toEqual({ mrUrl: "u", iid: 1, status: "done", outcome: "comment", updatedAt: 5 });
    expect(parseReviewStatePayload({ mrUrl: "u", iid: 1, status: "done" })).toBeNull();
  });
  test("re-review-request requires mrUrl and iid, note optional", () => {
    expect(parseReReviewRequestPayload({ mrUrl: "u", iid: 1 })).toEqual({ mrUrl: "u", iid: 1, note: undefined });
    expect(parseReReviewRequestPayload({ iid: 1 })).toBeNull();
  });
  test("nudge-outcome requires known result", () => {
    expect(parseNudgeOutcomePayload({ mrUrl: "u", iid: 1, nudgeId: "n", result: "launched" })?.result).toBe("launched");
    expect(parseNudgeOutcomePayload({ mrUrl: "u", iid: 1, nudgeId: "n", result: "meh" })).toBeNull();
  });
});
