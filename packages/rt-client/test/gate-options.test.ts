import { describe, expect, test } from "bun:test";
import { normalizeGateOptions, normalizeGateQuestions } from "../src/gate-options.ts";
import type { GateQuestion } from "../src/commands.ts";

describe("normalizeGateOptions", () => {
  test("bare string becomes {value, label} with the label capitalized (word-like)", () => {
    expect(normalizeGateOptions(["yes", "no"])).toEqual([
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
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
      { value: "b", label: "B" },
    ]);
  });
  test("empty options stay empty (free-form question)", () => {
    expect(normalizeGateOptions([])).toEqual([]);
  });
  test("a partial object with only value fills label from value (capitalized)", () => {
    expect(normalizeGateOptions([{ value: "a" } as unknown as GateQuestion["options"][number]])).toEqual([
      { value: "a", label: "A" },
    ]);
  });
  test("a partial object with only label fills value from label (label capitalized, value unchanged)", () => {
    expect(normalizeGateOptions([{ label: "x" } as unknown as GateQuestion["options"][number]])).toEqual([
      { value: "x", label: "X" },
    ]);
  });
  test("wire garbage (null, a number, an object with neither field) is coerced via String() into both fields", () => {
    expect(
      normalizeGateOptions([null, 42, {}] as unknown as GateQuestion["options"]),
    ).toEqual([
      { value: "null", label: "Null" },
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

  describe("recommended flag lifts into the label suffix", () => {
    test("recommended: true appends ' (Recommended)' to the label", () => {
      expect(normalizeGateOptions([{ value: "a", label: "fix", recommended: true }])).toEqual([
        { value: "a", label: "Fix (Recommended)" },
      ]);
    });
    test("the recommended field does not survive into the normalized output object", () => {
      const [out] = normalizeGateOptions([{ value: "a", label: "fix", recommended: true }]);
      expect(Object.keys(out!)).toEqual(["value", "label"]);
    });
    test("recommended: false or absent never appends the suffix", () => {
      expect(normalizeGateOptions([{ value: "a", label: "fix", recommended: false }, { value: "b", label: "skip" }])).toEqual([
        { value: "a", label: "Fix" },
        { value: "b", label: "Skip" },
      ]);
    });
    test("a label already ending with the suffix (case-insensitively) is not appended twice", () => {
      expect(
        normalizeGateOptions([{ value: "a", label: "Fix (recommended)", recommended: true }]),
      ).toEqual([{ value: "a", label: "Fix (recommended)" }]);
    });
    test("an empty label with recommended: true stays empty, not just the suffix", () => {
      expect(normalizeGateOptions([{ value: "a", label: "", recommended: true }])).toEqual([
        { value: "a", label: "" },
      ]);
    });
  });

  describe("option description", () => {
    test("an object option's description is preserved verbatim", () => {
      expect(normalizeGateOptions([{ value: "a", label: "fix", description: "patch the null check" }])).toEqual([
        { value: "a", label: "Fix", description: "patch the null check" },
      ]);
    });
    test("a description is never capitalized or suffixed, even with recommended: true", () => {
      expect(normalizeGateOptions([{ value: "a", label: "fix", recommended: true, description: "lowercase stays. no suffix" }])).toEqual([
        { value: "a", label: "Fix (Recommended)", description: "lowercase stays. no suffix" },
      ]);
    });
    test("an option without a description has no description key", () => {
      const [bare, obj] = normalizeGateOptions(["yes", { value: "a", label: "A" }]);
      expect(Object.keys(bare!)).toEqual(["value", "label"]);
      expect(Object.keys(obj!)).toEqual(["value", "label"]);
    });
    test("a non-string description is dropped rather than coerced", () => {
      const [out] = normalizeGateOptions([{ value: "a", label: "A", description: 42 } as unknown as GateQuestion["options"][number]]);
      expect(out).toEqual({ value: "a", label: "A" });
    });
    test("an empty description is dropped", () => {
      expect(normalizeGateOptions([{ value: "a", label: "A", description: "" }])).toEqual([{ value: "a", label: "A" }]);
    });
  });

  describe("word-like label capitalization", () => {
    test("an all-lowercase single word is capitalized", () => {
      expect(normalizeGateOptions(["main"])).toEqual([{ value: "main", label: "Main" }]);
    });
    test("bare string 'fix' becomes {value:'fix', label:'Fix'} with the value unchanged", () => {
      expect(normalizeGateOptions(["fix"])).toEqual([{ value: "fix", label: "Fix" }]);
    });
    test("bare string 'skip' becomes {value:'skip', label:'Skip'} with the value unchanged", () => {
      expect(normalizeGateOptions(["skip"])).toEqual([{ value: "skip", label: "Skip" }]);
    });
    test("a label containing a digit is left untouched", () => {
      expect(normalizeGateOptions(["rt-165"])).toEqual([{ value: "rt-165", label: "rt-165" }]);
    });
    test("a label containing a slash is left untouched", () => {
      expect(normalizeGateOptions(["src/lib/foo.ts"])).toEqual([{ value: "src/lib/foo.ts", label: "src/lib/foo.ts" }]);
    });
    test("a label containing a colon and a digit is left untouched", () => {
      expect(normalizeGateOptions(["reply:42"])).toEqual([{ value: "reply:42", label: "reply:42" }]);
    });
    test("an already mixed-case label is left untouched", () => {
      expect(normalizeGateOptions(["gitLab"])).toEqual([{ value: "gitLab", label: "gitLab" }]);
    });
  });
});

describe("normalizeGateQuestions", () => {
  test("normalizes every question's options and keeps other fields verbatim", () => {
    const qs: GateQuestion[] = [
      { id: "q1", label: "pick", multi: false, options: ["x"] },
      { id: "q2", label: "tiers", multi: true, options: [{ value: "t1", label: "Tier 1" }] },
    ];
    expect(normalizeGateQuestions(qs)).toEqual([
      { id: "q1", label: "pick", multi: false, options: [{ value: "x", label: "X" }] },
      { id: "q2", label: "tiers", multi: true, options: [{ value: "t1", label: "Tier 1" }] },
    ]);
  });
  test("does not mutate its input", () => {
    const qs: GateQuestion[] = [{ id: "q1", label: "p", multi: false, options: ["x"] }];
    normalizeGateQuestions(qs);
    expect(qs[0]!.options).toEqual(["x"]);
  });
});
