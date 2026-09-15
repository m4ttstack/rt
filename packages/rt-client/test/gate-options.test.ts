import { describe, expect, test } from "bun:test";
import { normalizeGateOptions, normalizeGateQuestions } from "../src/gate-options.ts";
import type { GateQuestion } from "../src/commands.ts";

describe("normalizeGateOptions", () => {
  test("bare string becomes {value, label} with both set to the string", () => {
    expect(normalizeGateOptions(["yes", "no"])).toEqual([
      { value: "yes", label: "yes" },
      { value: "no", label: "no" },
    ]);
  });
  test("objects pass through untouched", () => {
    expect(normalizeGateOptions([{ value: "a", label: "A (Recommended)" }])).toEqual([
      { value: "a", label: "A (Recommended)" },
    ]);
  });
  test("mixed input preserves order", () => {
    expect(normalizeGateOptions([{ value: "a", label: "A" }, "b"])).toEqual([
      { value: "a", label: "A" },
      { value: "b", label: "b" },
    ]);
  });
  test("empty options stay empty (free-form question)", () => {
    expect(normalizeGateOptions([])).toEqual([]);
  });
});

describe("normalizeGateQuestions", () => {
  test("normalizes every question's options and keeps other fields verbatim", () => {
    const qs: GateQuestion[] = [
      { id: "q1", label: "pick", multi: false, options: ["x"] },
      { id: "q2", label: "tiers", multi: true, options: [{ value: "t1", label: "Tier 1" }] },
    ];
    expect(normalizeGateQuestions(qs)).toEqual([
      { id: "q1", label: "pick", multi: false, options: [{ value: "x", label: "x" }] },
      { id: "q2", label: "tiers", multi: true, options: [{ value: "t1", label: "Tier 1" }] },
    ]);
  });
  test("does not mutate its input", () => {
    const qs: GateQuestion[] = [{ id: "q1", label: "p", multi: false, options: ["x"] }];
    normalizeGateQuestions(qs);
    expect(qs[0]!.options).toEqual(["x"]);
  });
});
