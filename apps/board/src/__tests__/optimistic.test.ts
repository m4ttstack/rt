import { test, expect } from "bun:test";
import { EMPTY_OPTIMISTIC, setQueued, rollback, clearServerTruth, anyActive, overlay } from "../client/board/optimistic.ts";
import type { BoardMRWithReview } from "../client/types.ts";

const mr = (webUrl: string, extra: Partial<BoardMRWithReview> = {}) =>
  ({ webUrl, iid: 1, author: { username: "m" }, ...extra }) as BoardMRWithReview;

test("setQueued marks one axis/url queued without touching others", () => {
  const s = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  expect(s.review["u1"]).toEqual({ status: "queued" });
  expect(s.respond).toEqual({});
});

test("rollback removes exactly that entry", () => {
  let s = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  s = setQueued(s, "review", "u2");
  s = rollback(s, "review", "u1");
  expect(Object.keys(s.review)).toEqual(["u2"]);
});

test("clearServerTruth drops an optimistic entry once the server reports that axis, and returns the same reference when nothing changed", () => {
  let s = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  const cleared = clearServerTruth(s, [mr("u1", { review: { status: "reviewing" } })]);
  expect(cleared.review["u1"]).toBeUndefined();
  const untouched = clearServerTruth(cleared, [mr("u1", { review: { status: "reviewing" } })]);
  expect(untouched).toBe(cleared);
  // a server respond does NOT clear an optimistic review
  const s2 = setQueued(EMPTY_OPTIMISTIC, "review", "u1");
  expect(clearServerTruth(s2, [mr("u1", { respond: { status: "triaging" } })]).review["u1"]).toBeDefined();
});

test("anyActive: optimistic queued counts; server done does not; server triaging does", () => {
  expect(anyActive(setQueued(EMPTY_OPTIMISTIC, "doctor", "u"), [])).toBe(true);
  expect(anyActive(EMPTY_OPTIMISTIC, [mr("u", { review: { status: "done" } })])).toBe(false);
  expect(anyActive(EMPTY_OPTIMISTIC, [mr("u", { respond: { status: "triaging" } })])).toBe(true);
  expect(anyActive(EMPTY_OPTIMISTIC, [mr("u", { doctor: { status: "watching" } })])).toBe(true);
});

test("overlay: server state wins over optimistic; optimistic fills gaps only", () => {
  const s = setQueued(setQueued(EMPTY_OPTIMISTIC, "review", "u1"), "respond", "u1");
  const [out] = overlay([mr("u1", { review: { status: "error" } })], s);
  expect(out!.review).toEqual({ status: "error" });      // server wins
  expect(out!.respond).toEqual({ status: "queued" });     // optimistic fills
});
