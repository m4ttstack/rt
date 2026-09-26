import * as React from 'react';
import { cn } from '@/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const flexVariants = cva('flex', {
  variants: {
    gap: {
      0: 'gap-0',
      0.5: 'gap-0.5',
      1: 'gap-1',
      1.5: 'gap-1.5',
      2: 'gap-2',
      3: 'gap-3',
      4: 'gap-4',
      5: 'gap-5',
      6: 'gap-6',
      8: 'gap-8',
    },
    justify: {
      start: 'justify-start',
      end: 'justify-end',
      center: 'justify-center',
      between: 'justify-between',
      around: 'justify-around',
      evenly: 'justify-evenly',
    },
    align: {
      start: 'items-start',
      end: 'items-end',
      center: 'items-center',
      baseline: 'items-baseline',
      stretch: 'items-stretch',
    },
    wrap: {
      true: 'flex-wrap',
      false: '',
    },
  },
});

type FlexVariants = VariantProps<typeof flexVariants>;

type FlexProps = React.ComponentProps<'div'> &
  FlexVariants & {
    /** Apply `truncate` so the container can clip overflowing content. */
    truncate?: boolean;
  };

function Row({
  gap = 2,
  justify,
  align = 'center',
  wrap,
  truncate,
  className,
  ...props
}: FlexProps) {
  return (
    <div
      data-slot="row"
      className={cn(
        flexVariants({ gap, justify, align, wrap }),
        'flex-row',
        truncate && 'truncate',
        className
      )}
      {...props}
    />
  );
}

function Stack({
  gap = 2,
  justify,
  align,
  wrap,
  truncate,
  className,
  ...props
}: FlexProps) {
  return (
    <div
      data-slot="column"
      className={cn(
        flexVariants({ gap, justify, align, wrap }),
        'flex-col',
        truncate && 'truncate',
        className
      )}
      {...props}
    />
  );
}

export { Row, Stack, flexVariants };
export type { FlexProps };
