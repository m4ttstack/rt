/**
 * MRActions — shared merge/rebase/auto-merge action bar.
 * Shows a muted placeholder for drafts. Hidden for merged/closed.
 */

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/utils';
import type { MRDashboardActions, MRDashboardProps } from '@forge-glance/sdk';

export interface MRActionsProps {
  mr: MRDashboardProps;
  actions?: MRDashboardActions;
  /** Individual callbacks — @deprecated, use `actions` instead. */
  onMerge?: () => void;
  onRebase?: () => void;
  onAutoMerge?: () => void;
  onCancelAutoMerge?: () => void;
  className?: string;
}

export function MRActions({
  mr,
  actions,
  onMerge,
  onRebase,
  onAutoMerge,
  onCancelAutoMerge,
  className,
}: MRActionsProps) {
  // Hidden for terminal states
  if (mr.status === 'merged' || mr.status === 'closed') return null;

  // Draft placeholder
  if (mr.status === 'draft') {
    return (
      <div className={cn('flex items-center', className)}>
        <p className="text-xs text-muted-foreground italic">
          This MR is a draft
        </p>
      </div>
    );
  }

  const handleMerge = actions
    ? () => {
        actions.merge();
      }
    : onMerge;
  const handleRebase = actions?.rebase ?? onRebase;
  const handleAutoMerge = actions?.setAutoMerge ?? onAutoMerge;
  const handleCancelAutoMerge = actions?.cancelAutoMerge ?? onCancelAutoMerge;

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', className)}>
      {mr.mergeButton.visible && (
        <Button
          variant="filled"
          color={mr.autoMergeButton.isActive ? 'neutral' : 'merge'}
          size="sm"
          disabled={mr.mergeButton.disabled || mr.mergeButton.loading}
          onClick={handleMerge}
          loading={mr.mergeButton.loading}
        >
          {mr.mergeButton.label}
        </Button>
      )}
      {mr.rebaseButton.visible && (
        <Button
          variant="outline"
          color="neutral"
          size="sm"
          disabled={mr.rebaseButton.loading}
          onClick={handleRebase}
          loading={mr.rebaseButton.loading}
        >
          {mr.rebaseButton.label}
        </Button>
      )}
      {mr.autoMergeButton.visible && (
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <span>Auto-merge</span>
          <Switch
            checked={mr.autoMergeButton.isActive}
            onCheckedChange={(checked: boolean) => {
              if (checked) {
                handleAutoMerge?.();
              } else {
                handleCancelAutoMerge?.();
              }
            }}
          />
        </label>
      )}
    </div>
  );
}
