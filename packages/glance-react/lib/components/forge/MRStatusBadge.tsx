import * as React from 'react';
import { cn } from '@/utils';
import type { MRDashboardProps } from '@mattstack/glance';

import { Badge } from '../ui/badge';
import {
  GitBlockedIcon,
  GitDraftIcon,
  GitMergeGlyph,
  GitPullRequestClosedIcon,
  GitReadyToMergeGlyph,
  SpinnerIcon,
} from './icons';

type Status = MRDashboardProps['status'];

const STATUS_CONFIG: Record<
  Status,
  {
    label: string;
    variant: React.ComponentProps<typeof Badge>['variant'];
    color: React.ComponentProps<typeof Badge>['color'];
    icon: React.ReactNode;
  }
> = {
  mergeable: {
    label: 'Ready to merge',
    variant: 'filled',
    color: 'positive',
    icon: <GitReadyToMergeGlyph className="size-4" />,
  },
  blocked: {
    label: 'Blocked',
    variant: 'filled',
    color: 'caution',
    icon: <GitBlockedIcon className="size-4" />,
  },
  draft: {
    label: 'Draft',
    variant: 'filled',
    color: 'neutral',
    icon: <GitDraftIcon className="size-3 " />,
  },
  merged: {
    label: 'Merged',
    variant: 'filled',
    color: 'merge',
    icon: <GitMergeGlyph className="size-4" />,
  },
  closed: {
    label: 'Closed',
    variant: 'subtle',
    color: 'negative',
    icon: <GitPullRequestClosedIcon className="size-3" />,
  },
};

export interface MRStatusBadgeProps {
  status?: Status;
  /** Show the raw GitLab detailedMergeStatus as a tooltip label */
  detail?: string;
  loading?: boolean;
  /** Override the default badge variant for this status. */
  variant?: React.ComponentProps<typeof Badge>['variant'];
  /** Badge size. @default 'default' */
  size?: React.ComponentProps<typeof Badge>['size'];
  className?: string;
}

/**
 * Status badge for the top of an MR card or queue row.
 * Maps `MRDashboardProps.status` → GDS badge variant + icon.
 *
 * When `loading` is true:
 * - With a `status`: shows the badge with a spinner instead of the status icon
 * - Without a `status`: shows a skeleton badge placeholder
 */
export function MRStatusBadge({
  status,
  loading,
  variant,
  size,
  className,
}: MRStatusBadgeProps) {
  // Full skeleton — no status known yet
  if (loading && !status) {
    return (
      <Badge
        variant="filled"
        color="neutral"
        size={size}
        loading
        className={cn('gap-1', className)}
      >
        Loading…
      </Badge>
    );
  }

  const config = STATUS_CONFIG[status ?? 'draft'];

  return (
    <Badge
      variant={variant ?? config.variant}
      color={config.color}
      size={size}
      className={cn('gap-1 ', className)}
    >
      {loading ? <SpinnerIcon className="size-3 animate-spin" /> : config.icon}
      {config.label}
    </Badge>
  );
}
