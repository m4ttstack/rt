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
}
