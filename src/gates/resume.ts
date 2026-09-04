import type { GateRow as FacilityGateRow } from "@mattstack/rt-client";
import type { GateQuestion, GateState } from "./store.ts";
import { dispatchPrompt, statusBinPath, mrTabLabel, type SkillPathResolver } from "../herdr.ts";
import { resolveSkillPath } from "../skill-path.ts";
import { reviewFilePath, reviewReportPath, type ReviewState, type ReviewStatus } from "../review-state.ts";
import type { AgentLaunchResult } from "../agent-launch.ts";
import type { GateEventFrame } from "./ingest.ts";

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

// ── Event-driven trigger: any surface's answer resumes the parked gate ────

type GateListPayload = { subjectPrefix: string; cursor?: number };
type GateListResult = { ok: boolean; data?: { gates: FacilityGateRow[]; cursor: number }; error?: string };

/** Seams `handleAnsweredEvent`/`bootResumePass` need beyond `resumeParkedGate`'s
    own io: reading the (already cache-updated) facility row and the tracked
    review state, and paging the facility's gate list for the boot pass. */
export interface GateResumeEventIo extends ResumeParkedGateIo {
  /** The board's gate cache, keyed by `mr:<mrUrl>` subject -- read AFTER the
      triggering frame has already been applied to it. */
  gateRow(subject: string): FacilityGateRow | undefined;
  readReviewState(mrUrl: string): ReviewState | undefined;
  gateList(payload: GateListPayload): Promise<GateListResult>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Kinds this board can resume a wrapper for. `review-post` is the only one
    W2 wires; every other kind (present or future) throws rather than being
    silently skipped -- a resume this board can't perform must never look
    like one that didn't need to happen. */
const RESUMABLE_KIND = "review-post";

/**
 * One answered-and-parked row, resumed by kind -- shared by the live event
 * path and the boot catch-up pass. Skips a row that was never parked (an
 * `open` gate answered directly never sets `parkedAt`, and it survives the
 * `answered` patch -- see GateCache.applyEvent) or one already resumed
 * (the `resumedGateId` dedup marker). Re-reads the review state after the
 * resume attempt so the dedup write can't clobber whatever status
 * `resumeParkedGate` itself just settled on.
 */
async function resumeIfMissed(row: FacilityGateRow, io: GateResumeEventIo, resolvePath: SkillPathResolver): Promise<void> {
  if (row.status !== "answered" || row.parkedAt === null) return;
  if (!row.subject.startsWith("mr:")) return;
  const mrUrl = row.subject.slice("mr:".length);

  const review = io.readReviewState(mrUrl);
  if (!review || review.resumedGateId === row.id) return;

  if (row.kind !== RESUMABLE_KIND) {
    throw new Error(`${row.kind} resume not wired until W3`);
  }

  const gate: GateState = {
    gateId: row.id,
    mrUrl,
    iid: review.iid,
    kind: "review-post",
    status: "answered",
    openedAt: row.openedAt,
    questions: row.questions as GateQuestion[],
    agentId: review.agentId,
    tabId: review.tabId,
  };
  await resumeParkedGate(gate, io, resolvePath);

  const fresh = io.readReviewState(mrUrl) ?? review;
  io.writeReviewState(reviewFilePath(mrUrl), { status: fresh.status, resumedGateId: row.id });
}

/**
 * Live path: fed one `gate/**` bus frame after the cache has already applied
 * it (server.ts's relay handler). Only a `gate/answered/<id>` frame for an
 * `mr:` subject can trigger a resume; anything else is a silent no-op so
 * this can sit directly in the relay callback without its own topic filter.
 */
export async function handleAnsweredEvent(
  frame: GateEventFrame,
  io: GateResumeEventIo,
  resolvePath: SkillPathResolver = resolveSkillPath,
): Promise<void> {
  if (!frame.topic.startsWith("gate/answered/")) return;
  if (!isRecord(frame.payload)) return;
  const { id, subject } = frame.payload;
  if (typeof id !== "string" || !id) return;
  if (typeof subject !== "string" || !subject.startsWith("mr:")) return;

  const row = io.gateRow(subject);
  if (!row || row.id !== id) return;
  await resumeIfMissed(row, io, resolvePath);
}

/**
 * Boot catch-up: pages `gateList({subjectPrefix: "mr:"})` to exhaustion
 * (mirrors reconcileGatesOnBoot's paging in ingest.ts) and resumes any
 * answered-parked gate the board missed the live event for while it was
 * down. Independent of the gate cache -- reads the facility directly, so
 * it needs no ordering relative to the cache's own boot reconcile.
 */
export async function bootResumePass(
  io: GateResumeEventIo,
  resolvePath: SkillPathResolver = resolveSkillPath,
): Promise<void> {
  let cursor: number | undefined;
  for (;;) {
    const res = await io.gateList({ subjectPrefix: "mr:", cursor });
    if (!res.ok || !res.data) {
      console.error(`gate boot resume pass: gate:list failed: ${res.error ?? "unknown error"}`);
      break;
    }
    for (const row of res.data.gates) await resumeIfMissed(row, io, resolvePath);
    if (!res.data.cursor) break;
    cursor = res.data.cursor;
  }
}
