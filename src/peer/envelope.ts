/** The peer-message contract shared by the board's peer client and the
    switchboard relay. The relay never inspects payloads; every payload parser
    here is used only by the RECEIVING board when it materializes. */

export type NudgeResult = "launched" | "rejected" | "expired";

/** What a sender builds. The relay stamps `from` (from the auth token) and
    `receivedAt` (its own clock -- the only clock freshness may be judged on). */
export interface DraftEnvelope {
  id: string;
  to: string;
  type: string;
  sentAt: number;
  payload: unknown;
}

export interface Envelope extends DraftEnvelope {
  from: string;
  receivedAt: number;
}

export interface ReviewStatePayload {
  mrUrl: string;
  iid: number;
  status: string;
  outcome?: string;
  updatedAt: number;
}

export interface ReReviewRequestPayload {
  mrUrl: string;
  iid: number;
  note?: string;
}

export interface NudgeOutcomePayload {
  mrUrl: string;
  iid: number;
  /** Envelope id of the originating re-review-request. */
  nudgeId: string;
  result: NudgeResult;
  reason?: string;
}

/** Switchboard usernames are GitLab usernames, canonicalized. One board per username. */
export function canonicalUsername(u: string): string {
  return u.trim().toLowerCase();
}

export function makeEnvelope(to: string, type: string, payload: unknown, now: number = Date.now()): DraftEnvelope {
  return { id: crypto.randomUUID(), to: to === "*" ? "*" : canonicalUsername(to), type, sentAt: now, payload };
}

export function parseDraftEnvelope(body: unknown): DraftEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const { id, to, type, sentAt, payload } = body as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  if (typeof to !== "string" || !to.trim()) return null;
  if (typeof type !== "string" || !type) return null;
  if (typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  if (payload === undefined) return null;
  return { id, to: to === "*" ? "*" : canonicalUsername(to), type, sentAt, payload };
}

export function parseEnvelope(v: unknown): Envelope | null {
  const draft = parseDraftEnvelope(v);
  if (!draft) return null;
  const { from, receivedAt } = v as Record<string, unknown>;
  if (typeof from !== "string" || !from) return null;
  if (typeof receivedAt !== "number" || !Number.isFinite(receivedAt)) return null;
  return { ...draft, from: canonicalUsername(from), receivedAt };
}

function mrBase(p: unknown): { mrUrl: string; iid: number } | null {
  if (!p || typeof p !== "object") return null;
  const { mrUrl, iid } = p as Record<string, unknown>;
  if (typeof mrUrl !== "string" || !mrUrl) return null;
  if (typeof iid !== "number" || !Number.isFinite(iid)) return null;
  return { mrUrl, iid };
}

export function parseReviewStatePayload(p: unknown): ReviewStatePayload | null {
  const base = mrBase(p);
  if (!base) return null;
  const { status, outcome, updatedAt } = p as Record<string, unknown>;
  if (typeof status !== "string" || !status) return null;
  if (outcome !== undefined && typeof outcome !== "string") return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  return { ...base, status, outcome: outcome as string | undefined, updatedAt };
}

export function parseReReviewRequestPayload(p: unknown): ReReviewRequestPayload | null {
  const base = mrBase(p);
  if (!base) return null;
  const { note } = p as Record<string, unknown>;
  if (note !== undefined && typeof note !== "string") return null;
  return { ...base, note: note as string | undefined };
}

const NUDGE_RESULTS: NudgeResult[] = ["launched", "rejected", "expired"];

export function parseNudgeOutcomePayload(p: unknown): NudgeOutcomePayload | null {
  const base = mrBase(p);
  if (!base) return null;
  const { nudgeId, result, reason } = p as Record<string, unknown>;
  if (typeof nudgeId !== "string" || !nudgeId) return null;
  if (typeof result !== "string" || !(NUDGE_RESULTS as string[]).includes(result)) return null;
  if (reason !== undefined && typeof reason !== "string") return null;
  return { ...base, nudgeId, result: result as NudgeResult, reason: reason as string | undefined };
}
