import * as React from 'react';
import { Button, type buttonVariants } from '@/components/ui/button';
import { cn } from '@/utils';
import type { VariantProps } from 'class-variance-authority';

type ButtonVariants = VariantProps<typeof buttonVariants>;

export interface IconButtonProps
  extends Omit<React.ComponentProps<'button'>, 'color'> {
  /** Visual variant — same as Button. @default 'ghost' */
  variant?: ButtonVariants['variant'];
  /** Color — same as Button. @default 'neutral' */
  color?: ButtonVariants['color'];
  /** Size — mapped to icon sizes. @default 'default' */
  size?: 'xs' | 'sm' | 'default' | 'lg' | 'compact-xs' | 'compact-sm' | 'compact-md' | 'compact-lg';
  /** Required for accessibility — describes the action for screen readers. */
  'aria-label': string;
  /** Render as a child (Slot) instead of a native button. */
  asChild?: boolean;
  /** Skeleton placeholder — pulsing neutral shell while UI loads. */
  skeleton?: boolean;
  /** Async loading — replaces icon with a spinner and disables interaction. */
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
}

const SIZE_MAP = {
  xs: 'icon-xs',
  sm: 'icon-sm',
  default: 'icon',
  lg: 'icon-lg',
  'compact-xs': 'compact-icon-xs',
  'compact-sm': 'compact-icon-sm',
  'compact-md': 'compact-icon-md',
  'compact-lg': 'compact-icon-lg',
} as const;

const SPINNER_SIZE: Record<string, string> = {
  xs: 'size-3',
  sm: 'size-4',
  default: 'size-4',
  lg: 'size-5',
  'compact-xs': 'size-3',
  'compact-sm': 'size-3',
  'compact-md': 'size-4',
  'compact-lg': 'size-4',
};

/**
 * Square icon-only button — wraps `Button` with icon sizing.
 *
 * Supports `skeleton` (pulsing placeholder) and `loading` (spinner replaces icon).
 * `aria-label` is required for accessibility.
 */
export function IconButton({
  variant = 'ghost',
  color = 'neutral',
  size = 'default',
  skeleton,
  loading,
  asChild,
  disabled,
  children,
  ...props
}: IconButtonProps) {
  if (skeleton) {
    return (
      <Button
        variant="filled"
        color="neutral"
        size={SIZE_MAP[size]}
        skeleton
        {...props}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      variant={variant ?? 'ghost'}
      color={color ?? 'neutral'}
      size={SIZE_MAP[size]}
      disabled={disabled || loading}
      asChild={asChild}
      {...props}
    >
      {loading ? (
        <svg
          className={cn('animate-spin', SPINNER_SIZE[size])}
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        children
      )}
    </Button>
  );
}
