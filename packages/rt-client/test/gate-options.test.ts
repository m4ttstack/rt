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
  test("a partial object with only value fills label from value", () => {
    expect(normalizeGateOptions([{ value: "a" } as unknown as GateQuestion["options"][number]])).toEqual([
      { value: "a", label: "a" },
    ]);
  });
  test("a partial object with only label fills value from label", () => {
    expect(normalizeGateOptions([{ label: "x" } as unknown as GateQuestion["options"][number]])).toEqual([
      { value: "x", label: "x" },
    ]);
  });
  test("wire garbage (null, a number, an object with neither field) is coerced via String() into both fields", () => {
    expect(
      normalizeGateOptions([null, 42, {}] as unknown as GateQuestion["options"]),
    ).toEqual([
      { value: "null", label: "null" },
      { value: "42", label: "42" },
      { value: "[object Object]", label: "[object Object]" },
    ]);
  });
  test("the return type is honest: every entry is a full {value,label} pair, for any input shape", () => {
    const wireGarbage = ["ok", { value: "a" }, { label: "x" }, null, 42, {}, undefined, [1, 2]] as unknown as GateQuestion["options"];
    for (const entry of normalizeGateOptions(wireGarbage)) {
      expect(typeof entry.value).toBe("string");
      expect(typeof entry.label).toBe("string");
    }
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
