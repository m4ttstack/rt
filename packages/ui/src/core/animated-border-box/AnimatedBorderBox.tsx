import { Paper } from '@mantine/core';
import type { MantineColor, PaperProps } from '@mantine/core';
import clsx from 'clsx';

import classes from './AnimatedBorderBox.module.css';

export interface AnimatedBorderBoxProps extends Omit<
  PaperProps,
  'children' | 'style'
> {
  children: React.ReactNode;
  style?: React.CSSProperties;
  /** Renders `children` unwrapped when `false`. @default true */
  enabled?: boolean;
  /** Runs the spin animation forever vs. once. @default true */
  loop?: boolean;
  /** Primary/secondary colors of the border gradient. @default ['indigo', 'pink'] */
  colors?: [MantineColor, MantineColor];
  /** Shade index for both colors (the secondary uses `shade - 1`). @default 3 */
  shade?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/**
 * A `Paper` with a slowly-rotating conic-gradient border -- an animated
 * border ornament, typically used to draw attention to a promoted card or
 * callout.
 *
 * CSS-only, no `motion` dependency: the rotation is a `@property
 * --border-angle` (registered in `AnimatedBorderBox.module.css`) animated
 * through a `background-position`-free `conic-gradient(from
 * var(--border-angle), ...)` -- a real CSS custom-property animation, fully
 * expressible without JS-driven frames.
 *
 * Only the two color custom properties (`--abb-primary`/`--abb-secondary`)
 * are instance-specific, passed as plain inline `style` custom properties
 * and read by the static stylesheet. The pair comes from the `colors`
 * tuple (formerly separate `primaryColor`/`secondaryColor` props -- renamed
 * to the kit's shared accent-prop convention, AGENTS.md section 4), while
 * `shade` stays its own prop: it tunes both stops against the scheme
 * rather than picking the accent identity. The interior fill is a single static
 * surface (only the border ring animates), defaulting to this kit's
 * `--ui-bg-2` surface slot and exposed as the `--abb-fill` custom
 * property -- pass it through `style` to re-point the fill, e.g. when the
 * app remaps the `--ui-bg-*` slots to role-based surfaces (see AGENTS.md
 * section 4).
 */
export function AnimatedBorderBox({
  children,
  enabled = true,
  loop = true,
  colors = ['indigo', 'pink'],
  shade = 3,
  style,
  className,
  ...paperProps
}: AnimatedBorderBoxProps) {
  if (!enabled) return <>{children}</>;

  const [primaryColor, secondaryColor] = colors;

  return (
    <Paper
      p={0}
      bd="solid 3px transparent"
      className={clsx(classes.animatedBorderBox, className)}
      style={
        {
          overflow: 'hidden',
          animationIterationCount: loop ? 'infinite' : 1,
          '--abb-primary': `var(--mantine-color-${primaryColor}-${shade})`,
          '--abb-secondary': `var(--mantine-color-${secondaryColor}-${shade - 1})`,
          ...style,
        } as unknown as React.CSSProperties
      }
      {...paperProps}
    >
      {children}
    </Paper>
  );
}
