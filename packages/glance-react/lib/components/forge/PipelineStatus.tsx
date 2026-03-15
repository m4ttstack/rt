/**
 * PipelineStatus — pipeline status line with popover for notable jobs.
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/utils';
import type { MRDashboardProps } from '@workforge/glance-sdk';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Row } from '../ui/flex';
import {
  CheckIcon,
  NoPipelineIcon,
  PipelineFailedIcon,
  PipelinePassedWithWarnings,
  SpinnerIcon,
} from './icons';
import { ExpandChevron, StatusIcon } from './StatusIcon';

export function PipelineStatus({
  pipeline,
}: {
  pipeline: MRDashboardProps['pipeline'];
}) {
  if (!pipeline) {
    return (
      <Row gap={1.5}>
        <StatusIcon icon={NoPipelineIcon} color="neutral" />
        <span>No pipeline</span>
      </Row>
    );
  }

  const notableJobs = pipeline.jobs.filter(
    j => j.status === 'failed' || j.status === 'running' || j.status === 'pending'
  );
  const hasDetail = notableJobs.length > 0;

  const openBg =
    pipeline.failing > 0 || pipeline.status === 'failed'
      ? 'data-[state=open]:bg-negative/15'
      : pipeline.status === 'running' || pipeline.running > 0
        ? 'data-[state=open]:bg-emphasis/15'
        : pipeline.hasWarnings
          ? 'data-[state=open]:bg-caution/15'
          : 'data-[state=open]:bg-positive/15';

  const trigger = (
    <Row
      gap={1.5}
      className={cn(
        'group cursor-pointer items-center w-fit data-[state=open]:px-1.5 data-[state=open]:py-0.5 data-[state=open]:rounded-md transition-all duration-150',
        openBg
      )}
    >
      {pipeline.failing > 0 || pipeline.status === 'failed' ? (
        <>
          <StatusIcon icon={PipelineFailedIcon} color="negative" />
          <span>
            <span className="text-negative font-semibold">
              {pipeline.failing} failing
            </span>{' '}
            of {pipeline.total} checks
          </span>
        </>
      ) : pipeline.status === 'running' ||
        pipeline.status === 'pending' ||
        pipeline.running > 0 ? (
        <>
          <StatusIcon icon={SpinnerIcon} color="emphasis" spin />
          <span>
            {pipeline.running} running of {pipeline.total} checks
          </span>
        </>
      ) : pipeline.hasWarnings ? (
        <>
          <StatusIcon icon={PipelinePassedWithWarnings} color="caution" />
          <span>
            <span className="text-caution font-semibold">
              Passed with warnings
            </span>{' '}
            — {pipeline.passing}/{pipeline.total} checks
          </span>
        </>
      ) : (
        <>
          <StatusIcon icon={CheckIcon} color="positive" />
          <span>
            All{' '}
            <span className="text-positive font-semibold">
              {pipeline.total} checks passed
            </span>
          </span>
        </>
      )}
      <ExpandChevron />
    </Row>
  );

  if (!hasDetail) return trigger;

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
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
