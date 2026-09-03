import { test, expect } from "bun:test";
import { gateAnswerPayload } from "../client/board/gate-format.ts";
import type { GateQuestion } from "../gates/store.ts";

const MR_URL = "https://gitlab.com/acme/webapp/-/merge_requests/4821";

const QUESTIONS: GateQuestion[] = [
  { id: "tiers", label: "Which tiers?", multi: true, options: ["nit", "must-fix"] },
  { id: "outcome", label: "Outcome?", multi: false, options: ["comment", "approve"] },
];

test("gateAnswerPayload shapes a multi answer to an array and a single answer to a string", () => {
  const payload = gateAnswerPayload(
    { mrUrl: MR_URL, questions: QUESTIONS },
    { tiers: ["must-fix"], outcome: "approve" },
  );
  expect(payload).toEqual({ mrUrl: MR_URL, answers: { tiers: ["must-fix"], outcome: "approve" } });
});

test("gateAnswerPayload refuses when a multi question's selection is missing", () => {
  const payload = gateAnswerPayload({ mrUrl: MR_URL, questions: QUESTIONS }, { outcome: "approve" });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a multi question's selection is an empty array", () => {
  const payload = gateAnswerPayload({ mrUrl: MR_URL, questions: QUESTIONS }, { tiers: [], outcome: "approve" });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a single question's selection is missing", () => {
  const payload = gateAnswerPayload({ mrUrl: MR_URL, questions: QUESTIONS }, { tiers: ["nit"] });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a single question's selection is an empty string", () => {
  const payload = gateAnswerPayload({ mrUrl: MR_URL, questions: QUESTIONS }, { tiers: ["nit"], outcome: "" });
  expect(payload).toBeNull();
});

test("gateAnswerPayload drops selections for questions the gate doesn't have", () => {
  const payload = gateAnswerPayload(
    { mrUrl: MR_URL, questions: QUESTIONS },
    { tiers: ["nit"], outcome: "comment", bogus: "ignored" },
  );
  expect(payload).toEqual({ mrUrl: MR_URL, answers: { tiers: ["nit"], outcome: "comment" } });
});

test("gateAnswerPayload with no questions on the gate always succeeds with empty answers", () => {
  const payload = gateAnswerPayload({ mrUrl: MR_URL, questions: [] }, {});
  expect(payload).toEqual({ mrUrl: MR_URL, answers: {} });
});

test("gateAnswerPayload is not blocked by a zero-option question -- a clean review with no severity levels stays answerable via outcome alone", () => {
  const questions: GateQuestion[] = [
    { id: "tiers", label: "Post which findings?", multi: true, options: [] },
    { id: "outcome", label: "Verdict", multi: false, options: ["comment", "approve"] },
  ];
  const payload = gateAnswerPayload({ mrUrl: MR_URL, questions }, { outcome: "approve" });
  expect(payload).toEqual({ mrUrl: MR_URL, answers: { outcome: "approve" } });
});
