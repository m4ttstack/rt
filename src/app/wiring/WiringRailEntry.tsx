import { useShellRail } from '@mattstack/app-kit/app';
import { Indicator } from '@mattstack/app-kit/core';
import { Link, RailLink } from '@mattstack/app-kit/router';

import { WIRING_ATTENTION_HREF, WIRING_HREF } from './attentionFilter';
import { useAttentionCount } from './useWiring';

export interface WiringRailEntryProps {
  active: boolean;
}

/**
 * The Wiring rail entry plus the count of rows needing attention. `RailLink`
 * carries the entry to /wiring and closes the rail on click; the count rides
 * an `Indicator` whose label is its own link to the attention-filtered view,
 * closing the rail through the shell context so a mobile tap doesn't leave
 * the overlay open behind the filtered page.
 */
export function WiringRailEntry({ active }: WiringRailEntryProps) {
  const count = useAttentionCount();
  const { close } = useShellRail();

  const entry = (
    <RailLink icon="zap" label="Wiring" href={WIRING_HREF} active={active} />
  );

  if (count === 0) return entry;

  return (
    <Indicator
      color="warn"
      size={16}
      offset={6}
      position="top-end"
      label={
        <Link
          href={WIRING_ATTENTION_HREF}
          onClick={close}
          aria-label={`${count} need attention — show only those`}
          data-testid="drift-badge"
          style={{
            color: 'inherit',
            font: 'inherit',
            textDecoration: 'none',
            padding: '0 2px',
          }}
        >
          {count}
        </Link>
      }
    >
      {entry}
    </Indicator>
  );
}
