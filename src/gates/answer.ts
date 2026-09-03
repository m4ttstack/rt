import type { eventsEmit } from "@mattstack/rt-client";
import type { GateAnswers, GateQuestion, GateState } from "./store.ts";
import { dispatchPrompt, statusBinPath, mrTabLabel, type SkillPathResolver } from "../herdr.ts";
import { resolveSkillPath } from "../skill-path.ts";
import { reviewFilePath, reviewReportPath, type ReviewState, type ReviewStatus } from "../review-state.ts";
import type { AgentLaunchResult } from "../agent-launch.ts";

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

/** Seams the real parked-gate resume needs beyond what answerGate's own io
    carries: launching into the review workspace and persisting the result to
    review state, both of which require config the pure answerGate/AnswerGateIo
    layer deliberately doesn't hold. */
export interface ResumeParkedGateIo {
  /** Resolve the domain skill the resumed wrapper should delegate to: the
      board tab's `reviewSkill` override when the gate's tabId names one,
      else the manifest/config binding -- same precedence /review's fresh
      launch and re-review paths use (reviewSkillForTab). */
  resolveLaunchSkill(mrUrl: string, tabId?: string): string;
  resumeAgentPane(opts: { agentId: string; prompt: string; workspaceLabel: string; tabLabel: string }): Promise<AgentLaunchResult>;
  writeReviewState(path: string, patch: Partial<ReviewState> & { status: ReviewStatus }): void;
  reviewsWorkspace: string;
  notify(message: string): void;
}

/**
 * The real parked-gate resume: rebuild the `/board:review` prompt with
 * `--resumed-gate <gateId>` (the flag the wrapper's re-entry rule keys on to
 * skip `gate open` and re-enter the domain skill directly) and resume the
 * pane the gate parked on, persisting the fresh pane ids to review state.
 *
 * A parked gate always carries the agentId it parked with -- ingest.ts sets
 * status: "parked" only on a gate that already opened a review pane. A
 * missing agentId means that invariant broke (or the gate file was hand
 * edited), so this degrades to a notify rather than throwing: the answer
 * itself already succeeded and must not be undone by a resume failure.
 */
export async function resumeParkedGate(
  gate: GateState,
  io: ResumeParkedGateIo,
  resolvePath: SkillPathResolver = resolveSkillPath,
): Promise<void> {
  if (!gate.agentId) {
    io.notify("parked gate answered but no agent on file; relaunch from the board");
    return;
  }

  const statePath = reviewFilePath(gate.mrUrl);
  const prompt = await dispatchPrompt(
    "board:review",
    {
      mrUrl: gate.mrUrl,
      statePath,
      statusBin: statusBinPath(),
      reportPath: reviewReportPath(statePath),
      skill: io.resolveLaunchSkill(gate.mrUrl, gate.tabId),
      resumedGate: gate.gateId,
    },
    resolvePath,
  );

  try {
    const result = await io.resumeAgentPane({
      agentId: gate.agentId,
      prompt,
      workspaceLabel: io.reviewsWorkspace,
      tabLabel: mrTabLabel(gate.iid, undefined, "↺"),
    });
    if (result.focusedExisting) return;
    io.writeReviewState(statePath, {
      status: "reviewing",
      agentId: result.agentId,
      paneId: result.paneId,
      tabId: result.tabId,
      workspaceId: result.workspaceId,
    });
  } catch (err) {
    console.error(`parked gate resume failed: ${err instanceof Error ? err.message : err}`);
  }
}
