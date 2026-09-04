import { readFileSync } from "fs";
import type { Commands, RtResponse } from "@mattstack/rt-client";
import { writeReviewState, type ReviewState } from "../review-state.ts";

export type GateAnswers = Record<string, string | string[]>;

export interface GateQuestion {
  id: string;
  label: string;
  multi: boolean;
  options: string[];
}

/** Thin seam over the three rt-client gate facility wrappers this CLI drives.
    A real `io` wires the actual `gateOpen`/`gateWait`/`gateAnswer` exports;
    tests inject fakes shaped the same way. */
export interface GateVerbIo {
  gateOpen(payload: Commands["gate:open"]["payload"]): Promise<RtResponse<Commands["gate:open"]["data"]>>;
  gateWait(payload: Commands["gate:wait"]["payload"]): Promise<RtResponse<Commands["gate:wait"]["data"]>>;
  gateAnswer(payload: Commands["gate:answer"]["payload"]): Promise<RtResponse<Commands["gate:answer"]["data"]>>;
  now(): number;
}

/** Under the shell tool's own kill timeout (120s default) with margin: a
    `gate wait` invocation must always exit on its own before the tool can
    kill it mid-block, so the wrapper only ever sees clean results. */
export const GATE_WAIT_MAX_MS = 90_000;

/** Parses `--max-ms` from a wait invocation's argv. Absent -> undefined
    (the default window applies). Present, it must carry a finite positive
    number: a NaN or non-positive window would make the deadline unreachable
    and the wait loop unbounded again. */
export function parseWaitMaxMs(argv: string[]): number | undefined {
  const eq = argv.find((a) => a.startsWith("--max-ms="));
  const present = eq !== undefined || argv.includes("--max-ms");
  if (!present) return undefined;
  const raw = eq ? eq.slice("--max-ms=".length) : argv[argv.indexOf("--max-ms") + 1];
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n) || n <= 0) {
    throw new Error("--max-ms requires a finite positive number of milliseconds");
  }
  return n;
}

function readReviewState(statePath: string): ReviewState {
  return JSON.parse(readFileSync(statePath, "utf8")) as ReviewState;
}

/** Opens the facility gate for this review's post-round questions and
    persists the returned id onto review state -- `gateWait`/`gateAnswer`
    take only the state path, never the id, so the wrapper CLI contract
    stays unchanged and re-entry after a crash just re-reads the file. Board
    panes are unattended, so no nudge is passed. */
export async function gateOpen(statePath: string, questionsJson: string, io: GateVerbIo): Promise<string> {
  const questions = JSON.parse(questionsJson) as GateQuestion[];
  const review = readReviewState(statePath);

  const res = await io.gateOpen({
    subject: `mr:${review.mrUrl}`,
    kind: "review-post",
    questions,
    meta: { label: `review gate !${review.iid}` },
  });
  if (!res.ok || !res.data) throw new Error(`gate:open failed: ${res.error ?? "unknown error"}`);

  writeReviewState(statePath, { status: review.status, gateId: res.data.id });

  return res.data.id;
}

export type GateWaitResult =
  | { status: "answered"; answers: GateAnswers; by: string; answeredAt: number }
  | { status: "pending" };

/** Registry-status-first: the facility's own `gate:wait` returns immediately
    on an already-answered/closed gate, so a re-entering wrapper (crash,
    resume) never re-blocks on a decision that already landed. A `timeout`
    re-enters the wait until `maxMs` has elapsed, then returns `pending` --
    a bounded invocation exits cleanly before the caller's shell tool can
    kill the process mid-wait, and the answer is registry state, so a
    re-run resumes exactly where this one left off. `closed` (superseded,
    abandoned, pruned) surfaces as a clean terminal error. */
export async function gateWait(
  statePath: string,
  io: GateVerbIo,
  maxMs: number = GATE_WAIT_MAX_MS,
): Promise<GateWaitResult> {
  const review = readReviewState(statePath);
  if (!review.gateId) throw new Error(`no gate open for ${review.mrUrl}`);
  const deadline = io.now() + maxMs;

  for (;;) {
    // The remaining budget rides into the facility wait itself (`waitMs`),
    // so a single long-poll can never overshoot the window -- the deadline
    // is enforced inside the poll, not just between polls.
    const remaining = deadline - io.now();
    if (remaining <= 0) return { status: "pending" };
    const res = await io.gateWait({ id: review.gateId, waitMs: remaining });
    if (!res.ok || !res.data) throw new Error(`gate:wait failed: ${res.error ?? "unknown error"}`);

    if (res.data.status === "timeout") continue;
    if (res.data.status === "closed") {
      throw new Error(`gate ${review.gateId} closed (${res.data.row.closedReason ?? "unknown reason"}) before being answered`);
    }

    const answer = res.data.row.answer;
    if (!answer) throw new Error(`gate ${review.gateId} reported answered with no answer on the row`);
    return { status: "answered", answers: answer.answers as GateAnswers, by: answer.by, answeredAt: answer.answeredAt };
  }
}

/** In-pane escape hatch: a human answered the wrapper conversationally rather
    than through the board UI. The facility's `gate:answer` is the single CAS
    arbiter, so a lost race is a defined outcome, not an error -- the
    rejection payload carries the winning row's answer and the caller (bin/
    gate.ts) proceeds on it rather than treating the loss as a failure. */
export async function gateAnswer(
  statePath: string,
  answersJson: string,
  by: "pane",
  io: GateVerbIo,
): Promise<{ conflict: boolean; answers: GateAnswers; by: string; answeredAt: number }> {
  const answers = JSON.parse(answersJson) as GateAnswers;
  const review = readReviewState(statePath);
  if (!review.gateId) throw new Error(`no gate open for ${review.mrUrl}`);

  const res = await io.gateAnswer({ id: review.gateId, answers, by });
  if (!res.ok || !res.data) throw new Error(`gate:answer failed: ${res.error ?? "unknown error"}`);

  const winner = res.data.row.answer;
  if (!winner) throw new Error(`gate ${review.gateId} answer accepted but row carries no answer`);

  return { conflict: res.data.conflict === true, answers: winner.answers as GateAnswers, by: winner.by, answeredAt: winner.answeredAt };
}
