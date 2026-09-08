import type { ReactNode } from 'react';

import type { BoardMRWithReview, RowContext } from '../types.ts';
import {
  DoctorBadge,
  DraftBadge,
  NudgeChip,
  NudgedByMarker,
  PeerBadge,
  RespondBadge,
  ReviewBadge,
  SlackPostedChip,
  SlackReactionChips,
} from './chips.tsx';
import { draftKey, hasBoardBadges } from './format.ts';

/** The badge/chip row under each MR row, wrapped in the caller's layout class
    ("tui-row-board"). Internalizes the hasBoardBadges guard: callers drop
    their own and just render this. */
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
      <RespondBadge
        respond={mr.respond}
        onResume={() => ctx.onResumeRespond(mr)}
        onOpen={() => ctx.onOpenRespond(mr)}
      />
      <DoctorBadge doctor={mr.doctor} />
      {(mr.peerReviews ?? []).map(p => (
        <PeerBadge key={p.reviewer} peer={p} />
      ))}
      <NudgeChip nudge={mr.sentNudge} />
      <NudgedByMarker nudges={mr.nudges} now={now} />
      {(mr.drafts ?? []).map(d => (
        <DraftBadge
          key={d.kind}
          draft={d}
          resolved={ctx.draftResolved.get(draftKey(mr.webUrl ?? '', d.kind))}
          onOpen={() => ctx.onOpenDraft(mr, d)}
        />
      ))}
      <SlackPostedChip slack={mr.slack} />
      <SlackReactionChips reactions={mr.slack?.reactions} />
    </div>
  );
}
