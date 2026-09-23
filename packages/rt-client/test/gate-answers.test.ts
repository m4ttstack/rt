import { describe, expect, test } from "bun:test";
import { unwrapGateAnswerValue, validateGateAnswers } from "../src/gate-answers.ts";
import type { GateQuestion } from "../src/commands.ts";

const single: GateQuestion = { id: "verdict", label: "v", multi: false, options: ["yes", { value: "no", label: "No" }] };
const multi: GateQuestion = { id: "tiers", label: "t", multi: true, options: ["a", "b"] };
const freeform: GateQuestion = { id: "note", label: "n", multi: false, options: [] };

describe("unwrapGateAnswerValue", () => {
  test("bare values pass through", () => expect(unwrapGateAnswerValue("yes")).toBe("yes"));
  test("note form unwraps", () => expect(unwrapGateAnswerValue({ value: "yes", note: "x" })).toBe("yes"));
  test("arrays pass through", () => expect(unwrapGateAnswerValue(["a"])).toEqual(["a"]));
  test("text form unwraps", () => expect(unwrapGateAnswerValue({ value: ["a"], text: "x" })).toEqual(["a"]));
});

describe("validateGateAnswers", () => {
  test("valid single + multi + freeform", () => {
    expect(validateGateAnswers([single, multi, freeform], { verdict: "no", tiers: ["a"], note: "anything" })).toBeNull();
  });
  test("unknown question id", () => {
    expect(validateGateAnswers([single], { verdict: "yes", extra: "x" })).toBe("unknown question id: extra");
  });
  test("multi expects array", () => {
    expect(validateGateAnswers([multi], { tiers: "a" })).toBe("question tiers expects an array (multi)");
  });
  test("single rejects array", () => {
    expect(validateGateAnswers([single], { verdict: ["yes"] })).toBe("question verdict expects a single value");
  });
  test("non-string element", () => {
    expect(validateGateAnswers([multi], { tiers: [1] })).toBe("question tiers value must be a string");
  });
  test("membership by value, labels never match", () => {
    expect(validateGateAnswers([single], { verdict: "No" })).toBe('answer for "verdict" is not one of its options: "No"');
  });
  test("empty options = free-form", () => {
    expect(validateGateAnswers([freeform], { note: "whatever" })).toBeNull();
  });
  test("missing answers named", () => {
    expect(validateGateAnswers([single, multi], { verdict: "yes" })).toBe("missing answer(s) for: tiers");
  });
  test("explicit empty multi array is valid", () => {
    expect(validateGateAnswers([multi], { tiers: [] })).toBeNull();
  });
  test("note-form values validate by inner value", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: "hold on" } })).toBeNull();
  });
  test("text-form values validate by inner value", () => {
    expect(validateGateAnswers([multi], { tiers: { value: ["a"], text: "edited reply" } })).toBeNull();
  });
  test("text rides beside a note", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: "n", text: "t" } })).toBeNull();
  });
  test("non-string text", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", text: 5 } })).toBe("question verdict text must be a string");
  });
  test("whitespace-only text is empty", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", text: "  \n" } })).toBe("question verdict text must not be empty");
  });
  test("wrapper field errors win over value errors", () => {
    expect(validateGateAnswers([single], { verdict: { value: "bogus", text: " " } })).toBe("question verdict text must not be empty");
  });
  test("note is checked before text", () => {
    expect(validateGateAnswers([single], { verdict: { value: "yes", note: 5, text: 5 } })).toBe("question verdict note must be a string");
  });
});
