import { forwardRef } from 'react';
import type { MantineColor } from '@mantine/core';

export interface GradientBorderProps extends Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'color'
> {
  children: React.ReactNode;
  /** Renders `children` unwrapped when `false`. @default true */
  enabled?: boolean;
  /** Left/mid/right colors of the border gradient. @default ['indigo', 'grape', 'pink'] */
  colors?: [MantineColor, MantineColor, MantineColor];
  /** Corner radius in px, shared by the outer border and inner content. @default 10 */
  radius?: number;
  /**
   * Background of the inner content box. Defaults to the kit's `bg.level2`
   * surface slot so only the 2px gradient ring shows around the children;
   * pass any CSS color/token to re-surface, or `'transparent'` to let the
   * children bring their own surface.
   * @default 'var(--ui-bg-2)'
   */
  innerBg?: string;
}

/**
 * Wraps `children` in a thin (2px) three-color linear-gradient border: a
 * gradient-filled outer `div` with 2px padding, whose inner box covers
 * everything but that 2px ring with its own surface. The inner surface
 * defaults to the kit's `bg.level2` slot (`--ui-bg-2`) and is overridable
 * via `innerBg`, so the component delivers a gradient ring around a normal
 * card surface out of the box instead of flooding gradient behind
 * surface-less children.
 *
 * Theme colors are resolved through Mantine's generated
 * `--mantine-color-{name}-{shade}` CSS variables, with no hardcoded values.
 */
export const GradientBorder = /* @__PURE__ */ forwardRef<
  HTMLDivElement,
  GradientBorderProps
>(function GradientBorder(
  {
    children,
    enabled = true,
    colors = ['indigo', 'grape', 'pink'],
    radius = 10,
    innerBg = 'var(--ui-bg-2)',
    style,
    ...rest
  },
  ref
) {
  if (!enabled) return <>{children}</>;

  const [first, second, third] = colors;

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        padding: 2,
        borderRadius: radius,
        background: `linear-gradient(86deg, var(--mantine-color-${first}-4) 0%, var(--mantine-color-${second}-4) 50%, var(--mantine-color-${third}-4) 100%)`,
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      <div style={{ borderRadius: radius, background: innerBg }}>
        {children}
      </div>
    </div>
  );
});
