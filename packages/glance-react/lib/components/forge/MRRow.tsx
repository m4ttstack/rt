import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils';
import type { MRDashboardActions, MRDashboardProps } from '@forge-glance/sdk';

import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  EyeIcon,
  GitBlockedIcon,
  GitBranchIcon,
  GitDraftIcon,
  GitMergeGlyph,
  GitPullRequestClosedIcon,
  GitReadyToMergeGlyph,
  PipelineFailedIcon,
  PipelinePassedIcon,
  PipelineRunningIcon,
  SpinnerIcon,
} from './icons';
import { ReviewerList } from './ReviewerList';

// ── Status dot config ──────────────────────────────────────────────────────────

type Status = MRDashboardProps['status'];

const STATUS_DOT: Record<Status, { color: string; icon: React.ReactNode }> = {
  mergeable: {
    color: 'text-positive',
    icon: <GitReadyToMergeGlyph className="size-5 text-positive" />,
  },
  merged: {
    color: 'text-action',
    icon: <GitMergeGlyph className="size-5 text-action" />,
  },
  blocked: {
    color: 'text-caution',
    icon: <GitBlockedIcon className="size-5 text-caution" />,
  },
  draft: {
    color: 'text-muted-foreground',
    icon: <GitDraftIcon className="size-5 text-muted-foreground" />,
  },
  closed: {
    color: 'text-negative',
    icon: <GitPullRequestClosedIcon className="size-5 text-negative" />,
  },
};

// ── Left border accent by status ───────────────────────────────────────────────

const BORDER_COLOR: Record<Status, string> = {
  mergeable: 'border-l-positive',
  merged: 'border-l-action',
  blocked: 'border-l-caution',
  draft: 'border-l-draft',
  closed: 'border-l-negative',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: Status }) {
  const config = STATUS_DOT[status];
  return <div className="shrink-0">{config.icon}</div>;
}

function PipelineIcon({
  pipeline,
}: {
  pipeline: MRDashboardProps['pipeline'];
}) {
  if (!pipeline) return null;
  const { status, failing, running } = pipeline;
  const isFailing = status === 'failed' || failing > 0;
  const isRunning = status === 'running' || running > 0;

  const notableJobs = (pipeline.jobs ?? []).filter(
    j =>
      j.status === 'failed' || j.status === 'running' || j.status === 'pending'
  );

  const icon = isFailing ? (
    <PipelineFailedIcon className="size-3.5 text-negative" />
  ) : isRunning ? (
    <PipelineRunningIcon className="size-3.5 text-emphasis animate-spin" />
  ) : (
    <PipelinePassedIcon className="size-3.5 text-positive" />
  );

  const label = isFailing
    ? `${failing} of ${pipeline.total} checks failing`
    : isRunning
      ? `${running} of ${pipeline.total} checks running`
      : `All ${pipeline.total} checks passed`;

  if (notableJobs.length === 0) {
    return <span title={label}>{icon}</span>;
  }

  const openBg = isFailing
    ? 'data-[state=open]:bg-negative/15'
    : isRunning
      ? 'data-[state=open]:bg-emphasis/15'
      : 'data-[state=open]:bg-positive/15';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 cursor-pointer transition-all duration-150',
            'data-[state=open]:px-1 data-[state=open]:py-0.5 data-[state=open]:rounded-md',
            openBg
          )}
          title={label}
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 max-h-48 overflow-y-auto space-y-1 p-2"
      >
        {notableJobs.map(job => (
          <Button
            key={job.id}
            variant="link"
            color={job.status === 'failed' ? 'negative' : 'neutral'}
            size="compact-sm"
            asChild={!!job.webUrl}
            disabled={!job.webUrl}
            className="justify-start gap-1.5 px-0 h-auto"
          >
            {job.webUrl ? (
              <a href={job.webUrl} target="_blank" rel="noopener noreferrer">
                {job.status === 'failed' ? (
                  <PipelineFailedIcon className="size-3.5 shrink-0" />
                ) : (
                  <SpinnerIcon className="size-3 animate-spin shrink-0" />
                )}
                {job.name}
                <span className="text-muted-foreground font-normal">
                  ({job.stage})
                </span>
              </a>
            ) : (
              <>
                {job.status === 'failed' ? (
                  <PipelineFailedIcon className="size-3.5 shrink-0" />
                ) : (
                  <SpinnerIcon className="size-3 animate-spin shrink-0" />
                )}
                {job.name}
                <span className="text-muted-foreground font-normal">
                  ({job.stage})
                </span>
              </>
            )}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ReviewFraction({ reviews }: { reviews: MRDashboardProps['reviews'] }) {
  const totalReviewers = reviews.given + reviews.remaining;
  if (totalReviewers === 0) return null;

  const openBg = reviews.isApproved
    ? 'data-[state=open]:bg-positive/15'
    : 'data-[state=open]:bg-caution/15';

  const trigger = (
    <button
      type="button"
      className={cn(
        ' font-semibold flex items-center gap-1 cursor-pointer transition-all duration-150',
        'data-[state=open]:px-1.5 data-[state=open]:py-0.5 data-[state=open]:rounded-md',
        openBg
      )}
      title={
        reviews.isApproved
          ? `Approved by ${reviews.given}/${totalReviewers} reviewers`
          : `${reviews.given}/${totalReviewers} approvals — ${reviews.remaining} remaining`
      }
    >
      <EyeIcon
        className={cn(
          'size-4',
          reviews.isApproved ? 'text-positive' : 'text-caution'
        )}
      />
      <span className={cn(reviews.isApproved ? 'text-positive' : '')}>
        {reviews.given}/{totalReviewers}
      </span>
    </button>
  );

  if (reviews.reviewers.length === 0) return trigger;

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <ReviewerList reviewers={reviews.reviewers} />
      </PopoverContent>
    </Popover>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface MRRowProps {
  mr?: MRDashboardProps;
  /** Pre-bound SDK actions — preferred over individual callbacks. */
  actions?: MRDashboardActions;
  /** Render loading skeleton. */
  loading?: boolean;
  /** @deprecated Use actions instead. */
  onMerge?: () => void;
  /** @deprecated Use actions instead. */
  onRebase?: () => void;
  className?: string;
}

/**
 * Compact MR list row — matches the Graphite queue activity / GitLab MR list
 * dense row aesthetic. Everything fits in two lines:
 *
 * Line 1: [status dot] [title]  [reviews] [pipeline] [diff] [time]
 * Line 2:              [!iid · source → target]
 *
 * Review fraction and pipeline icon are clickable popovers that show the
 * reviewer list and notable pipeline jobs respectively.
 */
export function MRRow({ mr, loading, className }: MRRowProps) {
  if (loading && !mr) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2.5',
          'border-l-2 border-l-draft bg-card',
          className
        )}
      >
        <Skeleton className="size-5 rounded-full shrink-0" />
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-3/5 mb-1.5" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-3" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-3 w-8" />
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    );
  }

  if (!mr) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2.5',
        'border-l-2 bg-card hover:bg-neutral transition-colors',
        BORDER_COLOR[mr.status],
        className
      )}
    >
      {/* Status dot */}
      <StatusDot status={mr.status} />

      {/* Text block */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate leading-tight">
          {mr.title}
        </p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 leading-tight">
          <span>!{mr.iid}</span>
          <span className="text-muted-foreground">·</span>
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate">{mr.sourceBranch}</span>
          <span className="text-muted-foreground">→</span>
          <span className="truncate">{mr.targetBranch}</span>
        </p>
      </div>

      {/* Inline stats — right side */}
      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
        {/* Review count: eye icon + given/total — click for reviewer list */}
        <ReviewFraction reviews={mr.reviews} />

        {/* Pipeline — click for notable jobs */}
        <PipelineIcon pipeline={mr.pipeline} />

        {/* Diff stats */}
        {mr.diff && (
          <span className="flex flex-col font-mono items-end text-[.7rem]">
            <div className="flex items-center gap-1">
              <span className="text-negative font-bold">
                -{mr.diff.deletions}
              </span>
              <span className="text-positive font-bold">
                +{mr.diff.additions}
              </span>
            </div>
            <span>{mr.diff.filesChanged} files</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── List wrapper ───────────────────────────────────────────────────────────────

export interface MRRowListProps {
  mrs?: MRDashboardProps[];
  /** Pre-bound SDK actions — preferred over individual callbacks. */
  actions?: MRDashboardActions;
  /** Render loading skeleton rows. */
  loading?: boolean;
  /** Number of skeleton rows when loading. @default 3 */
  loadingCount?: number;
  /** @deprecated Use actions instead. */
  onMerge?: (mr: MRDashboardProps) => void;
  /** @deprecated Use actions instead. */
  onRebase?: (mr: MRDashboardProps) => void;
  className?: string;
}

/**
 * A vertically stacked list of `MRRow` items separated by a subtle divider.
 * Matches the Graphite queue activity list pattern.
 */
export function MRRowList({
  mrs,
  actions,
  loading,
  loadingCount = 3,
  onMerge,
  onRebase,
  className,
}: MRRowListProps) {
  if (loading) {
    return (
      <div className={cn('flex flex-col divide-y divide-border', className)}>
        {Array.from({ length: loadingCount }, (_, i) => (
          <MRRow key={i} loading />
        ))}
      </div>
    );
  }

  if (!mrs || mrs.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground px-3 py-4', className)}>
        No pull requests
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col divide-y divide-border', className)}>
      {mrs.map(mr => (
        <MRRow
          key={mr.iid}
          mr={mr}
          actions={actions}
          onMerge={onMerge ? () => onMerge(mr) : undefined}
          onRebase={onRebase ? () => onRebase(mr) : undefined}
        />
      ))}
    </div>
  );
}
