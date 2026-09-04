import { join } from "path";
import { APP_ROOT } from "../app-root.ts";

export interface GateQuestion {
  id: string;
  label: string;
  multi: boolean;
  options: string[];
}

/** One answer's wire value: a bare option string/array, or the `{value,
    note}` object the wrapper's note form posts (`{"outcome": {"value":
    "comment", "note": "..."}}`) -- the daemon stores and emits both
    verbatim. See gate-format.ts's `unwrapGateAnswer` for the renderer. */
export type GateAnswerValue = string | string[] | { value: string | string[]; note?: string };

export type GateAnswers = Record<string, GateAnswerValue>;

/** The fields `resume.ts` actually threads through a resume: the gate's own
    identity/questions plus the launch plumbing (`agentId`, `tabId`) needed
    to reopen the pane. Not a general gate record -- nothing here persists
    to disk, and no answer/timestamp fields exist because resume.ts never
    sets them (it reads answers straight off the facility row instead). */
export interface GateState {
  gateId: string;
  mrUrl: string;
  iid: number;
  kind: "review-post";
  status: "open" | "answered" | "parked";
  openedAt: number;
  questions: GateQuestion[];
  agentId?: string;
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
