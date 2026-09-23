import type { GateQuestion, GateAnswer } from "./commands.ts";
import { gateOptionValue } from "./gate-options.ts";

export type GateAnswerWire = GateAnswer["answers"][string];

/** Both wire shapes carry the same value underneath: bare, or {value,
    note?, text?} when a panel attaches free text or a replacement for text
    the gate offered. Validation reads only the value. */
export function unwrapGateAnswerValue(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in (raw as Record<string, unknown>)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function wrapperFieldError(qid: string, raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("value" in (raw as Record<string, unknown>))) {
    return null;
  }
  const { note, text } = raw as Record<string, unknown>;
  if (note !== undefined && typeof note !== "string") return `question ${qid} note must be a string`;
  if (text !== undefined && typeof text !== "string") return `question ${qid} text must be a string`;
  if (typeof text === "string" && text.trim() === "") return `question ${qid} text must not be empty`;
  return null;
}

/** Option membership is required whenever a question declares options,
    checked against the unwrapped value (every element, for multi); an
    empty options array stays free-form. Every question id must appear as
    an answers key. Error strings are a wire contract; packages/rt-client/test/gate-answers.test.ts pins them verbatim. */
export function validateGateAnswers(
  questions: GateQuestion[],
  answers: Record<string, unknown>,
): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [qid, raw] of Object.entries(answers)) {
    const question = byId.get(qid);
    if (!question) return `unknown question id: ${qid}`;
    const wrapperError = wrapperFieldError(qid, raw);
    if (wrapperError) return wrapperError;
    const value = unwrapGateAnswerValue(raw);
    const isArray = Array.isArray(value);
    if (question.multi && !isArray) return `question ${qid} expects an array (multi)`;
    if (!question.multi && isArray) return `question ${qid} expects a single value`;
    const values = isArray ? (value as unknown[]) : [value];
    if (!values.every((v) => typeof v === "string")) return `question ${qid} value must be a string`;
    if (question.options.length > 0) {
      const members = question.options.map(gateOptionValue);
      for (const v of values as string[]) {
        if (!members.includes(v)) return `answer for "${qid}" is not one of its options: "${v}"`;
      }
    }
  }
  const missing = questions
    .map((q) => q.id)
    .filter((id) => !Object.prototype.hasOwnProperty.call(answers, id));
  if (missing.length > 0) return `missing answer(s) for: ${missing.join(", ")}`;
  return null;
}
