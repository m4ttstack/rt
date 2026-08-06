import { REVIEW_EMOJI } from "./slack.ts";

export type SignalKind = "review" | "respond" | "doctor";

const KINDS: SignalKind[] = ["review", "respond", "doctor"];

export function isSignalKind(v: unknown): v is SignalKind {
  return typeof v === "string" && (KINDS as string[]).includes(v);
}

/** What one agent lifecycle transition writes on the MR's slack message, or
    null for the transitions that say nothing. This is the whole policy: the
    launched agent never touches slack, it only reports status, and the board
    decides here what that status means to the channel.

    `done` with no outcome is deliberately silent -- the human never answered the
    review's posting gate, and an unanswered verdict is not an approve. */
export function signalEmoji(kind: SignalKind, status: string, outcome?: string): string | null {
  if (kind !== "review") return null;
  if (status === "reviewing") return REVIEW_EMOJI.looking;
  if (status !== "done") return null;
  if (outcome === "comment") return REVIEW_EMOJI.commented;
  if (outcome === "approve") return REVIEW_EMOJI.approved;
  return null;
}

export interface AgentSignal {
  mrUrl: string;
  iid: number;
  kind: SignalKind;
  status: string;
  outcome?: string;
}

/** Parse an /agent/status body -- the wire contract every CLI in bin/ posts and
    the only thing standing between an agent lifecycle transition and a silent
    400. `lookupIid` is injected rather than imported (e.g. server.ts supplies
    `(u) => readReviewStates().get(u)?.iid ?? 0`) so this module, which the CLIs
    also pull in, never drags in server-side state handling.

    `/review/outcome` is the pre-existing shape the review CLI used before the
    board owned the whole policy; `{ mrUrl, outcome }` on that path is filled
    out into the same signal via the injected lookup. */
export function parseAgentSignal(
  body: unknown,
  pathname: string,
  lookupIid: (mrUrl: string) => number,
): AgentSignal | null {
  if (!body || typeof body !== "object") return null;
  const { mrUrl, iid, kind, status, outcome } = body as Record<string, unknown>;
  if (typeof mrUrl !== "string" || !mrUrl) return null;
  if (outcome !== undefined && typeof outcome !== "string") return null;
  if (pathname === "/review/outcome") {
    return { mrUrl, iid: lookupIid(mrUrl), kind: "review", status: "done", outcome: outcome as string | undefined };
  }
  if (!isSignalKind(kind)) return null;
  if (typeof status !== "string" || !status) return null;
  if (typeof iid !== "number" || !Number.isFinite(iid)) return null;
  return { mrUrl, iid, kind, status, outcome: outcome as string | undefined };
}
