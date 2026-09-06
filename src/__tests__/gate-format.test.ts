import { describe, test, expect } from "bun:test";
import {
  gateAnswerPayload,
  parseConflictResponse,
  unwrapGateAnswer,
  formatGateOption,
  optionValue,
  optionDisplayFor,
  displayForValue,
  codeChangesHidden,
  groupThreadOptions,
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
} from "../client/board/gate-format.ts";
import type { GateOption, GateQuestion } from "../gates/store.ts";

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

describe("respond collapse (W4)", () => {
  const questions = [
    { id: "threads-1", label: "Threads", multi: true, options: ["reply:t1", "fix:t1", "skip:t1"] },
    { id: "code-changes", label: "Approve the proposed code changes?", multi: false, options: ["approve", "revise", "skip"] },
  ];

  test("hidden until a fix: value is selected", () => {
    expect(codeChangesHidden("respond-plan", questions, {})).toBe(true);
    expect(codeChangesHidden("respond-plan", questions, { "threads-1": ["reply:t1"] })).toBe(true);
    expect(codeChangesHidden("respond-plan", questions, { "threads-1": ["fix:t1"] })).toBe(false);
  });

  test("never hidden off respond-plan, without the question, or without the sentinel option", () => {
    expect(codeChangesHidden("review-post", questions, {})).toBe(false);
    expect(codeChangesHidden("respond-plan", [questions[0]!], {})).toBe(false);
    const noSentinel = [questions[0]!, { ...questions[1]!, options: ["approve", "revise"] }];
    expect(codeChangesHidden("respond-plan", noSentinel, {})).toBe(false);
  });

  test("a hidden question submits the sentinel through gateAnswerPayload", () => {
    const selections = { "threads-1": ["reply:t1"] };
    // Same derivation GateCard uses: only merge the sentinel once
    // codeChangesHidden says the question is actually hidden.
    const hidden = codeChangesHidden("respond-plan", questions, selections);
    const effective = hidden ? { ...selections, [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL } : selections;
    const payload = gateAnswerPayload({ gateId: "g1", questions }, effective);
    expect(hidden).toBe(true);
    expect(payload).toEqual({ gateId: "g1", answers: { "threads-1": ["reply:t1"], "code-changes": CODE_CHANGES_SENTINEL } });
  });
});

describe("groupThreadOptions (per-thread grouping)", () => {
  test("groups bare reply/fix/skip options by token, ordering verbs reply/fix/skip regardless of input order", () => {
    const options: GateOption[] = ["skip:t1", "fix:t1", "reply:t1", "fix:t2", "skip:t2", "reply:t2"];
    const groups = groupThreadOptions(options);
    expect(groups).toEqual([
      {
        token: "t1",
        heading: "t1",
        entries: [
          { verb: "reply", value: "reply:t1", option: "reply:t1" },
          { verb: "fix", value: "fix:t1", option: "fix:t1" },
          { verb: "skip", value: "skip:t1", option: "skip:t1" },
        ],
      },
      {
        token: "t2",
        heading: "t2",
        entries: [
          { verb: "reply", value: "reply:t2", option: "reply:t2" },
          { verb: "fix", value: "fix:t2", option: "fix:t2" },
          { verb: "skip", value: "skip:t2", option: "skip:t2" },
        ],
      },
    ]);
  });

  test("derives the heading from a labeled option's 'verb · <thread text>' suffix", () => {
    const options: GateOption[] = [
      { value: "reply:7080da2fcf93c1a2", label: "reply · api.ts:42" },
      { value: "fix:7080da2fcf93c1a2", label: "fix · api.ts:42" },
      { value: "skip:7080da2fcf93c1a2", label: "skip · api.ts:42" },
      { value: "reply:a1b2c3d4e5f60718", label: "reply · README.md:3" },
      { value: "fix:a1b2c3d4e5f60718", label: "fix · README.md:3" },
      { value: "skip:a1b2c3d4e5f60718", label: "skip · README.md:3" },
    ];
    const groups = groupThreadOptions(options);
    expect(groups?.map((g) => g.heading)).toEqual(["api.ts:42", "README.md:3"]);
  });

  test("returns null for a single thread -- 2+ distinct tokens are required", () => {
    expect(groupThreadOptions(["reply:t1", "fix:t1", "skip:t1"])).toBeNull();
  });

  test("returns null when any option doesn't parse as reply/fix/skip:<token>", () => {
    const options: GateOption[] = ["reply:t1", "fix:t1", "approve"];
    expect(groupThreadOptions(options)).toBeNull();
  });

  test("returns null when one token is missing a verb, even if every token is missing the same one", () => {
    // t1 has all three; t2 is missing skip -- a partial group must not render.
    expect(groupThreadOptions(["reply:t1", "fix:t1", "skip:t1", "reply:t2", "fix:t2"])).toBeNull();
    // Both tokens consistently missing skip is still incomplete, not a smaller valid set.
    expect(groupThreadOptions(["reply:t1", "fix:t1", "reply:t2", "fix:t2"])).toBeNull();
  });

  test("returns null when a token has a duplicated verb instead of the missing one", () => {
    // t1: reply, fix, fix -- three options, but only two distinct verbs (skip missing, fix doubled).
    const options: GateOption[] = ["reply:t1", "fix:t1", "fix:t1", "reply:t2", "fix:t2", "skip:t2"];
    expect(groupThreadOptions(options)).toBeNull();
  });

  test("returns null for an unrelated verb, like a tiers or outcome question", () => {
    expect(groupThreadOptions(["nit", "must-fix"])).toBeNull();
    expect(groupThreadOptions(["comment", "approve"])).toBeNull();
  });

  test("round-trips: submitted values are still the exact option strings, one per thread", () => {
    const questions: GateQuestion[] = [
      { id: "threads-1", label: "Threads", multi: true, options: ["reply:t1", "fix:t1", "skip:t1", "reply:t2", "fix:t2", "skip:t2"] },
    ];
    const payload = gateAnswerPayload({ gateId: GATE_ID, questions }, { "threads-1": ["fix:t1", "skip:t2"] });
    expect(payload).toEqual({ gateId: GATE_ID, answers: { "threads-1": ["fix:t1", "skip:t2"] } });
  });
});
