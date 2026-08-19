import type { MouseEvent } from "react";
import type { BoardMR } from "../data.ts";
import type { SlackTemplates } from "../template.ts";
import type { RespondStatus } from "../respond-outcome.ts";

export interface RosterMember {
  username: string;
  name: string | null;
  count: number;
}

/** Every configured member with its hidden state and MR count — for the settings modal.
    `count` is null for checked-out members, whose MRs the server doesn't fetch. */
export interface ConfigMember {
  username: string;
  name: string | null;
  hidden: boolean;
  count: number | null;
}

export type ReviewStatus = "queued" | "reviewing" | "done" | "error";
export interface ReviewInfo { status: ReviewStatus; message?: string; reportReady?: boolean; sessionId?: string }
export interface RespondInfo { status: RespondStatus; message?: string; sessionId?: string; posted?: number; threads?: number }
export type DoctorStatus = "queued" | "diagnosing" | "rebasing" | "fixing" | "watching" | "done" | "error";
export interface DoctorInfo { status: DoctorStatus; message?: string; origin?: "auto" | "manual" }
export interface DraftInfo { kind: string; body: string; createdAt: number }
export interface SlackInfo { status: "found" | "notfound"; permalink?: string; reactions: string[]; posted: boolean }
/** How a peer's board says their review of one of our MRs is going. `status`
    and `outcome` stay loose strings: they're another board's lifecycle words,
    relayed verbatim, and a peer may run a version whose vocabulary we don't know. */
export interface PeerReviewInfo { mrUrl: string; iid: number; reviewer: string; status: string; outcome?: string; updatedAt: number }
/** The re-review this board asked a peer for, and where that ask now stands.
    `reason` only comes with a rejection (the peer's own words for the refusal). */
export interface SentNudgeInfo { display: "requested" | "confirmed" | "launched" | "rejected" | "expired" | "no-response"; reviewer: string; reason?: string }
/** A peer waiting on us: an inbound re-review request we haven't handled yet. */
export interface InboundNudgeInfo { from: string; receivedAt: number }
export type BoardMRWithReview = BoardMR & {
  review?: ReviewInfo;
  respond?: RespondInfo;
  doctor?: DoctorInfo;
  slack?: SlackInfo;
  drafts?: DraftInfo[];
  peerReviews?: PeerReviewInfo[];
  sentNudge?: SentNudgeInfo;
  nudges?: InboundNudgeInfo[];
};

export interface BoardData {
  title: string;
  defaultMember: string;
  members: RosterMember[];
  allMembers: ConfigMember[];
  mrs: BoardMRWithReview[];
  fetchedAt: number;
  fetchError: string | null;
  local: boolean;
  slackEnabled: boolean;
  /** Configured review-signal emoji names by role; absent on older servers. */
  slackEmoji?: { looking: string; commented: string; approved: string };
  slackTemplates: SlackTemplates;
  /** Oldest daemon syncedAt across projects; null when no daemon read reached
      this snapshot. Drives the honest footer (distinct from `fetchedAt`, which
      only says the board's own poll succeeded). */
  dataSyncedAt: number | null;
  /** Authors this board demanded but rt hasn't finished backfilling yet. */
  scopeUncovered: string[];
  /** Narrowest sync window (days) among the daemon reads; null when none carried one. */
  scopeWindowDays: number | null;
  /** The board's own configured stale cutoff (days), for comparing against
      `scopeWindowDays` -- a board asking for more history than rt syncs. */
  staleAfterDays: number;
  /** Whether this board can hand out peer-board invites: local request, and the
      board holds both a switchboard url and the credential that authorizes it. */
  canInvite: boolean;
  /** Peering health: "ok" when the switchboard accepts us, "unauthorized" when
      it rejects us, null when this board isn't peering at all. */
  peering: "ok" | "unauthorized" | null;
}

export type ThemeMode = "light" | "dark" | "system";
export type ViewMode = "rows" | "grid";

export interface Toast {
  id: number;
  text: string;
}

export interface RowMenuState {
  x: number;
  y: number;
  mr: BoardMR;
}

/** Shared per-render context threaded through RowView, GridView, and RowMenu —
    the board-owned bits every row/menu needs that aren't specific to one MR.
    Built once in Board.tsx per render, not memoized: recreating it is no more
    work than the individual props it replaces. */
export interface RowContext {
  local: boolean;
  slackTemplates: SlackTemplates;
  slackEnabled: boolean;
  onContext: (e: MouseEvent, mr: BoardMR) => void;
  onOpenReview: (mr: BoardMRWithReview) => void;
  onOpenDraft: (mr: BoardMRWithReview, draft: DraftInfo) => void;
  draftResolved: ReadonlyMap<string, "posted" | "dismissed">;
  onResumeRespond: (mr: BoardMR, note?: string) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (webUrl: string) => void;
}

export type ThreadStatus = "resolved" | "replied" | "awaiting";
export type CommentNote = { id: number; name: string; username: string | null; at: string; body: string };
export type CommentThread = { status: ThreadStatus; notes: CommentNote[] };
export type GeneralComment = CommentNote;
