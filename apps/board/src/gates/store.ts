import type {
  GateAnswers,
  GateDomain,
  GateOrigin,
  GateQuestion,
} from '@mattstack/gate-kit';

export type {
  GateAnswers,
  GateAnswerValue,
  GateOption,
  GateOrigin,
  GateQuestion,
} from '@mattstack/gate-kit';

/** The fields `resume.ts` actually threads through a resume: the gate's own
    identity/questions plus the launch plumbing (`agentId`, `tabId`) needed
    to reopen the pane. Not a general gate record -- nothing here persists
    to disk, and no answer/timestamp fields exist because resume.ts never
    sets them (it reads answers straight off the facility row instead). */
export interface GateState {
  gateId: string;
  mrUrl: string;
  iid: number;
  kind: string;
  status: 'open' | 'answered' | 'parked';
  openedAt: number;
  questions: GateQuestion[];
  agentId?: string;
  tabId?: string;
}

/** The gate fields a board row carries -- a subset of `GateState`, leaving
    out the launch-plumbing fields (`agentId`, `sessionId`, `paneId`,
    `tabId`) that only the wrapper/verbs side needs. `kind` and `label` let
    the client tell multiple co-live gates on one MR apart (review-post,
    respond-plan, respond-post, doctor-escalation); `label` is the facility
    row's `meta.label` when set, else `kind` itself. */
export interface GateRow {
  gateId: string;
  /** The facility row's own subject (`mr:<url>`): what the answered-gate
      chip derives its `!iid` ref from. */
  subject: string;
  kind: string;
  label: string;
  status: GateState['status'];
  openedAt: number;
  questions: GateQuestion[];
  answers?: GateAnswers;
  answeredBy?: string;
  answeredAt?: number;
  context?: string;
  origin?: GateOrigin;
  domain?: GateDomain;
  /** The facility row's own `meta`, carried through untyped -- a pane-attention
      row's `{ agentId, paneRef, reason }` lives here; a reader narrows per kind. */
  meta?: Record<string, unknown>;
  /** Set when the daemon escalated this gate to a human; drives the
      "escalated" chip alongside the "parked" one. */
  escalatedAt?: number;
  /** Set on an answered row once the daemon's answer-time executor
      guarantee resolves the nudge/relaunch it fired: "stuck" is a blocked
      pane that never left blocked after retries, "confirmed" is a resumed
      pane that came up live. Board-local (SDD executor-reconciler task 14)
      until the reconciler daemon lane republishes rt-client with a
      matching field -- nothing populates it end to end yet. */
  delivery?: { outcome: 'delivered' | 'confirmed' | 'stuck'; at: number };
  /** Set when the answer-time relaunch could not even run (herdr down, no
      agent row) or its expectation failed -- answered with no pane left to
      execute it. Cleared once execution succeeds. Same board-local caveat
      as `delivery`. */
  execution?: 'unassigned';
}
