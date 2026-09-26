import * as React from 'react';
import { cn } from '@/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        filled: 'border-transparent',
        outline: 'bg-transparent',
        subtle: 'border-transparent',
        ghost: 'border-transparent',
        link: 'border-transparent underline-offset-4 [a&]:hover:underline',
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
        default: 'px-1.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    compoundVariants: [
      /* ── filled ──────────────────────────────────────────────── */
      {
        variant: 'filled',
        color: 'emphasis',
        class:
          'filled-emphasis [a&]:hover:bg-filled-emphasis-hover',
      },
      {
        variant: 'filled',
        color: 'merge',
        class:
          'filled-merge [a&]:hover:bg-filled-merge-hover',
      },
      {
        variant: 'filled',
        color: 'action',
        class: 'filled-action [a&]:hover:bg-action/90',
      },
      {
        variant: 'filled',
        color: 'positive',
        class: 'filled-positive [a&]:hover:bg-positive/90',
      },
      {
        variant: 'filled',
        color: 'negative',
        class:
          'filled-negative [a&]:hover:bg-negative-high',
      },
      {
        variant: 'filled',
        color: 'caution',
        class: 'filled-caution [a&]:hover:bg-caution/90',
      },
      {
        variant: 'filled',
        color: 'neutral',
        class:
          'filled-neutral [a&]:hover:bg-secondary/90',
      },

      /* ── outline ─────────────────────────────────────────────── */
      {
        variant: 'outline',
        color: 'emphasis',
        class: 'outline-emphasis [a&]:hover:bg-emphasis/15',
      },
      {
        variant: 'outline',
        color: 'merge',
        class: 'outline-merge [a&]:hover:bg-merge/15',
      },
      {
        variant: 'outline',
        color: 'action',
        class: 'outline-action [a&]:hover:bg-action/15',
      },
      {
        variant: 'outline',
        color: 'positive',
        class: 'outline-positive [a&]:hover:bg-positive/15',
      },
      {
        variant: 'outline',
        color: 'negative',
        class: 'outline-negative [a&]:hover:bg-negative/15',
      },
      {
        variant: 'outline',
        color: 'caution',
        class: 'outline-caution [a&]:hover:bg-caution/15',
      },
      {
        variant: 'outline',
        color: 'neutral',
        class:
          'outline-neutral bg-secondary/50 [a&]:hover:bg-secondary',
      },

      /* ── subtle ──────────────────────────────────────────────── */
      {
        variant: 'subtle',
        color: 'emphasis',
        class: 'subtle-emphasis [a&]:hover:bg-emphasis/35',
      },
      {
        variant: 'subtle',
        color: 'merge',
        class: 'subtle-merge [a&]:hover:bg-merge/35',
      },
      {
        variant: 'subtle',
        color: 'action',
        class: 'subtle-action [a&]:hover:bg-action/35',
      },
      {
        variant: 'subtle',
        color: 'positive',
        class: 'subtle-positive [a&]:hover:bg-positive/35',
      },
      {
        variant: 'subtle',
        color: 'negative',
        class: 'subtle-negative [a&]:hover:bg-negative/35',
      },
      {
        variant: 'subtle',
        color: 'caution',
        class: 'subtle-caution [a&]:hover:bg-caution/35',
      },
      {
        variant: 'subtle',
        color: 'neutral',
        class: 'subtle-neutral [a&]:hover:bg-neutral-hover',
      },

      /* ── ghost ───────────────────────────────────────────────── */
      {
        variant: 'ghost',
        color: 'neutral',
        class: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
      },
      {
        variant: 'ghost',
        color: 'emphasis',
        class: 'ghost-emphasis',
      },
      {
        variant: 'ghost',
        color: 'merge',
        class: 'ghost-merge',
      },
      {
        variant: 'ghost',
        color: 'action',
        class: 'ghost-action',
      },
      {
        variant: 'ghost',
        color: 'positive',
        class: 'ghost-positive',
      },
      {
        variant: 'ghost',
        color: 'negative',
        class: 'ghost-negative',
      },
      {
        variant: 'ghost',
        color: 'caution',
        class: 'ghost-caution',
      },

      /* ── link ────────────────────────────────────────────────── */
      { variant: 'link', color: 'emphasis', class: 'text-emphasis' },
      { variant: 'link', color: 'neutral', class: 'text-emphasis' },
    ],
    defaultVariants: {
      variant: 'filled',
      color: 'emphasis',
      size: 'default',
    },
  }
);

function Badge({
  className,
  variant = 'filled',
  color = 'emphasis',
  size,
  loading = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    loading?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'span';

  if (loading) {
    return (
      <span
        data-slot="badge"
        data-variant={variant}
        data-color={color}
        className={cn(
          'h-[25px] relative overflow-hidden',
          badgeVariants({ variant: 'filled', color: 'neutral', size }),
          'animate-pulse',
          className
        )}
        {...props}
      >
        {/* Invisible children to preserve intrinsic width */}
        <span className="invisible">{children}</span>
      </span>
    );
  }

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-color={color}
      className={cn(badgeVariants({ variant, color, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants };
