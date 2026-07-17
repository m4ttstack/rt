import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

/**
 * Doctor lifecycle for MRs with mechanical breakage (CI failing, merge
 * conflicts). The board owns "queued"; the skill emits the middle states.
 * `fixing` and `watching` loop until the branch is green + clean.
 */
export type DoctorStatus = "queued" | "diagnosing" | "rebasing" | "fixing" | "watching" | "done" | "error";

export interface DoctorState {
  mrUrl: string;
  iid: number;
  status: DoctorStatus;
  message?: string;
  tabId?: string;
  workspaceId?: string;
  startedAt: number;
  updatedAt: number;
}

export const DOCTOR_DIR = join(import.meta.dir, "..", "state", "doctors");

const DAY_MS = 24 * 60 * 60_000;

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

export function readDoctorStates(
  dir: string = DOCTOR_DIR,
  now: number = Date.now(),
  maxAgeMs: number = DAY_MS,
): Map<string, DoctorState> {
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
    if (now - (state.updatedAt ?? 0) > maxAgeMs) {
      rmSync(path, { force: true });
      continue;
    }
    if (state.mrUrl) out.set(state.mrUrl, state);
  }
  return out;
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
