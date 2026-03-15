// ── Forge-specific components ─────────────────────────────────────────────────
export { MRCard } from './components/forge/MRCard';
export type { MRCardProps } from './components/forge/MRCard';

export { MRNode } from './components/forge/MRNode';
export type { MRNodeProps } from './components/forge/MRNode';

export { Row, Stack } from './components/ui/flex';
export type { FlexProps } from './components/ui/flex';

export { MRSidebar } from './components/forge/MRSidebar';
export type {
  MRSidebarProps,
  MRSidebarTicket,
} from './components/forge/MRSidebar';

export { MRRow, MRRowList } from './components/forge/MRRow';
export type { MRRowProps, MRRowListProps } from './components/forge/MRRow';

export { MRStatusBadge } from './components/forge/MRStatusBadge';
export type { MRStatusBadgeProps } from './components/forge/MRStatusBadge';

export { PipelineBadge } from './components/forge/PipelineBadge';
export type { PipelineBadgeProps } from './components/forge/PipelineBadge';

export { ReviewerList, ReviewerRow } from './components/forge/ReviewerList';
export type {
  ReviewerListProps,
  ReviewerRowProps,
} from './components/forge/ReviewerList';

export { GitHubIcon, GitLabIcon } from './components/forge/brand-icons';

export {
  MRCardSkeleton,
  MRRowSkeleton,
  MRRowListSkeleton,
  MRNodeSkeleton,
} from './components/forge/MRSkeletons';
export type {
  MRCardSkeletonProps,
  MRRowSkeletonProps,
  MRRowListSkeletonProps,
  MRNodeSkeletonProps,
} from './components/forge/MRSkeletons';

export { ConnectionStatusBadge } from './components/forge/ConnectionStatusBadge';
export type {
  ConnectionStatusBadgeProps,
  ConnectionState,
} from './components/forge/ConnectionStatusBadge';

export { MRCardError } from './components/forge/MRCardError';
export type { MRCardErrorProps } from './components/forge/MRCardError';

// ── Modular MR sub-components ─────────────────────────────────────────────────
export { MRHeader } from './components/forge/MRHeader';
export { DiffStats as DiffStatsDisplay } from './components/forge/DiffStats';
export { MRStatusCard } from './components/forge/MRStatusCard';
export { MRActions } from './components/forge/MRActions';
export type { MRActionsProps } from './components/forge/MRActions';
export { StatusIcon, ExpandChevron } from './components/forge/StatusIcon';
export { PipelineStatus } from './components/forge/PipelineStatus';
export { ReviewerStatus } from './components/forge/ReviewerStatus';
export { BlockerList } from './components/forge/BlockerList';

// ── Base primitives ───────────────────────────────────────────────────────────
export { Button, buttonVariants } from './components/ui/button';
export { IconButton } from './components/ui/icon-button';
export type { IconButtonProps } from './components/ui/icon-button';
export { Badge, badgeVariants } from './components/ui/badge';
export { Switch } from './components/ui/switch';
export { Skeleton } from './components/ui/skeleton';

// ── Dashboard hook ────────────────────────────────────────────────────────────
export { useDashboard } from './hooks/useDashboard';
export type {
  UseDashboardResult,
  UseDashboardOptions,
  ConnectionStatus,
} from './hooks/useDashboard';

// ── SDK types (re-exported so consumers don't need @forge-glance/sdk) ─────────
export type {
  MRStatus,
  MRDashboardProps,
  MRDashboardActions,
  Dashboard,
  DashboardGroup,
  CreateDashboardOptions,
  Reviewer,
  ReviewDisplayState,
  Pipeline,
  PipelineJob,
  DiffStats,
  MergeabilityCheck,
  MRState,
  FetchPullRequestsOptions,
  WatcherStatus,
} from '@forge-glance/sdk';
