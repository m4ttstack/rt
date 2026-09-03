import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import type { eventsEmit, eventsHead, eventsList, eventsWait, Commands } from "@mattstack/rt-client";
import { gateFilePath, writeGateState, type GateAnswers, type GateQuestion, type GateState } from "./store.ts";
import type { ReviewState } from "../review-state.ts";

/** rt-client keeps `EventsBusEvent` internal to commands.ts and re-exports
    only the `Commands` map, so this derives the element type from the
    events:wait response shape rather than importing a name that doesn't
    exist at the package boundary. */
type EventsBusEvent = Commands["events:wait"]["data"]["events"][number];

export interface GateVerbIo {
  eventsEmit: typeof eventsEmit;
  eventsWait: typeof eventsWait;
  eventsList: typeof eventsList;
  eventsHead: typeof eventsHead;
  now(): number;
}

interface GateAnsweredPayload {
  gateId: string;
  answers: GateAnswers;
  by: string;
  answeredAt: number;
}

function readReviewState(statePath: string): ReviewState {
  return JSON.parse(readFileSync(statePath, "utf8")) as ReviewState;
}

function readGateFile(path: string): GateState | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GateState;
  } catch {
    return null;
  }
}

/** Mints a UUID gateId, writes the gate file, emits the full opened-event
    contract payload, and returns the gateId. */
export async function gateOpen(statePath: string, questionsJson: string, io: GateVerbIo): Promise<string> {
  const questions = JSON.parse(questionsJson) as GateQuestion[];
  const review = readReviewState(statePath);
  const gateId = randomUUID();
  const openedAt = io.now();
  const path = gateFilePath(review.mrUrl);

  writeGateState(path, {
    gateId,
    mrUrl: review.mrUrl,
    iid: review.iid,
    kind: "review-post",
    status: "open",
    openedAt,
    questions,
    agentId: review.agentId,
    sessionId: review.sessionId,
    paneId: review.paneId,
    tabId: review.tabId,
  });

  await io.eventsEmit(`board/gate/opened/${gateId}`, {
    gateId,
    kind: "review-post",
    mrUrl: review.mrUrl,
    iid: review.iid,
    agentId: review.agentId,
    sessionId: review.sessionId,
    paneId: review.paneId,
    tabId: review.tabId,
    questions,
    openedAt,
  });

  return gateId;
}

function findAnswer(events: EventsBusEvent[], pattern: string): GateAnsweredPayload | undefined {
  const hit = events.find((e) => e.topic === pattern);
  return hit ? (hit.payload as GateAnsweredPayload) : undefined;
}

/** Journal-first: a parked resume's answer is already in the journal, so this
    checks `eventsList` before ever blocking on `eventsWait`. Returns
    immediately when the gate file already carries `answers` (idempotent
    re-entry). */
export async function gateWait(
  statePath: string,
  io: GateVerbIo,
): Promise<{ answers: GateAnswers; by: string; answeredAt: number }> {
  const review = readReviewState(statePath);
  const path = gateFilePath(review.mrUrl);
  const gate = readGateFile(path);
  if (!gate) throw new Error(`no gate file for ${review.mrUrl}`);

  if (gate.answers) {
    return { answers: gate.answers, by: gate.answeredBy ?? "unknown", answeredAt: gate.answeredAt ?? io.now() };
  }

  const pattern = `board/gate/answered/${gate.gateId}`;

  const listRes = await io.eventsList({ pattern });
  let answer = listRes.ok && listRes.data ? findAnswer(listRes.data.events, pattern) : undefined;
  let after = listRes.ok && listRes.data ? listRes.data.cursor : undefined;

  // The daemon caps a single events:wait around 240s -- loop until an answer
  // event actually arrives rather than treating a timeout as absence.
  while (!answer) {
    const waitRes = await io.eventsWait({ pattern, after });
    if (!waitRes.ok || !waitRes.data) {
      throw new Error(`events:wait failed: ${waitRes.error ?? "unknown error"}`);
    }
    after = waitRes.data.cursor;
    answer = findAnswer(waitRes.data.events, pattern);
  }

  writeGateState(path, {
    gateId: gate.gateId,
    status: "answered",
    answers: answer.answers,
    answeredBy: answer.by as GateState["answeredBy"],
    answeredAt: answer.answeredAt,
  });

  return { answers: answer.answers, by: answer.by, answeredAt: answer.answeredAt };
}

/** In-pane escape hatch: a human answered the wrapper conversationally rather
    than through the board UI. Emits the same answered-event contract so
    every other surface (a board card, a parked resume) converges on it. */
export async function gateAnswer(statePath: string, answersJson: string, by: "pane", io: GateVerbIo): Promise<void> {
  const answers = JSON.parse(answersJson) as GateAnswers;
  const review = readReviewState(statePath);
  const path = gateFilePath(review.mrUrl);
  const gate = readGateFile(path);
  if (!gate) throw new Error(`no gate file for ${review.mrUrl}`);

  const answeredAt = io.now();

  await io.eventsEmit(`board/gate/answered/${gate.gateId}`, { gateId: gate.gateId, answers, by, answeredAt });

  writeGateState(path, { gateId: gate.gateId, status: "answered", answers, answeredBy: by, answeredAt });
}
