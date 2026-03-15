import { Badge } from '@/components/ui/badge';
import { cn } from '@/utils';

import {
  DisconnectedIconAlt,
  SpinnerIcon,
} from './icons';

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

export interface ConnectionStatusBadgeProps {
  /** Current connection state from useDashboard. */
  status: ConnectionState;
  /** Show badge when connected? Defaults to false (badge is hidden when healthy). */
  showWhenConnected?: boolean;
  /** Override the default badge variant for this status. */
  variant?: React.ComponentProps<typeof Badge>['variant'];
  /** Badge size. @default 'default' */
  size?: React.ComponentProps<typeof Badge>['size'];
  className?: string;
}

const STATUS_CONFIG: Record<
  ConnectionState,
  {
    label: string;
    color: 'neutral' | 'positive' | 'negative' | 'caution';
    variant: 'filled' | 'subtle';
    pulse?: boolean;
    dot?: boolean;
  }
> = {
  connecting: {
    label: 'Connecting\u2026',
    color: 'neutral',
    variant: 'subtle',
    pulse: true,
  },
  connected: {
    label: 'Connected',
    color: 'positive',
    variant: 'subtle',
    dot: true,
  },
  reconnecting: {
    label: 'Reconnecting\u2026',
    color: 'caution',
    variant: 'subtle',
    pulse: true,
  },
  disconnected: {
    label: 'Disconnected',
    color: 'negative',
    variant: 'filled',
  },
};

/**
 * Compact connection health badge for real-time dashboards.
 *
 * Hidden by default when `status === 'connected'` (set `showWhenConnected` to override).
 *
 * @example
 * const { connectionStatus } = useDashboard({ ... });
 * <ConnectionStatusBadge status={connectionStatus} />
 */
export function ConnectionStatusBadge({
  status,
  showWhenConnected = false,
  variant,
  size,
  className,
}: ConnectionStatusBadgeProps) {
  if (status === 'connected' && !showWhenConnected) return null;

  const config = STATUS_CONFIG[status];

  return (
    <Badge
      variant={variant ?? config.variant}
      color={config.color}
      size={size}
      className={cn(
        'gap-1.5 text-xs font-normal',
        config.pulse && 'animate-pulse',
        className
      )}
    >
      {config.dot && (
        <span
          className={cn(
            'size-1.5 rounded-full shrink-0',
            status === 'connected' && 'bg-positive',
            status === 'disconnected' && 'bg-negative-foreground'
          )}
        />
      )}
      {(status === 'reconnecting' || status === 'connecting') && (
        <SpinnerIcon className="size-3 animate-spin shrink-0" />
      )}
      {status === 'disconnected' && (
        <DisconnectedIconAlt className="size-4! shrink-0" />
      )}
      {config.label}
    </Badge>
  );
}
