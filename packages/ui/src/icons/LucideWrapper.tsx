import type { LucideIcon } from 'lucide-react';

import type { IconProps } from './types';

type LucideWrapperProps = IconProps & {
  icon: LucideIcon;
  /** Solid glyph (fills with currentColor, stroke defaults to body text). */
  filled?: boolean;
};

// Component form of lucideWrapperFn, for wrapping a lucide icon inline
// (e.g. one-off usage, or a dynamically-chosen lucide component) instead
// of pre-creating a named registry entry. Matches the registry defaults:
// size 16, strokeWidth 1.5, fill none (or currentColor when `filled`).
export const LucideWrapper = ({
  icon: LucideIconComponent,
  size = 16,
  strokeWidth = 1.5,
  color,
  filled = false,
  ...rest
}: LucideWrapperProps) => (
  <LucideIconComponent
    size={size}
    strokeWidth={strokeWidth}
    color={filled ? 'var(--mantine-color-text)' : color}
    fill={filled ? 'currentColor' : 'none'}
    {...rest}
  />
);
