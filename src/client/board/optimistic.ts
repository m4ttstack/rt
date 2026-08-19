import { RESPOND_ACTIVE, DOCTOR_ACTIVE } from "./format.ts";
import type { ReviewInfo, RespondInfo, DoctorInfo, BoardMRWithReview } from "../types.ts";

/** The three axes a board action can optimistically claim before the server's
    state file round-trips back via /data.json. */
export type Axis = "review" | "respond" | "doctor";

export interface OptimisticState {
  review: Record<string, ReviewInfo>;
  respond: Record<string, RespondInfo>;
  doctor: Record<string, DoctorInfo>;
}

export const EMPTY_OPTIMISTIC: OptimisticState = { review: {}, respond: {}, doctor: {} };

/** Review's "still going" set is inline (not exported from format.ts) since
    it's only two literals and format.ts has no ReviewStatus active-set today. */
const REVIEW_ACTIVE = new Set(["queued", "reviewing"]);

/** Mark one axis/url queued the instant a launch is requested, before the
    server's state file round-trips back via /data.json. */
export function setQueued(s: OptimisticState, axis: Axis, url: string): OptimisticState {
  return { ...s, [axis]: { ...s[axis], [url]: { status: "queued" } } };
}

/** Undo an optimistic claim -- a launch request that failed or errored before
    the server ever recorded it. */
export function rollback(s: OptimisticState, axis: Axis, url: string): OptimisticState {
  if (!(url in s[axis])) return s;
  const next = { ...s[axis] };
  delete next[url];
  return { ...s, [axis]: next };
}

/** Drop optimistic entries once the server has a real status for that axis on
    that MR. Returns the SAME reference when nothing changed, so a caller that
    re-runs this every poll doesn't loop an effect keyed on the result. */
export function clearServerTruth(s: OptimisticState, mrs: BoardMRWithReview[]): OptimisticState {
  let next = s;
  (["review", "respond", "doctor"] as const).forEach((axis) => {
    let changed = false;
    const nextAxis = { ...next[axis] };
    for (const mr of mrs) {
      if (mr.webUrl && mr[axis] && nextAxis[mr.webUrl]) {
        delete nextAxis[mr.webUrl];
        changed = true;
      }
    }
    if (changed) next = { ...next, [axis]: nextAxis };
  });
  return next;
}

/** The fast-poll predicate: is anything -- optimistic or server-reported --
    still mid-flight on any axis. */
export function anyActive(s: OptimisticState, mrs: BoardMRWithReview[]): boolean {
  const reviewActive =
    Object.values(s.review).some((r) => REVIEW_ACTIVE.has(r.status)) ||
    mrs.some((mr) => {
      const st = mr.review?.status;
      return !!st && REVIEW_ACTIVE.has(st);
    });
  if (reviewActive) return true;

  const respondActive =
    Object.values(s.respond).some((r) => RESPOND_ACTIVE.has(r.status)) ||
    mrs.some((mr) => {
      const st = mr.respond?.status;
      return !!st && RESPOND_ACTIVE.has(st);
    });
  if (respondActive) return true;

  const doctorActive =
    Object.values(s.doctor).some((r) => DOCTOR_ACTIVE.has(r.status)) ||
    mrs.some((mr) => {
      const st = mr.doctor?.status;
      return !!st && DOCTOR_ACTIVE.has(st);
    });
  return doctorActive;
}

/** Server state wins; optimistic entries fill gaps only, per axis. */
export function overlay(mrs: BoardMRWithReview[], s: OptimisticState): BoardMRWithReview[] {
  return mrs.map((mr) => {
    const optRev = mr.webUrl ? s.review[mr.webUrl] : undefined;
    const optResp = mr.webUrl ? s.respond[mr.webUrl] : undefined;
    const optDoc = mr.webUrl ? s.doctor[mr.webUrl] : undefined;
    let next: BoardMRWithReview = mr;
    if (!mr.review && optRev) next = { ...next, review: optRev };
    if (!mr.respond && optResp) next = { ...next, respond: optResp };
    if (!mr.doctor && optDoc) next = { ...next, doctor: optDoc };
    return next;
  });
}
