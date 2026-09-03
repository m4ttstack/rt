import type { eventsEmit } from "@mattstack/rt-client";
import type { GateAnswers, GateQuestion, GateState } from "./store.ts";

/** Board-UI answer path: mirrors `gateAnswer` in verbs.ts (the pane escape
    hatch) but as a pure orchestrator over injected io, so the HTTP handler
    in server.ts stays a thin status-mapping shell and this is unit-testable
    without touching the real gate store or events bus. */
export interface AnswerGateIo {
  readGateStates(): Map<string, GateState>;
  writeGateState(path: string, patch: Partial<GateState> & { gateId: string }): void;
  gateFilePath(mrUrl: string): string;
  eventsEmit: typeof eventsEmit;
  sseNudge(): void;
  resumeParkedGate(gate: GateState): void | Promise<void>;
  now(): number;
}

export type AnswerGateResult =
  | { kind: "ok" }
  | { kind: "not-found" }
  | { kind: "already-answered" }
  | { kind: "invalid"; reason: string };

/** Every answered question id must exist on the gate, and its value shape
    must match the question's `multi` flag (array of strings vs. a single
    string) -- a mismatch here would otherwise write a gate file no consumer
    (pane resume, board row) can trust to match its own `questions`. */
function validateAnswers(questions: GateQuestion[], answers: GateAnswers): string | null {
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const [id, value] of Object.entries(answers)) {
    const question = byId.get(id);
    if (!question) return `unknown question id "${id}"`;
    if (question.multi) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return `question "${id}" is multi-select; expected an array of strings`;
      }
    } else if (typeof value !== "string") {
      return `question "${id}" is single-select; expected a string`;
    }
  }
  return null;
}

/**
 * Validates and applies a board-UI answer to a gate: emits the answered
 * event, merges the gate file to `status: "answered"`, and nudges SSE
 * clients. When the gate was `parked`, also invokes `resumeParkedGate` --
 * a parked gate has no pane waiting on `gateWait`, so answering it must
 * itself kick the resume rather than rely on the wrapper polling back in.
 */
export async function answerGate(mrUrl: string, answers: GateAnswers, io: AnswerGateIo): Promise<AnswerGateResult> {
  const gate = io.readGateStates().get(mrUrl);
  if (!gate) return { kind: "not-found" };
  if (gate.status === "answered") return { kind: "already-answered" };

  const invalidReason = validateAnswers(gate.questions, answers);
  if (invalidReason) return { kind: "invalid", reason: invalidReason };

  const wasParked = gate.status === "parked";
  const answeredAt = io.now();

  await io.eventsEmit(`board/gate/answered/${gate.gateId}`, {
    gateId: gate.gateId,
    answers,
    by: "board-ui",
    answeredAt,
  });

  io.writeGateState(io.gateFilePath(mrUrl), {
    gateId: gate.gateId,
    status: "answered",
    answers,
    answeredBy: "board-ui",
    answeredAt,
  });

  io.sseNudge();

  if (wasParked) {
    await io.resumeParkedGate(gate);
  }

  return { kind: "ok" };
}

/** Task 19 fills in the real parked-gate resume (re-launching or resuming
    the pane that parked). Task 13 lands this stub as the default
    `resumeParkedGate` hook so `/gate/answer` has somewhere to call; replace
    this function's body in place rather than rewiring the call site. */
export function resumeParkedGateStub(gate: GateState): void {
  console.log(`resumeParkedGate stub: gate ${gate.gateId} (${gate.mrUrl}) was parked; resume not yet implemented`);
}
