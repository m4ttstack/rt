import * as React from 'react';
import { cn } from '@/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        filled: '',
        outline: 'border bg-transparent',
        subtle: '',
        ghost: '',
        link: 'underline-offset-4 hover:underline',
      },
      color: {
        emphasis: '',
        merge: '',
        action: '',
        positive: '',
        negative: '',
        caution: '',
        neutral: '',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',

        /* ── compact — same font, reduced height & padding ────── */
        'compact-xs':
          "h-[22px] gap-1 rounded-md px-2 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        'compact-sm': 'h-[26px] gap-1 rounded-md px-2 text-xs has-[>svg]:px-2',
        'compact-md': 'h-[30px] gap-1.5 rounded-md px-3 has-[>svg]:px-2',
        'compact-lg': 'h-[34px] gap-1.5 rounded-md px-4 has-[>svg]:px-2',

        /* ── icon sizes ───────────────────────────────────────── */
        icon: 'size-9 p-1',
        'icon-xs': "size-6 p-1 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 p-1',
        'icon-lg': 'size-10 p-1',

        /* ── compact icon sizes ───────────────────────────────── */
        'compact-icon-xs':
          "size-5 p-1 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'compact-icon-sm': 'size-6 p-1 rounded-md',
        'compact-icon-md': 'size-7 p-1 rounded-md',
        'compact-icon-lg': 'size-8 p-1 rounded-md',
      },
    },
    compoundVariants: [
      /* ── filled ──────────────────────────────────────────────── */
      {
        variant: 'filled',
        color: 'emphasis',
        class:
          'filled-emphasis hover:bg-filled-emphasis-hover active:bg-filled-emphasis-pressed',
      },
      {
        variant: 'filled',
        color: 'merge',
        class:
          'filled-merge hover:bg-filled-merge-hover active:bg-filled-merge-pressed',
      },
      {
        variant: 'filled',
        color: 'action',
        class:
          'filled-action hover:bg-action-high active:bg-action-low',
      },
      {
        variant: 'filled',
        color: 'positive',
        class:
          'filled-positive hover:bg-positive-high active:bg-positive-low',
      },
      {
        variant: 'filled',
        color: 'negative',
        class:
          'filled-negative hover:bg-negative-high active:bg-negative-low',
      },
      {
        variant: 'filled',
        color: 'caution',
        class:
          'filled-caution hover:bg-caution-high active:bg-caution-low',
      },
      {
        variant: 'filled',
        color: 'neutral',
        class:
          'filled-neutral hover:bg-neutral-hover',
      },

      /* ── outline ─────────────────────────────────────────────── */
      {
        variant: 'outline',
        color: 'emphasis',
        class:
          'outline-emphasis hover:bg-emphasis/8 dark:hover:bg-emphasis/15',
      },
      {
        variant: 'outline',
        color: 'merge',
        class:
          'outline-merge hover:bg-merge/8 dark:hover:bg-merge/15',
      },
      {
        variant: 'outline',
        color: 'action',
        class:
          'outline-action hover:bg-action/8 dark:hover:bg-action/15',
      },
      {
        variant: 'outline',
        color: 'positive',
        class:
          'outline-positive hover:bg-positive/8 dark:hover:bg-positive/15',
      },
      {
        variant: 'outline',
        color: 'negative',
        class:
          'outline-negative hover:bg-negative/8 dark:hover:bg-negative/15',
      },
      {
        variant: 'outline',
        color: 'caution',
        class:
          'outline-caution hover:bg-caution/8 dark:hover:bg-caution/15',
      },
      {
        variant: 'outline',
        color: 'neutral',
        class:
          'outline-neutral shadow-xs hover:bg-foreground/8 dark:hover:bg-foreground/15 hover:text-accent-foreground',
      },

      /* ── subtle ──────────────────────────────────────────────── */
      {
        variant: 'subtle',
        color: 'emphasis',
        class: 'subtle-emphasis hover:bg-emphasis/35',
      },
      {
        variant: 'subtle',
        color: 'merge',
        class: 'subtle-merge hover:bg-merge/35',
      },
      {
        variant: 'subtle',
        color: 'action',
        class: 'subtle-action hover:bg-action/35',
      },
      {
        variant: 'subtle',
        color: 'positive',
        class: 'subtle-positive hover:bg-positive/35',
      },
      {
        variant: 'subtle',
        color: 'negative',
        class: 'subtle-negative hover:bg-negative/35',
      },
      {
        variant: 'subtle',
        color: 'caution',
        class: 'subtle-caution hover:bg-caution/35',
      },
      {
        variant: 'subtle',
        color: 'neutral',
        class: 'subtle-neutral hover:bg-neutral-hover',
      },

      /* ── ghost ───────────────────────────────────────────────── */
      {
        variant: 'ghost',
        color: 'neutral',
        class: 'hover:bg-neutral hover:text-accent-foreground',
      },
      {
        variant: 'ghost',
        color: 'emphasis',
        class: 'ghost-emphasis hover:bg-emphasis/15',
      },
      {
        variant: 'ghost',
        color: 'positive',
        class: 'ghost-positive hover:bg-positive/15',
      },
      {
        variant: 'ghost',
        color: 'negative',
        class: 'ghost-negative hover:bg-negative/15',
      },
      {
        variant: 'ghost',
        color: 'caution',
        class: 'ghost-caution hover:bg-caution/15',
      },
      {
        variant: 'ghost',
        color: 'action',
        class: 'ghost-action hover:bg-action/15',
      },
      {
        variant: 'ghost',
        color: 'merge',
        class: 'ghost-merge hover:bg-merge/15',
      },

      /* ── link ────────────────────────────────────────────────── */
      {
        variant: 'link',
        color: 'emphasis',
        class: 'text-emphasis dark:text-emphasis-bright px-0 py-1',
      },
      {
        variant: 'link',
        color: 'neutral',
        class: 'text-emphasis dark:text-emphasis-bright px-0 py-1',
      },
      {
        variant: 'link',
        color: 'positive',
        class: 'text-positive-bright px-0 py-1',
      },
      {
        variant: 'link',
        color: 'negative',
        class: 'text-negative-bright px-0 py-1',
      },
      {
        variant: 'link',
        color: 'caution',
        class: 'text-caution-bright px-0 py-1',
      },
      {
        variant: 'link',
        color: 'action',
        class: 'text-action-bright px-0 py-1',
      },
      { variant: 'link', color: 'merge', class: 'text-merge-bright px-0 py-1' },
    ],
    defaultVariants: {
      variant: 'filled',
      color: 'emphasis',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'filled',
  color = 'emphasis',
  size = 'default',
  skeleton = false,
  loading = false,
  asChild = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Skeleton placeholder — renders a pulsing neutral shell preserving children width.
     *  Use when the full UI is still loading and the button hasn't materialized yet. */
    skeleton?: boolean;
    /** Async action loading — shows a spinner and disables interaction.
     *  Use when the button has been clicked and an async operation is in progress. */
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  if (skeleton) {
    return (
      <span
        data-slot="button"
        className={cn(
          buttonVariants({ variant: 'filled', color: 'neutral', size }),
          'animate-pulse pointer-events-none',
          className
        )}
      >
        <span className="invisible">{children}</span>
      </span>
    );
  }

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-color={color}
      data-size={size}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, color, size, className }))}
      {...props}
    >
      <>
        {loading && (
          <svg
            className={cn(
              'animate-spin',
              size === 'xs' || size === 'compact-xs' || size === 'compact-sm'
                ? 'size-3'
                : 'size-4'
            )}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </>
    </Comp>
  );
}

export { Button, buttonVariants };
