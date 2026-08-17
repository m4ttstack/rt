import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** BOARD-10: the one-CI-attendant-per-MR lease. A plain per-MR JSON file so
    every actor -- this board, the acme:watch-ci skill's shell helper, a
    human with `ls` -- can read and claim it with nothing but the filesystem
    (acme-skills must stay free of rt/daemon dependencies). Freshness is
    heartbeat + TTL; a crashed holder costs nothing and needs no cleanup. */

export type AttendantHolder = "watch-ci" | "doctor";

export interface AttendantLease {
  mr: string;
  branch?: string;
  holder: AttendantHolder;
  sessionLabel?: string;
  pid?: number;
  startedAt: number;
  heartbeatAt: number;
  ttlSeconds: number;
}

export const DEFAULT_ATTENDANT_TTL_SECONDS = 600;

export function defaultAttendantsDir(): string {
  return join(process.env.HOME ?? "~", ".mattstack", "ci-attendants");
}

/** Project path + iid, slugged for the filesystem: two projects with the same
    iid must never share a lease file. */
export function leaseFileName(mrUrl: string, iid: number): string {
  let project: string;
  try {
    const u = new URL(mrUrl);
    project = u.pathname.split("/-/")[0] ?? u.pathname;
  } catch {
    project = mrUrl;
  }
  const slug = project.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}-${iid}.json`;
}

function leasePath(dir: string, mrUrl: string, iid: number): string {
  return join(dir, leaseFileName(mrUrl, iid));
}

function isFresh(lease: AttendantLease, now: number): boolean {
  return now - lease.heartbeatAt <= lease.ttlSeconds * 1_000;
}

/** The fresh lease for this MR, or null (missing, malformed, or stale --
    callers never see a stale lease). */
export function readLease(dir: string, mrUrl: string, iid: number, now: number): AttendantLease | null {
  let raw: string;
  try {
    raw = readFileSync(leasePath(dir, mrUrl, iid), "utf8");
  } catch {
    return null;
  }
  try {
    const lease = JSON.parse(raw) as AttendantLease;
    if (typeof lease.heartbeatAt !== "number" || typeof lease.ttlSeconds !== "number" || !lease.holder) return null;
    return isFresh(lease, now) ? lease : null;
  } catch {
    return null;
  }
}

/** Atomic claim: exclusive create wins; a fresh foreign lease blocks (and is
    returned so the caller can report the holder); a stale one is replaced. */
export function claimLease(
  dir: string,
  record: AttendantLease,
  now: number,
): { ok: true } | { ok: false; holder: AttendantLease } {
  mkdirSync(dir, { recursive: true });
  const path = leasePath(dir, record.mr, iidOf(record));
  const body = JSON.stringify(record, null, 2);
  try {
    writeFileSync(path, body, { flag: "wx" });
    return { ok: true };
  } catch {
    const existing = readLease(dir, record.mr, iidOf(record), now);
    if (existing && existing.holder !== record.holder) return { ok: false, holder: existing };
    // Stale, malformed, or our own holder re-claiming: replace atomically.
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, path);
    return { ok: true };
  }
}

/** Refresh heartbeatAt -- only when the named holder actually holds it. */
export function heartbeatLease(dir: string, mrUrl: string, iid: number, holder: AttendantHolder, now: number): void {
  const path = leasePath(dir, mrUrl, iid);
  let lease: AttendantLease;
  try {
    lease = JSON.parse(readFileSync(path, "utf8")) as AttendantLease;
  } catch {
    return;
  }
  if (lease.holder !== holder) return;
  lease.heartbeatAt = now;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(lease, null, 2));
  renameSync(tmp, path);
}

/** Delete the lease -- only when the named holder holds it (any freshness). */
export function releaseLease(dir: string, mrUrl: string, iid: number, holder: AttendantHolder): void {
  const path = leasePath(dir, mrUrl, iid);
  let lease: AttendantLease;
  try {
    lease = JSON.parse(readFileSync(path, "utf8")) as AttendantLease;
  } catch {
    return;
  }
  if (lease.holder !== holder) return;
  rmSync(path, { force: true });
}

/** The lease records the MR url; the iid rides in the filename. Claims carry
    both, so recover the iid from the url's trailing segment. */
function iidOf(record: AttendantLease): number {
  const tail = record.mr.split("/").pop() ?? "";
  const n = Number(tail);
  return Number.isFinite(n) && /^\d+$/.test(tail) ? n : 0;
}
