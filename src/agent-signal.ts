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
