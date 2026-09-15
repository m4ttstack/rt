import type { GateQuestion } from "./commands.ts";

export const GATE_FORM_OPTION_CAP = 4;

/** The ONE presentation rule (spec Phase 1): form iff an injectable pane
    exists, a nudge target exists, and every question fits the native form's
    per-question option cap. */
export function gatePresentation(args: {
  paneId?: string | undefined;
  sessionId?: string | undefined;
  questions: GateQuestion[];
}): "form" | "wait" {
  if (!args.paneId || !args.sessionId) return "wait";
  return args.questions.every((q) => q.options.length <= GATE_FORM_OPTION_CAP)
    ? "form"
    : "wait";
}
