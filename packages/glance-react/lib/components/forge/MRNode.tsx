import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils';
import type { MRDashboardProps } from '@workforge/glance-sdk';

import { CloseIcon, GitBranchIcon } from './icons';
import { MRStatusBadge } from './MRStatusBadge';

// ── Left border accent by status ───────────────────────────────────────────────

type Status = MRDashboardProps['status'];

const BORDER_COLOR: Record<Status, string> = {
  mergeable: 'border-l-positive',
  merged: 'border-l-action',
  blocked: 'border-l-caution',
  draft: 'border-l-draft',
  closed: 'border-l-negative',
};

// ── Component ──────────────────────────────────────────────────────────────────

export interface MRNodeProps {
  mr?: MRDashboardProps;
  /** Optional ticket / issue ID to display in the subtitle (e.g. "ACME-1231") */
  ticketId?: string;
  /** Render loading skeleton. */
  loading?: boolean;
  /** Called when the node body is clicked */
  onClick?: () => void;
  /** Called when the close / dismiss button is clicked */
  onClose?: () => void;
  /** Highlight the node as selected */
  selected?: boolean;
  className?: string;
}

/**
 * Compact MR node card — designed for pipeline graphs and flow visualizations.
 *
 * Renders a small card with:
 * - Colored left border by status
 * - Status badge + IID in the header row
 * - Title (truncated)
 * - Subtitle: ticket ID · branch name
 *
 * Matches the "stack node" aesthetic from graph UIs.
 *
 * @example
 * <MRNode mr={props} ticketId="ACME-1231" onClick={() => selectNode(mr.iid)} />
 */
export function MRNode({
  mr,
  ticketId,
  loading,
  onClick,
  onClose,
  selected,
  className,
}: MRNodeProps) {
  if (loading && !mr) {
    return (
      <div
        className={cn(
          'rounded-lg rounded-l-none border bg-card',
          'border-l-[3px] border-l-draft',
          className
        )}
      >
        <div className="px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <MRStatusBadge loading />
            <Skeleton className="h-3 w-8 ml-auto" />
          </div>
          <Skeleton className="h-4 w-4/5" />
          <div className="flex items-center gap-1">
            <Skeleton className="size-3 rounded-sm shrink-0" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </div>
    );
  }

  if (!mr) return null;

  return (
    <div
      className={cn(
        'rounded-lg rounded-l-none border bg-card',
        'border-l-[3px]',
        BORDER_COLOR[mr.status],
        selected && 'ring-2 ring-emphasis ring-offset-1 ring-offset-background',
        onClick && 'cursor-pointer hover:bg-neutral transition-colors',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        {/* Header: status badge + iid + close */}
        <div className="flex items-center gap-2">
          <MRStatusBadge status={mr.status} loading={mr.isLoading} />

          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            !{mr.iid}
          </span>

          {onClose && (
            <IconButton
              size="sm"
              aria-label="Close"
              onClick={e => {
                e.stopPropagation();
                onClose();
              }}
            >
              <CloseIcon className="size-3.5" />
            </IconButton>
          )}
        </div>

        {/* Title */}
        <p className="text-sm font-medium text-foreground truncate leading-tight">
          {mr.title}
        </p>

        {/* Subtitle: ticket · branch */}
        <p className="flex items-center gap-1 text-xs text-muted-foreground leading-tight">
          {ticketId && (
            <>
              <span>{ticketId}</span>
              <span>·</span>
            </>
          )}
          <GitBranchIcon className="size-3 shrink-0" />
          <span className="truncate">{mr.sourceBranch}</span>
        </p>
      </div>
    </div>
  );
}
