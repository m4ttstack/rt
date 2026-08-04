import * as React from 'react';
import { cn } from '@/utils';
import { Badge } from '../ui/badge';
import { SpinnerIcon } from './icons';
import type { MRDashboardProps } from '@mattstack/glance';
import {
  NoPipelineIcon,
  PipelineFailedIcon,
  PipelinePassedIcon,
  PipelinePassedWithWarnings,
} from './icons';

export interface PipelineBadgeProps {
  pipeline: MRDashboardProps['pipeline'];
  loading?: boolean;
  /** Badge size. @default 'default' */
  size?: React.ComponentProps<typeof Badge>['size'];
  /** Badge variant. @default 'filled' */
  variant?: React.ComponentProps<typeof Badge>['variant'];
  /** Show only the icon, hide the text label. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Compact badge showing CI pipeline status.
 * Maps pipeline.status + counters to a badge variant + icon + label.
 *
 * Typical badge row:  [✓ 12/12 passed]  or  [✗ 2/12 failing]
 */
export function PipelineBadge({ pipeline, loading, size, variant = 'filled', iconOnly, className }: PipelineBadgeProps) {
  if (loading) {
    return (
      <Badge
        variant={variant}
        color="neutral"
        size={size}
        loading
        className={cn('gap-1', className)}
      >
        0/0 pipeline
      </Badge>
    );
  }

  if (!pipeline) {
    return (
      <Badge
        variant="outline"
        color="neutral"
        size={size}
        className={cn('gap-1 px-3 text-muted-foreground', className)}
      >
        <NoPipelineIcon className="size-3" />
        {!iconOnly && 'No pipeline'}
      </Badge>
    );
  }

  const { status, passing, failing, running, total, hasWarnings } = pipeline;

  const isRunning = status === 'running' || status === 'pending' || running > 0;
  const isFailing = status === 'failed' || failing > 0;
  const isPassing = status === 'success' || status === 'passed';

  const color: React.ComponentProps<typeof Badge>['color'] = isRunning
    ? 'emphasis'
    : isFailing
      ? 'negative'
      : hasWarnings
        ? 'caution'
        : isPassing
          ? 'positive'
          : 'neutral';

  const icon = isRunning ? (
    <SpinnerIcon className="size-3 animate-spin" />
  ) : isFailing ? (
    <PipelineFailedIcon className="size-3.5" />
  ) : hasWarnings ? (
    <PipelinePassedWithWarnings className="size-4" />
  ) : isPassing ? (
    <PipelinePassedIcon className="size-4" />
  ) : null;

  const label = isFailing
    ? `${failing}/${total} failing`
    : isRunning
      ? `${running} running`
      : isPassing
        ? `${passing}/${total} passed`
        : status;

  return (
    <Badge variant={variant} color={color} size={size} className={cn('gap-1', className)}>
      {icon}
      {!iconOnly && label}
    </Badge>
  );
}

