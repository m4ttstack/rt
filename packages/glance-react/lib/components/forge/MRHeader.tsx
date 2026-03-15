/**
 * MRHeader — shared header block for MR views.
 *
 * Renders: status badge → avatar + (!iid · title) + branch info.
 * Used by both MRCard (in CardHeader) and MRSidebar (as Header section).
 */

import { cn, formatRelativeTime } from '@/utils';
import type { MRDashboardProps } from '@forge-glance/sdk';

import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { CardHeader } from '../ui/card';
import { Row, Stack } from '../ui/flex';
import { GitBranchIcon } from './icons';
import { MRStatusBadge } from './MRStatusBadge';

// ── Status → accent tint ───────────────────────────────────────────────────────

type Status = MRDashboardProps['status'];

export const HEADER_ACCENT: Record<Status, string> = {
  mergeable: 'subtle-positive',
  merged: 'subtle-action',
  blocked: 'subtle-caution',
  closed: 'subtle-negative',
  draft: 'subtle-neutral',
};

// ── Component ──────────────────────────────────────────────────────────────────

export interface MRHeaderProps {
  mr: MRDashboardProps;
  /** Extra content rendered after the title row (e.g. CardAction with icon button). */
  action?: React.ReactNode;
  className?: string;
}

export function MRHeader({ mr, action, className }: MRHeaderProps) {
  return (
    <CardHeader
      className={cn(
        'px-4 pt-3 pb-3 space-y-2 truncate relative',
        HEADER_ACCENT[mr.status],
        className
      )}
    >
      <MRStatusBadge status={mr.status} loading={mr.isLoading} />
      <Row align={'start'} truncate>
        <Row className="flex-1 min-w-0">
          <Avatar size="default" className="ring-2 ring-background">
            <AvatarImage src={mr.author.avatarUrl ?? undefined} />
            <AvatarFallback>
              {mr.author.username.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <Stack gap={0.5} className="min-w-0">
            <span className="text-sm font-normal truncate">
              <span className="text-muted-foreground">!{mr.iid}</span>
              <span className="text-muted-foreground mx-1">·</span>
              {mr.title}
            </span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-normal">
              <GitBranchIcon className="size-3 shrink-0" />
              <span className="truncate">{mr.sourceBranch}</span>
              <span>→</span>
              <span className="truncate">{mr.targetBranch}</span>
              {mr.createdAt && (
                <>
                  <span>·</span>
                  <span className="shrink-0">
                    {formatRelativeTime(mr.createdAt)}
                  </span>
                </>
              )}
            </div>
          </Stack>
        </Row>
        {action && (
          <div className="absolute top-0 right-0 m-2 mx-3">{action}</div>
        )}
      </Row>
    </CardHeader>
  );
}
