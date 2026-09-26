import { cn } from '@/utils';

/**
 * Skeleton — shadcn-style animated placeholder for loading states.
 *
 * Renders a rounded `div` with a pulsing animation.
 * Size and shape are controlled via className.
 *
 * @example
 * <Skeleton className="h-4 w-48" />        // text line
 * <Skeleton className="size-8 rounded-full" /> // avatar
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
