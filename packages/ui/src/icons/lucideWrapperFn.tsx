import type { LucideIcon, LucideProps } from 'lucide-react';

/**
 * The kit's icon prop surface. A superset of `{ size, color, className }`:
 * the full lucide/SVG prop set (`strokeWidth`, `style`, event handlers, any
 * SVG attribute) passes through, so callers can tune stroke weight or attach
 * a ref the same way they would on a bare lucide icon.
 */
export type IconProps = LucideProps;

/**
 * Adapts a lucide-react icon to the kit's registry: fixed defaults of
 * `size: 16` and `strokeWidth: 1.5` (lucide's own default is a heavier 2),
 * with `fill: 'none'` for the standard outline look. Pass
 * `{ filled: true }` for a solid glyph -- it fills with `currentColor` and
 * defaults the stroke color to the body text token.
 */
export const lucideWrapperFn =
  (Lucide: LucideIcon, options?: { filled?: boolean }) =>
  ({ size = 16, strokeWidth = 1.5, color, ...rest }: IconProps) => (
    <Lucide
      size={size}
      strokeWidth={strokeWidth}
      color={options?.filled ? 'var(--mantine-color-text)' : color}
      fill={options?.filled ? 'currentColor' : 'none'}
      {...rest}
    />
  );
