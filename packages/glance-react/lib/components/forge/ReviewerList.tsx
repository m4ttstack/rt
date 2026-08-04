import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils';
import type { ReviewDisplayState, Reviewer } from '@mattstack/glance';
import { getReviewDisplayState } from '@mattstack/glance';

import {
  ReviewApprovedIcon,
  ReviewAwaitingIcon,
  ReviewChangesRequestedIcon,
  ReviewCommentedIcon,
  ReviewReviewingIcon,
} from './icons';

// Display state → badge config mapping using GitLab's own UI language
const DISPLAY_CONFIG: Record<
  ReviewDisplayState,
  {
    label: string;
    variant: React.ComponentProps<typeof Badge>['variant'];
    color: React.ComponentProps<typeof Badge>['color'];
    icon?: React.ReactNode;
  }
> = {
  approved: {
    label: 'Approved',
    variant: 'subtle',
    color: 'positive',
    icon: <ReviewApprovedIcon className="size-3" />,
  },
  commented: {
    label: 'Commented',
    variant: 'subtle',
    color: 'emphasis',
    icon: <ReviewCommentedIcon className="size-3" />,
  },
  changes_requested: {
    label: 'Changes requested',
    variant: 'subtle',
    color: 'caution',
    icon: <ReviewChangesRequestedIcon className="size-3" />,
  },
  reviewing: {
    label: 'Reviewing',
    variant: 'subtle',
    color: 'neutral',
    icon: <ReviewReviewingIcon className="size-3" />,
  },
  awaiting_review: {
    label: 'Awaiting review',
    variant: 'subtle',
    color: 'action',
    icon: <ReviewAwaitingIcon className="size-3" />,
  },
};

export interface ReviewerRowProps {
  reviewer?: Reviewer;
  loading?: boolean;
  className?: string;
}

/**
 * A single reviewer row: avatar + name + review state badge.
 *
 * When `loading`, renders skeleton placeholders for avatar, name, and badge.
 */
export function ReviewerRow({ reviewer, loading, className }: ReviewerRowProps) {
  if (loading || !reviewer) {
    return (
      <div className={cn('flex items-center gap-2 py-1', className)}>
        <Skeleton className="size-6 rounded-full shrink-0" />
        <Skeleton className="h-3.5 flex-1 max-w-[120px]" />
        <Badge variant="subtle" color="neutral" loading className="shrink-0 gap-1">
          Awaiting
        </Badge>
      </div>
    );
  }

  const displayState = getReviewDisplayState(reviewer.reviewState);
  const config = DISPLAY_CONFIG[displayState];

  return (
    <div className={cn('flex items-center gap-2 py-1', className)}>
      {/* Avatar */}
      {reviewer.avatarUrl ? (
        <img
          src={reviewer.avatarUrl}
          alt={reviewer.name}
          className="size-6 rounded-full shrink-0"
        />
      ) : (
        <div className="size-6 rounded-full bg-neutral flex items-center justify-center shrink-0">
          <span className="text-xs text-muted-foreground">
            {reviewer.name[0]?.toUpperCase()}
          </span>
        </div>
      )}

      {/* Name */}
      <span className="flex-1 text-sm text-foreground truncate">
        {reviewer.name}
      </span>

      {/* State badge */}
      <Badge variant={config.variant} color={config.color} className="shrink-0 gap-1">
        {config.icon}
        {config.label}
      </Badge>
    </div>
  );
}

export interface ReviewerListProps {
  reviewers?: Reviewer[];
  /** Number of skeleton rows to show when `loading`. Default: 2 */
  loadingCount?: number;
  loading?: boolean;
  className?: string;
}

/**
 * Full reviewer list — renders one `ReviewerRow` per assigned reviewer.
 * When `loading`, renders `loadingCount` skeleton rows.
 */
export function ReviewerList({
  reviewers,
  loading,
  loadingCount = 2,
  className,
}: ReviewerListProps) {
  if (loading) {
    return (
      <div className={cn('flex flex-col', className)}>
        {Array.from({ length: loadingCount }, (_, i) => (
          <ReviewerRow key={i} loading />
        ))}
      </div>
    );
  }

  if (!reviewers || reviewers.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        No reviewers assigned
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {reviewers.map(r => (
        <ReviewerRow key={r.id} reviewer={r} />
      ))}
    </div>
  );
}

