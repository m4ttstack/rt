import type { Database } from 'bun:sqlite';

import type { Commands, RtResponse } from '@mattstack/rt-client';
import { boardRootFromStatePath } from '../agent-status/emit.ts';
import { writeDoctorState, type DoctorStatus } from '../doctor-state.ts';
import { writeRespondState, type RespondStatus } from '../respond-state.ts';
import { writeReviewState, type ReviewStatus } from '../review-state.ts';
import { dbPathForRoot, openStateDb, readByHandle } from '../state/index.ts';
import { domainForKind } from './sweep.ts';

export type GateAnswers = Record<string, string | string[]>;

export interface GateQuestion {
  id: string;
  label: string;
  multi: boolean;
  options: Array<string | { value: string; label: string }>;
}

/** Thin seam over the three rt-client gate facility wrappers this CLI drives.
    A real `io` wires the actual `gateOpen`/`gateWait`/`gateAnswer` exports;
    tests inject fakes shaped the same way. */
export interface GateVerbIo {
  gateOpen(
    payload: Commands['gate:open']['payload']
  ): Promise<RtResponse<Commands['gate:open']['data']>>;
  gateWait(
    payload: Commands['gate:wait']['payload']
  ): Promise<RtResponse<Commands['gate:wait']['data']>>;
  gateAnswer(
    payload: Commands['gate:answer']['payload']
  ): Promise<RtResponse<Commands['gate:answer']['data']>>;
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
  const eq = argv.find(a => a.startsWith('--max-ms='));
  const present = eq !== undefined || argv.includes('--max-ms');
  if (!present) return undefined;
  const raw = eq
    ? eq.slice('--max-ms='.length)
    : argv[argv.indexOf('--max-ms') + 1];
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n) || n <= 0) {
    throw new Error(
      '--max-ms requires a finite positive number of milliseconds'
    );
  }
  return n;
}

/** The fields every wrapper's state file shares (review/respond/doctor),
    all this module ever needs regardless of which one `<state>` names --
    `gate open`/`wait`/`answer` are one CLI shared by all three wrappers. */
interface GateVerbState {
  mrUrl: string;
  iid: number;
  status: string;
  gateId?: string;
  paneId?: string;
  tabId?: string;
}

/** Every gate verb resolves its db the same way the status CLIs do: from the
    handle itself, so a gate CLI invocation works no matter which board's
    root it was launched under -- there is no ambient default to fall back
    on. */
function openDbForHandle(statePath: string): Database {
  return openStateDb(dbPathForRoot(boardRootFromStatePath(statePath)), 'cli');
}

function readGateVerbState(statePath: string, db: Database): GateVerbState {
  const row = readByHandle(statePath, db) as GateVerbState | null;
  if (!row) {
    throw new Error(
      `no state row for ${statePath}; was this pane launched by a board on this machine?`
    );
  }
  return row;
}

export const FORM_OPTION_CAP = 4;
const CONTEXT_CAP_BYTES = 8192;
export type GatePresentation = 'form' | 'wait';
export interface GateOpenResult {
  gateId: string;
  presentation: GatePresentation;
}

/** The opener picks presentation: the native form tool caps options per
    question, so any question over the cap cannot render as a form and the
    gate takes the idle-wait path instead. */
export function presentationFor(questions: GateQuestion[]): GatePresentation {
  return questions.some(q => q.options.length > FORM_OPTION_CAP)
    ? 'wait'
    : 'form';
}

/** Opens the facility gate for one wrapper round and persists the returned
    id (and the kind it was opened with) onto that wrapper's own state file --
    `gateWait`/`gateAnswer` take only the state path, never the id, so the
    wrapper CLI contract stays unchanged and re-entry after a crash just
    re-reads the file. `kind` picks both the `meta.label` prefix and which
    domain's typed writer merges the patch back in, via the same kind→domain
    map sweep.ts uses -- an unrecognized kind fails loudly rather than
    guessing a writer that would silently drop that domain's own fields on
    merge. The nudge only fires for a form presentation with a session id:
    a wait-presented gate has no attended pane to ping, and an unattended
    pane (no session id) has nowhere for the nudge to land. */
export async function gateOpen(
  statePath: string,
  kind: string,
  questionsJson: string,
  io: GateVerbIo,
  extras: { context?: string; sessionId?: string; worktree?: string } = {}
): Promise<GateOpenResult> {
  const questions = JSON.parse(questionsJson) as GateQuestion[];
  const db = openDbForHandle(statePath);
  const state = readGateVerbState(statePath, db);
  const domain = domainForKind(kind);
  if (!domain) throw new Error(`gate open: unrecognized kind "${kind}"`);

  let context = extras.context;
  if (
    context !== undefined &&
    Buffer.byteLength(context, 'utf8') > CONTEXT_CAP_BYTES
  ) {
    console.error(
      `gate open: context exceeds ${CONTEXT_CAP_BYTES} bytes; opening without context`
    );
    context = undefined;
  }

  const presentation = presentationFor(questions);
  const origin: NonNullable<Commands['gate:open']['payload']['origin']> = {
    presentation,
  };
  if (state.paneId) origin.paneId = state.paneId;
  if (state.tabId) origin.tabId = state.tabId;
  if (extras.worktree) origin.worktree = extras.worktree;

  const payload: Commands['gate:open']['payload'] = {
    subject: `mr:${state.mrUrl}`,
    kind,
    questions,
    meta: { label: `${domain} gate !${state.iid}` },
    origin,
  };
  if (state.paneId) payload.pane = state.paneId;
  if (context !== undefined) payload.context = context;
  if (presentation === 'form' && extras.sessionId)
    payload.nudge = { session: extras.sessionId };

  const res = await io.gateOpen(payload);
  if (!res.ok || !res.data)
    throw new Error(`gate:open failed: ${res.error ?? 'unknown error'}`);

  if (domain === 'review') {
    writeReviewState(
      statePath,
      {
        status: state.status as ReviewStatus,
        gateId: res.data.id,
        gateKind: kind,
      },
      Date.now(),
      db
    );
  } else if (domain === 'respond') {
    writeRespondState(
      statePath,
      {
        status: state.status as RespondStatus,
        gateId: res.data.id,
        gateKind: kind,
      },
      Date.now(),
      db
    );
  } else {
    writeDoctorState(
      statePath,
      {
        status: state.status as DoctorStatus,
        gateId: res.data.id,
        gateKind: kind,
      },
      Date.now(),
      db
    );
  }

  return { gateId: res.data.id, presentation };
}

export type GateWaitResult =
  | { status: 'answered'; answers: GateAnswers; by: string; answeredAt: number }
  | { status: 'pending' };

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
  maxMs: number = GATE_WAIT_MAX_MS
): Promise<GateWaitResult> {
  const state = readGateVerbState(statePath, openDbForHandle(statePath));
  if (!state.gateId) throw new Error(`no gate open for ${state.mrUrl}`);
  const deadline = io.now() + maxMs;

  for (;;) {
    // The remaining budget rides into the facility wait itself (`waitMs`),
    // so a single long-poll can never overshoot the window -- the deadline
    // is enforced inside the poll, not just between polls.
    const remaining = deadline - io.now();
    if (remaining <= 0) return { status: 'pending' };
    const res = await io.gateWait({ id: state.gateId, waitMs: remaining });
    if (!res.ok || !res.data)
      throw new Error(`gate:wait failed: ${res.error ?? 'unknown error'}`);

    if (res.data.status === 'timeout') continue;
    if (res.data.status === 'closed') {
      throw new Error(
        `gate ${state.gateId} closed (${res.data.row.closedReason ?? 'unknown reason'}) before being answered`
      );
    }

    const answer = res.data.row.answer;
    if (!answer)
      throw new Error(
        `gate ${state.gateId} reported answered with no answer on the row`
      );
    return {
      status: 'answered',
      answers: answer.answers as GateAnswers,
      by: answer.by,
      answeredAt: answer.answeredAt,
    };
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
  by: 'pane',
  io: GateVerbIo
): Promise<{
  conflict: boolean;
  answers: GateAnswers;
  by: string;
  answeredAt: number;
}> {
  const answers = JSON.parse(answersJson) as GateAnswers;
  const state = readGateVerbState(statePath, openDbForHandle(statePath));
  if (!state.gateId) throw new Error(`no gate open for ${state.mrUrl}`);

  const res = await io.gateAnswer({ id: state.gateId, answers, by });
  if (!res.ok || !res.data)
    throw new Error(`gate:answer failed: ${res.error ?? 'unknown error'}`);

  const winner = res.data.row.answer;
  if (!winner)
    throw new Error(
      `gate ${state.gateId} answer accepted but row carries no answer`
    );

  return {
    conflict: res.data.conflict === true,
    answers: winner.answers as GateAnswers,
    by: winner.by,
    answeredAt: winner.answeredAt,
  };
}
