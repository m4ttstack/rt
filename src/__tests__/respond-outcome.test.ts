import { describe, expect, test } from "bun:test";
import { respondOutcome, respondDoneLabel, respondNeedsAttention } from "../respond-outcome.ts";

describe("respondOutcome", () => {
  test("every thread answered is posted", () => {
    expect(respondOutcome(3, 3)).toBe("posted");
    expect(respondOutcome(1, 1)).toBe("posted");
  });

  test("nothing posted against real threads is drafted", () => {
    expect(respondOutcome(0, 3)).toBe("drafted");
  });

  test("some but not all is partial", () => {
    expect(respondOutcome(2, 3)).toBe("partial");
    expect(respondOutcome(1, 9)).toBe("partial");
  });

  test("no threads at all is none, not drafted", () => {
    expect(respondOutcome(0, 0)).toBe("none");
  });

  test("a miscounted numerator clamps to posted rather than exceeding the total", () => {
    expect(respondOutcome(4, 3)).toBe("posted");
  });

  test("either count absent is unknown, so the badge never claims what it was not told", () => {
    expect(respondOutcome(undefined, undefined)).toBe("unknown");
    expect(respondOutcome(2, undefined)).toBe("unknown");
    expect(respondOutcome(undefined, 3)).toBe("unknown");
  });

  test("counts that are not non-negative integers are unknown", () => {
    expect(respondOutcome(-1, 3)).toBe("unknown");
    expect(respondOutcome(1.5, 3)).toBe("unknown");
    expect(respondOutcome(2, -3)).toBe("unknown");
    expect(respondOutcome(Number.NaN, 3)).toBe("unknown");
  });
});

describe("respondDoneLabel", () => {
  test("names what actually happened", () => {
    expect(respondDoneLabel(3, 3)).toBe("replies posted");
    expect(respondDoneLabel(0, 3)).toBe("replies drafted, not posted");
    expect(respondDoneLabel(0, 0)).toBe("no threads to answer");
  });

  test("partial carries the count", () => {
    expect(respondDoneLabel(2, 3)).toBe("2 of 3 posted");
  });

  test("clamps the numerator it prints", () => {
    expect(respondDoneLabel(4, 3)).toBe("replies posted");
  });

  test("falls back to a claim-free label when counts are missing", () => {
    expect(respondDoneLabel(undefined, undefined)).toBe("responded");
  });
});

describe("respondNeedsAttention", () => {
  test("true only where replies are still sitting unposted", () => {
    expect(respondNeedsAttention("partial")).toBe(true);
    expect(respondNeedsAttention("drafted")).toBe(true);
    expect(respondNeedsAttention("posted")).toBe(false);
    expect(respondNeedsAttention("none")).toBe(false);
    expect(respondNeedsAttention("unknown")).toBe(false);
  });
});
