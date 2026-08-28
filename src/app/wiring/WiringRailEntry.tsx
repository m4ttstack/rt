import { Link } from 'wouter';

import { Indicator, RailEntry } from '@mattstack/app-kit/core';
import { WIRING_ATTENTION_HREF, WIRING_HREF } from './attentionFilter';
import { useAttentionCount } from './useWiring';

export interface WiringRailEntryProps {
  expanded: boolean;
  active: boolean;
  onClick: () => void;
}

/**
 * The Wiring rail entry, plus the count of rows that need attention.
 *
 * `RailEntry` takes no badge and renders no children, and `src/ui/**` is
 * kit-owned -- so the count rides an `Indicator` wrapped around the entry.
 * Indicator renders its label as a SIBLING of the wrapped element rather
 * than inside it, which is what lets the badge be its own link without
 * nesting one anchor in another: the entry goes to the spine, the badge goes
 * to the spine already filtered.
 */
export function WiringRailEntry({
  expanded,
  active,
  onClick,
}: WiringRailEntryProps) {
  const count = useAttentionCount();

  const entry = (
    <RailEntry
      icon="zap"
      label="Wiring"
      component={Link}
      href={WIRING_HREF}
      expanded={expanded}
      active={active}
      onClick={onClick}
    />
  );

  // A badge that is always present stops being a signal and becomes chrome,
  // so zero renders no Indicator at all -- not a hidden or empty one.
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
          onClick={onClick}
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
