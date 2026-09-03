import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
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

/** Per-gate JSON files live here; one live gate per MR. */
export const GATE_DIR = join(APP_ROOT, "state", "gates");

/** Deterministic file path for an MR url, so a repeat `gate open` resolves the same file. */
export function gateFilePath(mrUrl: string, dir: string = GATE_DIR): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

/** Read-merge-write a gate state file. A new `gate open` for an MR overwrites the
    prior gate by passing the full opened payload as the patch. */
export function writeGateState(path: string, patch: Partial<GateState> & { gateId: string }): void {
  let prev: Partial<GateState> = {};
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as GateState;
  } catch {
    // no prior file, or unreadable -- start fresh
  }
  const next: GateState = { ...prev, ...patch } as GateState;
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
}

/** Read all gate states, keyed by mrUrl. Skips any file that fails to parse. */
export function readGateStates(dir: string = GATE_DIR): Map<string, GateState> {
  const out = new Map<string, GateState>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let state: GateState;
    try {
      state = JSON.parse(readFileSync(path, "utf8")) as GateState;
    } catch {
      continue;
    }
    if (state.mrUrl) out.set(state.mrUrl, state);
  }
  return out;
}

/** Delete gate states whose MR is no longer on the board. */
export function pruneGateStates(onBoard: Set<string>, dir: string = GATE_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as GateState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !onBoard.has(mrUrl)) {
      rmSync(path, { force: true });
    }
  }
}
