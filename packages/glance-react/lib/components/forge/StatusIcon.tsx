/**
 * Shared status icon — renders any icon inside a colored circle.
 * Also exports ExpandChevron used by popover triggers.
 */

import { cn } from '@/utils';

import { ExpandIcon } from './icons';

// ── StatusIcon ─────────────────────────────────────────────────────────────────

type StatusColor = 'positive' | 'negative' | 'caution' | 'emphasis' | 'neutral';

const STATUS_STYLES: Record<StatusColor, string> = {
  positive: 'subtle-positive-high',
  negative: 'subtle-negative-high',
  caution: 'subtle-caution-high',
  emphasis: 'subtle-emphasis-high',
  neutral: 'subtle-neutral-high',
};

export function StatusIcon({
  icon: Icon,
  color,
  spin,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: StatusColor;
  spin?: boolean;
}) {
  return (
    <div
      className={cn(
        'size-5 rounded-full flex items-center justify-center shrink-0',
        STATUS_STYLES[color]
      )}
    >
      <Icon
        className={cn('size-3', spin && 'animate-spin')}
      />
    </div>
  );
}

// ── ExpandChevron ──────────────────────────────────────────────────────────────
// The chevron that appears on hover and rotates when a popover is open.
// Must be inside a `group` parent (the PopoverTrigger row).

export function ExpandChevron() {
  return (
    <ExpandIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-data-[state=open]:opacity-100 group-data-[state=open]:rotate-90 transition-all duration-150" />
  );
}
