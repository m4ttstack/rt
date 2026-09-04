import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { APP_ROOT } from "./app-root.ts";

/**
 * Doctor lifecycle for MRs with mechanical breakage (CI failing, merge
 * conflicts). The board owns "queued"; the skill emits the middle states.
 * `fixing` and `watching` loop until the branch is green + clean.
 */
export type DoctorStatus = "queued" | "diagnosing" | "rebasing" | "fixing" | "watching" | "done" | "error";

export type DoctorOrigin = "auto" | "manual";

export interface DoctorState {
  mrUrl: string;
  iid: number;
  status: DoctorStatus;
  message?: string;
  tabId?: string;
  workspaceId?: string;
  /** Who queued this doctor: the policy engine or a human click. Drives the
      board's auto marker and the auto-only concurrency cap. */
  origin?: DoctorOrigin;
  /** rt agent record id from the launch result. */
  agentId?: string;
  /** rt herdr pane id the agent landed in, from the launch result. */
  paneId?: string;
  /** Facility gate id from the most recent `gate open`, so `gate wait` /
      `gate answer` can find it by state path alone. */
  gateId?: string;
  /** The kind `gateId` was opened with ("doctor-escalation") -- the
      wrapper's own re-entry reads this to know what a `--resumed-gate`
      id names. */
  gateKind?: string;
  /** Id of the gate the board has already resumed a parked-then-answered
      session for -- the exactly-once dedup marker (see gates/resume.ts). */
  resumedGateId?: string;
  startedAt: number;
  updatedAt: number;
}

export const DOCTOR_DIR = join(APP_ROOT, "state", "doctors");


export function doctorFilePath(mrUrl: string, dir: string = DOCTOR_DIR): string {
  const slug = mrUrl.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
  return join(dir, `${slug}.json`);
}

export function writeDoctorState(
  path: string,
  patch: Partial<DoctorState> & { status: DoctorStatus },
  now: number = Date.now(),
): DoctorState {
  let prev: Partial<DoctorState> = {};
  try {
    prev = JSON.parse(readFileSync(path, "utf8")) as DoctorState;
  } catch {
    // no prior file, or unreadable -- start fresh
  }
  const next: DoctorState = {
    mrUrl: patch.mrUrl ?? prev.mrUrl ?? "",
    iid: patch.iid ?? prev.iid ?? 0,
    status: patch.status,
    message: patch.message ?? prev.message,
    tabId: patch.tabId ?? prev.tabId,
    workspaceId: patch.workspaceId ?? prev.workspaceId,
    origin: patch.origin ?? prev.origin,
    agentId: patch.agentId ?? prev.agentId,
    paneId: patch.paneId ?? prev.paneId,
    gateId: patch.gateId ?? prev.gateId,
    gateKind: patch.gateKind ?? prev.gateKind,
    resumedGateId: patch.resumedGateId ?? prev.resumedGateId,
    startedAt: prev.startedAt ?? now,
    updatedAt: now,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  // Atomic write: writeFileSync opens with O_TRUNC and then writes, leaving a
  // window where the file exists but is empty. The board polls this file every
  // 4s while a doctor is running, and a mid-write read makes the badge blink
  // off for a tick. Rename over the target is atomic on POSIX same-dir, so the
  // reader always sees the old file or the fully-written new file.
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, path);
  return next;
}

export function readDoctorStates(dir: string = DOCTOR_DIR): Map<string, DoctorState> {
  const out = new Map<string, DoctorState>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let state: DoctorState;
    try {
      state = JSON.parse(readFileSync(path, "utf8")) as DoctorState;
    } catch {
      continue;
    }
    if (state.mrUrl) out.set(state.mrUrl, state);
  }
  return out;
}

/** Drop doctor states whose MR has left the board (kept while the MR is shown).
    See pruneReviewStates for the rationale and the healthy-snapshot gate. */
export function pruneDoctorStates(keepUrls: ReadonlySet<string>, dir: string = DOCTOR_DIR): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let mrUrl: string | undefined;
    try {
      mrUrl = (JSON.parse(readFileSync(path, "utf8")) as DoctorState).mrUrl;
    } catch {
      continue;
    }
    if (mrUrl && !keepUrls.has(mrUrl)) rmSync(path, { force: true });
  }
}

export function attachDoctors<T extends { webUrl?: string | null }>(
  mrs: T[],
  doctors: Map<string, DoctorState>,
): Array<T & { doctor?: DoctorState }> {
  return mrs.map((mr) => (mr.webUrl && doctors.has(mr.webUrl) ? { ...mr, doctor: doctors.get(mr.webUrl) } : mr));
}

export function parseDoctorRequestBody(body: unknown): { mrUrl: string; iid: number } | null {
  if (!body || typeof body !== "object") return null;
  const { mrUrl, iid } = body as { mrUrl?: unknown; iid?: unknown };
  if (typeof mrUrl !== "string" || !mrUrl) return null;
  if (typeof iid !== "number" || !Number.isFinite(iid)) return null;
  return { mrUrl, iid };
}
