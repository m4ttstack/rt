import { join } from "path";
import { APP_ROOT } from "../app-root.ts";

export interface GateQuestion {
  id: string;
  label: string;
  multi: boolean;
  options: string[];
}

export type GateAnswers = Record<string, string | string[]>;

export interface GateState {
  gateId: string;
  mrUrl: string;
  iid: number;
  kind: "review-post";
  status: "open" | "answered" | "parked";
  openedAt: number;
  answeredAt?: number;
  parkedAt?: number;
  answers?: GateAnswers;
  answeredBy?: "board-ui" | "pane";
  questions: GateQuestion[];
  agentId?: string;
  sessionId?: string;
  paneId?: string;
  tabId?: string;
}

/** Per-gate JSON files used to live here; one live gate per MR. Retired
    (see gates/sweep.ts and gates/cache.ts, the daemon-backed replacements),
    but the constant survives for server.ts's one-time boot cleanup that
    removes any leftover directory on upgraded installs. */
export const GATE_DIR = join(APP_ROOT, "state", "gates");

/** The gate fields a board row carries -- a subset of `GateState`, leaving
    out the launch-plumbing fields (`agentId`, `sessionId`, `paneId`,
    `tabId`) that only the wrapper/verbs side needs. */
export interface GateRow {
  gateId: string;
  status: GateState["status"];
  openedAt: number;
  questions: GateQuestion[];
  answers?: GateAnswers;
}
