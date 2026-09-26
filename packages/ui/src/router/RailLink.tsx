import { Link, useLocation } from 'wouter';

import { RailEntry, type RailEntryProps } from '@mattstack/app-kit/core';
import { useShellRail } from '../app/shell-context';

export interface RailLinkProps extends Omit<
  RailEntryProps,
  'expanded' | 'onClick' | 'active' | 'component'
> {
  href: string;
  /** Defaults to an exact match of the current location against `href`. */
  active?: boolean;
}

export function RailLink({ href, active, ...entry }: RailLinkProps) {
  const rail = useShellRail();
  const [location] = useLocation();
  return (
    <RailEntry
      component={Link}
      href={href}
      expanded={rail.expanded}
      active={active ?? location === href}
      onClick={rail.close}
      {...entry}
    />
  );
}
