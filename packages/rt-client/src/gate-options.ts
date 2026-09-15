import type { GateOption, GateQuestion } from "./commands.ts";

/** The canonical stored/emitted option shape (contract C11). GateOption
    (the input union) is unchanged; rows normalized by the daemon always
    satisfy this. */
export interface GateOptionObject {
  value: string;
  label: string;
}

/** Bare string s becomes {value: s, label: s}; a well-formed {value,label}
    object passes through untouched. Total over whatever actually arrives
    on the wire, not just the declared GateOption union: a partial object
    fills the missing field from the one present, and anything else
    (null, a number, an object with neither field) is coerced via String()
    into both fields. Every returned entry is a full {value,label} pair --
    callers may trust the return type without re-checking it. Pure and
    order-preserving. */
export function normalizeGateOptions(options: GateOption[]): GateOptionObject[] {
  return options.map((o) => {
    if (typeof o === "string") return { value: o, label: o };
    if (o !== null && typeof o === "object") {
      const value = typeof (o as { value?: unknown }).value === "string" ? (o as { value: string }).value : undefined;
      const label = typeof (o as { label?: unknown }).label === "string" ? (o as { label: string }).label : undefined;
      if (value !== undefined && label !== undefined) return { value, label };
      if (value !== undefined) return { value, label: value };
      if (label !== undefined) return { value: label, label };
    }
    return { value: String(o), label: String(o) };
  });
}

export function normalizeGateQuestions(questions: GateQuestion[]): GateQuestion[] {
  return questions.map((q) => ({ ...q, options: normalizeGateOptions(q.options) }));
}
