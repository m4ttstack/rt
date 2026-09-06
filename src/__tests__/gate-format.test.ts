import { describe, test, expect } from "bun:test";
import {
  gateAnswerPayload,
  parseConflictResponse,
  unwrapGateAnswer,
  formatGateOption,
  gateFocusDomain,
  optionValue,
  optionDisplayFor,
  displayForValue,
} from "../client/board/gate-format.ts";
import type { GateQuestion } from "../gates/store.ts";

const GATE_ID = "gate-1";

const QUESTIONS: GateQuestion[] = [
  { id: "tiers", label: "Which tiers?", multi: true, options: ["nit", "must-fix"] },
  { id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] },
];

test("gateAnswerPayload shapes a multi answer to an array and a single answer to a string", () => {
  const payload = gateAnswerPayload(
    { gateId: GATE_ID, questions: QUESTIONS },
    { tiers: ["must-fix"], outcome: "approve" },
  );
  expect(payload).toEqual({ gateId: GATE_ID, answers: { tiers: ["must-fix"], outcome: "approve" } });
});

test("gateAnswerPayload refuses when a multi question's selection is missing", () => {
  const payload = gateAnswerPayload({ gateId: GATE_ID, questions: QUESTIONS }, { outcome: "approve" });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a multi question's selection is an empty array", () => {
  const payload = gateAnswerPayload({ gateId: GATE_ID, questions: QUESTIONS }, { tiers: [], outcome: "approve" });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a single question's selection is missing", () => {
  const payload = gateAnswerPayload({ gateId: GATE_ID, questions: QUESTIONS }, { tiers: ["nit"] });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a single question's selection is an empty string", () => {
  const payload = gateAnswerPayload({ gateId: GATE_ID, questions: QUESTIONS }, { tiers: ["nit"], outcome: "" });
  expect(payload).toBeNull();
});

test("gateAnswerPayload drops selections for questions the gate doesn't have", () => {
  const payload = gateAnswerPayload(
    { gateId: GATE_ID, questions: QUESTIONS },
    { tiers: ["nit"], outcome: "comment", bogus: "ignored" },
  );
  expect(payload).toEqual({ gateId: GATE_ID, answers: { tiers: ["nit"], outcome: "comment" } });
});

test("gateAnswerPayload with no questions on the gate always succeeds with empty answers", () => {
  const payload = gateAnswerPayload({ gateId: GATE_ID, questions: [] }, {});
  expect(payload).toEqual({ gateId: GATE_ID, answers: {} });
});

test("gateAnswerPayload is not blocked by a zero-option question -- a clean review with no severity levels stays answerable via outcome alone", () => {
  const questions: GateQuestion[] = [
    { id: "tiers", label: "Post which findings?", multi: true, options: [] },
    { id: "outcome", label: "Verdict", multi: false, options: ["comment", "approve"] },
  ];
  const payload = gateAnswerPayload({ gateId: GATE_ID, questions }, { outcome: "approve" });
  expect(payload).toEqual({ gateId: GATE_ID, answers: { outcome: "approve" } });
});

test("unwrapGateAnswer passes a bare string through unchanged", () => {
  expect(unwrapGateAnswer("approve")).toEqual({ value: "approve" });
});

test("unwrapGateAnswer passes a bare array through unchanged", () => {
  expect(unwrapGateAnswer(["critical", "nit"])).toEqual({ value: ["critical", "nit"] });
});

test("unwrapGateAnswer unwraps the {value, note} object form", () => {
  expect(unwrapGateAnswer({ value: "comment", note: "approve once CI is green" })).toEqual({
    value: "comment",
    note: "approve once CI is green",
  });
});

test("unwrapGateAnswer unwraps an array value inside the object form, with no note", () => {
  expect(unwrapGateAnswer({ value: ["critical"] })).toEqual({ value: ["critical"] });
});

test("parseConflictResponse extracts the winning row's answers and by from a 409 body", () => {
  const body = { ok: false, conflict: true, row: { answer: { answers: { outcome: "approve" }, by: "board" } } };
  expect(parseConflictResponse(body)).toEqual({ answers: { outcome: "approve" }, by: "board" });
});

test("parseConflictResponse tolerates a missing or malformed row without throwing", () => {
  expect(parseConflictResponse(null)).toEqual({ answers: {}, by: "" });
  expect(parseConflictResponse({})).toEqual({ answers: {}, by: "" });
  expect(parseConflictResponse({ row: {} })).toEqual({ answers: {}, by: "" });
});

describe("formatGateOption", () => {
  test("compacts a verb:longtoken option, carrying the full string as title", () => {
    expect(formatGateOption("fix:7080da2fcf93c1a2")).toEqual({ text: "fix · 7080da2f", title: "fix:7080da2fcf93c1a2" });
    expect(formatGateOption("reply:a1b2c3d4e5f60718")).toEqual({ text: "reply · a1b2c3d4", title: "reply:a1b2c3d4e5f60718" });
  });

  test("leaves a bare word untouched, no title", () => {
    expect(formatGateOption("approve")).toEqual({ text: "approve" });
    expect(formatGateOption("comment")).toEqual({ text: "comment" });
  });

  test("leaves a verb:value pair untouched when the value is under 12 characters", () => {
    expect(formatGateOption("skip:abc")).toEqual({ text: "skip:abc" });
    expect(formatGateOption("resolve-addressed")).toEqual({ text: "resolve-addressed" });
  });

  test("gateAnswerPayload still carries the verbatim option string, never the display form", () => {
    const questions: GateQuestion[] = [{ id: "threads-1", label: "t", multi: true, options: ["fix:7080da2fcf93c1a2"] }];
    const payload = gateAnswerPayload({ gateId: GATE_ID, questions }, { "threads-1": ["fix:7080da2fcf93c1a2"] });
    expect(payload).toEqual({ gateId: GATE_ID, answers: { "threads-1": ["fix:7080da2fcf93c1a2"] } });
  });
});

describe("gateFocusDomain", () => {
  test("resolves the gate kind's domain when that domain's own state carries a tabId", () => {
    expect(gateFocusDomain("respond-plan", { respond: { tabId: "w1:t2" } })).toBe("respond");
    expect(gateFocusDomain("review-post", { review: { tabId: "w1:t1" } })).toBe("review");
    expect(gateFocusDomain("doctor-escalation", { doctor: { tabId: "w1:t3" } })).toBe("doctor");
  });

  test("returns null when the domain's own state has no tabId", () => {
    expect(gateFocusDomain("respond-plan", { respond: {} })).toBeNull();
    expect(gateFocusDomain("respond-plan", {})).toBeNull();
  });

  test("never offers a different domain's live tabId", () => {
    expect(gateFocusDomain("respond-plan", { review: { tabId: "w1:t1" } })).toBeNull();
  });

  test("returns null for an unrecognized kind", () => {
    expect(gateFocusDomain("mystery-kind", { review: { tabId: "w1:t1" } })).toBeNull();
  });
});

describe("labeled options (W4)", () => {
  test("optionValue returns the string or the object's value", () => {
    expect(optionValue("approve")).toBe("approve");
    expect(optionValue({ value: "Major", label: "Major (2)" })).toBe("Major");
  });

  test("optionDisplayFor renders label with the value as hover title", () => {
    expect(optionDisplayFor({ value: "fix:7080da2fcf93c1a2", label: "fix · api.ts:42" }))
      .toEqual({ text: "fix · api.ts:42", title: "fix:7080da2fcf93c1a2" });
  });

  test("optionDisplayFor keeps the verb-token transform for bare strings", () => {
    expect(optionDisplayFor("fix:7080da2fcf93c1a2")).toEqual({ text: "fix · 7080da2f", title: "fix:7080da2fcf93c1a2" });
    expect(optionDisplayFor("approve")).toEqual({ text: "approve" });
  });

  test("displayForValue maps an answered value back to its option's label", () => {
    const options = [{ value: "Major", label: "Major (2)" }, "approve"];
    expect(displayForValue("Major", options)).toEqual({ text: "Major (2)", title: "Major" });
    expect(displayForValue("gone", options)).toEqual({ text: "gone" });
  });
});
