import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/utils';
import type { MRDashboardActions, MRDashboardProps } from '@forge-glance/sdk';

import { Row, Stack } from '../ui/flex';
import { GitHubIcon, GitLabIcon } from './brand-icons';
import { DiffStats, MRActions, MRStatusCard } from './MRCardParts';
import { MRHeader } from './MRHeader';
import { MRStatusBadge } from './MRStatusBadge';

export interface MRCardProps {
  mr?: MRDashboardProps;
  actions?: MRDashboardActions;
  loading?: boolean;
  className?: string;
}

export function MRCard({ mr, actions, loading, className }: MRCardProps) {
  // ── Loading skeleton ───────────────────────────────────────────────
  if (loading && !mr) {
    return (
      <Card className={className}>
        <div className="px-4 pt-3 pb-3 space-y-2">
          <MRStatusBadge loading />
          <Row>
            <Skeleton className="size-8 rounded-full shrink-0" />
            <Stack gap={0.5} className="truncate">
              <Skeleton className="h-4 w-3/4" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-3 rounded-sm shrink-0" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-2" />
                <Skeleton className="h-3 w-12" />
              </div>
            </Stack>
          </Row>
        </div>

        <CardContent className="space-y-3">
          {/* Diff stats */}
          <div className="space-y-2">
            <div className="flex gap-3">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="size-2 rounded-full" />
              ))}
            </div>
          </div>

          {/* Status card */}
          <div className="rounded-r-md subtle-neutral border-l-2 border-l-draft pl-3 pr-3 py-2 space-y-2">
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="size-5 rounded-full shrink-0" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
        </CardContent>

        <CardFooter className="gap-2">
          <Button skeleton size="sm">
            Merge
          </Button>
          <Button skeleton size="sm">
            Rebase
          </Button>
          <Skeleton className="h-5 w-24 rounded-full ml-auto" />
        </CardFooter>
      </Card>
    );
  }

  if (!mr) return null;

  const forgeAction = mr.webUrl ? (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="xs"
            variant={'outline'}
            color={'neutral'}
            aria-label={`Open in ${mr.provider === 'gitlab' ? 'GitLab' : 'GitHub'}`}
          >
            <a href={mr.webUrl} target="_blank" rel="noopener noreferrer">
              {mr.provider === 'gitlab' ? <GitLabIcon /> : <GitHubIcon />}
            </a>
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>
          Open in {mr.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : undefined;

  return (
    <Card className={cn(className)}>
      <MRHeader mr={mr} action={forgeAction} />

      <CardContent className="space-y-3">
        <DiffStats diff={mr.diff} />
        <MRStatusCard mr={mr} />
      </CardContent>

      {mr.status !== 'closed' && mr.status !== 'merged' && (
        <CardFooter>
          <MRActions mr={mr} actions={actions} />
        </CardFooter>
      )}
    </Card>
  );
}
