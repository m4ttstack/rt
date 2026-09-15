import type { GateOption, GateQuestion } from "./commands.ts";

/** The canonical stored/emitted option shape (contract C11). GateOption
    (the input union) is unchanged; rows normalized by the daemon always
    satisfy this. */
export interface GateOptionObject {
  value: string;
  label: string;
}

/** Bare string s becomes {value: s, label: s}; objects pass through
    untouched. Pure and order-preserving. */
export function normalizeGateOptions(options: GateOption[]): GateOptionObject[] {
  return options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

export function normalizeGateQuestions(questions: GateQuestion[]): GateQuestion[] {
  return questions.map((q) => ({ ...q, options: normalizeGateOptions(q.options) }));
}
