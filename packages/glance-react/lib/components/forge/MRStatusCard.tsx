/**
 * MRStatusCard — bordered status section composing pipeline, reviewers, and blockers.
 * Reusable in MRCard, MRSidebar, or any other layout.
 */

import { cn } from '@/utils';
import type { MRDashboardProps } from '@workforge/glance-sdk';

import { BlockerList } from './BlockerList';
import { PipelineStatus } from './PipelineStatus';
import { ReviewerStatus } from './ReviewerStatus';

const STATUS_BORDER: Record<string, string> = {
  mergeable: 'border-l-positive',
  merged: 'border-l-action',
  blocked: 'border-l-caution',
  closed: 'border-l-negative',
  draft: 'border-l-draft',
};

export function MRStatusCard({
  mr,
  className,
}: {
  mr: MRDashboardProps;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-r-md subtle-neutral border-l-2 pl-3 pr-3 py-2 text-xs space-y-1',
        STATUS_BORDER[mr.status] ?? 'border-l-draft',
        className
      )}
    >
      <PipelineStatus pipeline={mr.pipeline} />
      <ReviewerStatus reviews={mr.reviews} />
      <BlockerList blockers={mr.blockers} behindBy={mr.rebaseButton.behindBy} />
    </div>
  );
}
