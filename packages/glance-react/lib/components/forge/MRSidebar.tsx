import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/utils';
import type { MRDashboardActions, MRDashboardProps } from '@mattstack/glance';
import { ExternalLink } from 'lucide-react';

import { Row } from '../ui/flex';
import { DiffStats } from './DiffStats';
import { LinkIcon } from './icons';
import { MRActions, MRStatusCard } from './MRCardParts';
import { MRHeader } from './MRHeader';

// ── Context ────────────────────────────────────────────────────────────────────

interface MRSidebarContext {
  mr: MRDashboardProps;
  actions?: MRDashboardActions;
  onCopyBranch?: (branchName: string) => void;
}

const SidebarCtx = React.createContext<MRSidebarContext | null>(null);

function useSidebarCtx() {
  return React.useContext(SidebarCtx);
}

/** Resolve: explicit prop wins, then context, then undefined. */
function useMR(explicit?: MRDashboardProps): MRDashboardProps {
  const ctx = useSidebarCtx();
  const mr = explicit ?? ctx?.mr;
  if (!mr) {
    throw new Error(
      'MRSidebar section requires either an `mr` prop or to be nested inside <MRSidebar>.'
    );
  }
  return mr;
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Row align={'center'} justify={'between'}>
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </p>
      <p className="text-[0.65rem] font-semibold uppercase">{right}</p>
    </Row>
  );
}

// ── Namespace sections ─────────────────────────────────────────────────────────

export interface MRSidebarHeaderProps {
  mr?: MRDashboardProps;
  className?: string;
}

/** Shared MR header — status badge + avatar + title + branch info. */
function Header({ mr: mrProp, className }: MRSidebarHeaderProps) {
  const mr = useMR(mrProp);
  return <MRHeader mr={mr} className={cn('rounded-t-md', className)} />;
}

export interface MRSidebarTicket {
  id: string;
  label: string;
  url?: string;
}

export interface MRSidebarTicketSectionProps<
  T extends MRSidebarTicket = MRSidebarTicket,
> {
  ticket: T;
  render?: (ticket: T) => React.ReactNode;
  className?: string;
}

/** Linked ticket / issue reference. */
function Ticket<T extends MRSidebarTicket = MRSidebarTicket>({
  ticket,
  render,
  className,
}: MRSidebarTicketSectionProps<T>) {
  return (
    <div className={cn('px-4 py-3 space-y-2', className)}>
      <SectionLabel
        right={
          <Button variant="subtle" color="emphasis" size="compact-xs">
            {ticket.url ? (
              <a href={ticket.url} target="_blank" rel="noopener noreferrer">
                {ticket.id}
              </a>
            ) : (
              ticket.id
            )}
            <ExternalLink />
          </Button>
        }
      >
        <LinkIcon className="inline size-3 mr-1 -mt-0.5" />
        Ticket
      </SectionLabel>
      {render ? (
        render(ticket)
      ) : (
        <p className="text-xs text-muted-foreground leading-snug">
          {ticket.label}
        </p>
      )}
    </div>
  );
}

export interface MRSidebarChangesProps {
  mr?: MRDashboardProps;
  className?: string;
}

/** Diff stats: additions, deletions, file count + dot grid. */
function Changes({ mr: mrProp, className }: MRSidebarChangesProps) {
  const mr = useMR(mrProp);
  if (!mr.diff) return null;
  return (
    <div className={cn('px-4 py-3 space-y-2', className)}>
      <SectionLabel>Changes</SectionLabel>
      <DiffStats diff={mr.diff} maxDots={10} />
    </div>
  );
}

export interface MRSidebarStatusProps {
  mr?: MRDashboardProps;
  className?: string;
}

/** Pipeline, reviewers, and blockers — reuses the MRStatusCard from the card. */
function Status({ mr: mrProp, className }: MRSidebarStatusProps) {
  const mr = useMR(mrProp);
  return (
    <div className={cn('px-4 py-3 space-y-2', className)}>
      <SectionLabel>Status</SectionLabel>
      <MRStatusCard mr={mr} />
    </div>
  );
}

export interface MRSidebarSectionProps {
  label?: string;
  children: React.ReactNode;
  className?: string;
}

/** Generic section wrapper — use for custom consumer sections. */
function Section({ label, children, className }: MRSidebarSectionProps) {
  return (
    <div className={cn('px-4 py-3 space-y-2', className)}>
      {label && <SectionLabel>{label}</SectionLabel>}
      {children}
    </div>
  );
}

export interface MRSidebarActionsProps {
  mr?: MRDashboardProps;
  actions?: MRDashboardActions;
  className?: string;
}

/** Merge / rebase buttons + auto-merge toggle — delegates to shared MRActions. */
function Actions({
  mr: mrProp,
  actions: actionsProp,
  className,
}: MRSidebarActionsProps) {
  const mr = useMR(mrProp);
  const ctx = useSidebarCtx();
  const actions = actionsProp ?? ctx?.actions;

  return (
    <div className={cn('px-4 py-3 space-y-2', className)}>
      <SectionLabel>Actions</SectionLabel>
      <MRActions mr={mr} actions={actions} />
    </div>
  );
}

// ── Root ────────────────────────────────────────────────────────────────────────

export interface MRSidebarProps {
  mr?: MRDashboardProps;
  actions?: MRDashboardActions;
  /** Render loading skeleton sidebar. */
  loading?: boolean;
  onCopyBranch?: (branchName: string) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Root provider — sets the MR context so child sections can read `mr`
 * without explicit prop drilling. Does **not** render its own container.
 *
 * Supports a `loading` prop that renders a skeleton sidebar while data loads.
 *
 * @example
 * ```tsx
 * <MRSidebar mr={mr} actions={actions}>
 *   <MRSidebar.Header />
 *   <MRSidebar.Branch />
 *   <MRSidebar.Ticket ticket={ticket} />
 *   <MRSidebar.Pipeline />
 *   <MRSidebar.Changes />
 *   <MRSidebar.Actions />
 * </MRSidebar>
 * ```
 */
function Root({
  mr,
  actions,
  loading,
  onCopyBranch,
  children,
  className,
}: MRSidebarProps) {
  // ── Loading skeleton ──────────────────────────────────────────────────
  if (loading && !mr) {
    return (
      <div className={cn('flex flex-col divide-y divide-border', className)}>
        {/* Header */}
        <div className="px-4 pt-3 pb-3 space-y-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        </div>

        {/* Changes */}
        <div className="px-4 py-3 space-y-2">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-4 w-28" />
        </div>

        {/* Status */}
        <div className="px-4 py-3 space-y-2">
          <Skeleton className="h-3 w-12" />
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
        </div>

        {/* Actions */}
        <div className="px-4 py-3 space-y-2">
          <Skeleton className="h-3 w-12" />
          <div className="flex items-center gap-2">
            <Button skeleton size="sm">
              Merge
            </Button>
            <Button skeleton size="sm">
              Rebase
            </Button>
            <Skeleton className="h-5 w-24 rounded-full ml-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (!mr) return null;

  const ctx = React.useMemo(
    () => ({ mr, actions, onCopyBranch }),
    [mr, actions, onCopyBranch]
  );

  return (
    <SidebarCtx.Provider value={ctx}>
      <div className={cn('flex flex-col divide-y divide-border', className)}>
        {children}
      </div>
    </SidebarCtx.Provider>
  );
}

// ── Namespace export ───────────────────────────────────────────────────────────

/**
 * Composable MR sidebar. Pass `mr` to the root and child sections
 * read it from context. Each section also accepts an explicit `mr`
 * prop for standalone use outside the root.
 *
 * @example
 * ```tsx
 * <MRSidebar mr={mr} onClose={onClose}>
 *   <MRSidebar.Header />
 *   <MRSidebar.Ticket ticket={ticket} />
 *   <MRSidebar.Changes />
 *   <MRSidebar.Status />
 *   <MRSidebar.Actions />
 *   <MRSidebar.Section label="Custom">…</MRSidebar.Section>
 * </MRSidebar>
 * ```
 */
export const MRSidebar = Object.assign(Root, {
  Header,
  Ticket,
  Changes,
  Status,
  Actions,
  Section,
});
