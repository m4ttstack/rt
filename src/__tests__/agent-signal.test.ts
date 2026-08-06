import { describe, expect, test } from "bun:test";
import { signalEmoji, isSignalKind } from "../agent-signal.ts";

describe("signalEmoji", () => {
  test("a review that has started gets the looking eyes", () => {
    expect(signalEmoji("review", "reviewing")).toBe("eyes");
  });

  test("a review that landed as a comment gets the comment reaction", () => {
    expect(signalEmoji("review", "done", "comment")).toBe("comment");
  });

  test("a review that landed as an approval gets the check", () => {
    expect(signalEmoji("review", "done", "approve")).toBe("white_check_mark");
  });

  test("done without an outcome signals nothing -- the human never answered the gate", () => {
    expect(signalEmoji("review", "done")).toBeNull();
    expect(signalEmoji("review", "done", "")).toBeNull();
  });

  test("an unknown outcome signals nothing rather than guessing", () => {
    expect(signalEmoji("review", "done", "approved")).toBeNull();
  });

  test("queued and error signal nothing", () => {
    expect(signalEmoji("review", "queued")).toBeNull();
    expect(signalEmoji("review", "error")).toBeNull();
  });

  test("respond and doctor have no policy yet", () => {
    expect(signalEmoji("respond", "drafting")).toBeNull();
    expect(signalEmoji("respond", "done")).toBeNull();
    expect(signalEmoji("doctor", "watching")).toBeNull();
    expect(signalEmoji("doctor", "done")).toBeNull();
  });
});

describe("isSignalKind", () => {
  test("accepts the three launch kinds", () => {
    expect(isSignalKind("review")).toBe(true);
    expect(isSignalKind("respond")).toBe(true);
    expect(isSignalKind("doctor")).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isSignalKind("reviews")).toBe(false);
    expect(isSignalKind("")).toBe(false);
    expect(isSignalKind(undefined)).toBe(false);
    expect(isSignalKind(3)).toBe(false);
  });
});
