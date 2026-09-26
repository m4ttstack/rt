import { cn } from '@/utils';
import { Button } from '@/components/ui/button';
import { AlertIcon } from './icons';

export interface MRCardErrorProps {
  /** The error to display. */
  error: Error;
  /** Called when the user clicks "Retry". */
  onRetry?: () => void;
  /** Visual variant. @default 'standalone' */
  variant?: 'standalone' | 'inline';
  className?: string;
}

/**
 * Error banner for MR dashboard components.
 *
 * - `standalone` — replaces the card entirely (bordered container)
 * - `inline` — slim banner inside an existing card
 *
 * @example
 * const { mr, error } = useDashboard({ ... });
 * if (error) return <MRCardError error={error} onRetry={() => refetch()} />;
 * return <MRCard mr={mr!} />;
 */
export function MRCardError({
  error,
  onRetry,
  variant = 'standalone',
  className,
}: MRCardErrorProps) {
  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-xs',
          'subtle-negative border-t border-negative/20',
          className
        )}
      >
        <AlertIcon className="size-3.5 shrink-0" />
        <span className="flex-1 min-w-0 truncate">{error.message}</span>
        {onRetry && (
          <Button
            variant="ghost"
            color="negative"
            size="compact-xs"
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-negative/30 subtle-negative p-4 flex flex-col items-center gap-3 text-center',
        className
      )}
    >
      <div className="size-10 rounded-full subtle-negative-high flex items-center justify-center">
        <AlertIcon className="size-5 text-negative" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Something went wrong</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[32ch]">
          {error.message}
        </p>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          color="negative"
          size="sm"
          onClick={onRetry}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
