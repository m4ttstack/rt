import type { ReactNode } from "react";
import type { BoardMRWithReview, RowContext } from "../types.ts";
import { hasBoardBadges, draftKey } from "./format.ts";
import {
  ReviewBadge,
  RespondBadge,
  DoctorBadge,
  PeerBadge,
  NudgeChip,
  NudgedByMarker,
  DraftBadge,
  SlackPostedChip,
  SlackReactionChips,
} from "./chips.tsx";

/** The badge/chip row shared by RowView and GridView — identical markup in
    both, wrapped in whichever class the caller's layout needs
    ("tui-row-board" for rows, "tui-card-board" for cards). Internalizes the
    hasBoardBadges guard: callers drop their own and just render this. */
export function BoardBadges({
  mr,
  now,
  ctx,
  className,
}: {
  mr: BoardMRWithReview;
  now: number;
  ctx: RowContext;
  className: string;
}): ReactNode {
  if (!hasBoardBadges(mr)) return null;
  return (
    <div className={className}>
      <ReviewBadge review={mr.review} onOpen={() => ctx.onOpenReview(mr)} />
      <RespondBadge respond={mr.respond} onResume={() => ctx.onResumeRespond(mr)} />
      <DoctorBadge doctor={mr.doctor} />
      {(mr.peerReviews ?? []).map((p) => (
        <PeerBadge key={p.reviewer} peer={p} />
      ))}
      <NudgeChip nudge={mr.sentNudge} />
      <NudgedByMarker nudges={mr.nudges} now={now} />
      {(mr.drafts ?? []).map((d) => (
        <DraftBadge
          key={d.kind}
          draft={d}
          resolved={ctx.draftResolved.get(draftKey(mr.webUrl ?? "", d.kind))}
          onOpen={() => ctx.onOpenDraft(mr, d)}
        />
      ))}
      <SlackPostedChip slack={mr.slack} />
      <SlackReactionChips reactions={mr.slack?.reactions} />
    </div>
  );
}
