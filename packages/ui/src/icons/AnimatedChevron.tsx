import clsx from 'clsx';

import classes from './AnimatedChevron.module.css';
import { Icons } from './Icons';
import type { IconProps } from './types';

export type AnimatedChevronProps = IconProps & { opened: boolean };

// A chevronDown that rotates 180deg (via CSS transition) when `opened` is
// true -- the disclosure indicator used by collapsible sections, selects,
// accordions, etc.
export const AnimatedChevron = ({
  opened,
  className,
  ...props
}: AnimatedChevronProps) => (
  <Icons.chevronDown
    className={clsx(classes.chevron, opened && classes.opened, className)}
    {...props}
  />
);
