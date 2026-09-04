import type { Commands, GateRow, RtResponse } from "@mattstack/rt-client";
import type { GateAnswers, GateState } from "./store.ts";
import { dispatchPrompt, statusBinPath, mrTabLabel, type SkillPathResolver } from "../herdr.ts";
import { resolveSkillPath } from "../skill-path.ts";
import { reviewFilePath, reviewReportPath, type ReviewState, type ReviewStatus } from "../review-state.ts";
import type { AgentLaunchResult } from "../agent-launch.ts";

/** Board-UI answer path: proxies the facility's `gate:answer` (the single
    CAS arbiter) rather than owning any state itself, so the HTTP handler in
    server.ts stays a thin status-mapping shell and this is unit-testable
    without touching the real gate cache or a live daemon. */
export interface AnswerGateIo {
  /** The board's gate cache maps `mr:<mrUrl>` subjects to facility rows;
      `gate:answer` takes an id, not a subject, so this resolves it -- and
      only for a row still `open`/`parked`, since anything else (missing,
      already answered, closed) has nothing left to answer here. */
  findAnswerableGateId(mrUrl: string): string | undefined;
  gateAnswer(payload: Commands["gate:answer"]["payload"]): Promise<RtResponse<Commands["gate:answer"]["data"]>>;
}

export type AnswerGateResult =
  | { kind: "ok" }
  | { kind: "conflict"; row: GateRow }
  | { kind: "not-found" }
  | { kind: "invalid"; reason: string };

/** Distinguishes the daemon's "nothing there to answer" rejections from
    validation/strict-membership ones -- the former maps to 404, the latter
    to 400 with the message surfaced verbatim. */
function isMissingGateError(message: string): boolean {
  return /not[- ]found|closed/i.test(message);
}

/**
 * Answers a gate through the facility CAS: resolves the id from the board's
 * cache, calls `gateAnswer`, and maps the outcome. A CAS loss is `ok:true`
 * with `conflict:true` and the winning row -- not an error, since the
 * facility already recorded a real answer, just not this caller's. The
 * daemon emits `gate/answered` itself on a genuine write, so there is
 * nothing left for this path to emit or persist.
 */
export async function answerGate(mrUrl: string, answers: GateAnswers, io: AnswerGateIo): Promise<AnswerGateResult> {
  const gateId = io.findAnswerableGateId(mrUrl);
  if (!gateId) return { kind: "not-found" };

  const res = await io.gateAnswer({ id: gateId, answers, by: "board" });
  if (!res.ok || !res.data) {
    const message = res.error ?? "gate:answer failed with no error detail";
    return isMissingGateError(message) ? { kind: "not-found" } : { kind: "invalid", reason: message };
  }

  return res.data.conflict ? { kind: "conflict", row: res.data.row } : { kind: "ok" };
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
