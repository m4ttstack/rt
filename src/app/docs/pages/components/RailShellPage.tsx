import { useState } from 'react';

import {
  Anchor,
  Box,
  Rail,
  RAIL_WIDTH,
  RAIL_WIDTH_EXPANDED,
  RailEntry,
  Text,
} from '@ui/core';
import { PAGE_SHELL_DEMO_PATH } from '../../../demo/paths';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

// Trimmed from the site's own chrome wiring (src/app/chrome/AppChrome.tsx)
// -- the same recipe the App chrome guide walks end-to-end.
const USAGE = [
  "import { Rail, RailEntry, RailShell, useRailState } from '@ui/core';",
  '',
  'function AppChrome({ children }: { children: React.ReactNode }) {',
  '  const rail = useRailState();',
  '',
  '  return (',
  '    <RailShell',
  '      headerHeight={64}',
  '      header={<Wordmark />}',
  '      rail={',
  '        <Rail',
  '          label="Site sections"',
  '          expanded={rail.effectiveExpanded}',
  '          onToggleExpanded={rail.toggleExpanded}',
  '        >',
  '          <RailEntry',
  '            icon="bookOpen"',
  '            label="Docs"',
  '            component={Link}',
  '            href="/docs"',
  '            expanded={rail.effectiveExpanded}',
  '            active',
  '            onClick={rail.close}',
  '          />',
  '        </Rail>',
  '      }',
  '      railExpanded={rail.effectiveExpanded}',
  '      railOpened={rail.opened}',
  '      onToggleRail={rail.toggleOpened}',
  '      onCloseRail={rail.close}',
  '    >',
  '      {/* host a PageShell here -- topOffset defaults to headerHeight */}',
  '      {children}',
  '    </RailShell>',
  '  );',
  '}',
].join('\n');

// Rows transcribed from src/ui/core/rail-shell/RailShell.tsx (RailShellProps).
const RAIL_SHELL_ROWS = [
  {
    name: 'headerHeight',
    type: 'number',
    note: 'Required. Height of the fixed chrome header, in px.',
  },
  {
    name: 'header',
    type: 'ReactNode',
    note: 'Required. Header content, rendered after the mobile rail toggle.',
  },
  {
    name: 'rail',
    type: 'ReactNode',
    note: 'Required. Rail content riding the navbar slot (typically a Rail of RailEntrys).',
  },
  {
    name: 'railExpanded',
    type: 'boolean',
    note: "Required. Whether the rail shows its labeled, expanded width. Pass useRailState's effectiveExpanded.",
  },
  {
    name: 'railOpened',
    type: 'boolean',
    note: 'Required. Whether the mobile rail is open (no effect from sm up).',
  },
  {
    name: 'onToggleRail / onCloseRail',
    type: '() => void',
    note: "Required. The mobile open/close pair; wire to useRailState's toggleOpened/close.",
  },
  {
    name: 'railWidth?',
    type: 'number',
    note: 'Slim rail width in px. Default RAIL_WIDTH (68).',
  },
  {
    name: 'railWidthExpanded?',
    type: 'number',
    note: 'Expanded rail width in px. Default RAIL_WIDTH_EXPANDED (260).',
  },
  {
    name: 'headerProps?',
    type: 'AppShellHeaderProps',
    note: "Extra AppShell.Header props; the shell's own mobile z-index handling wins over a caller zIndex.",
  },
  {
    name: 'headerPx?',
    type: "GroupProps['px']",
    note: "Horizontal padding of the header row. Default 'md'.",
  },
];

// Rows transcribed from src/ui/core/rail-shell/Rail.tsx (RailProps).
const RAIL_ROWS = [
  {
    name: 'label',
    type: 'string',
    note: "Required. Accessible name of the rail's nav landmark.",
  },
  {
    name: 'expanded',
    type: 'boolean',
    note: 'Required. Whether the rail is showing its labeled, expanded state (pass effectiveExpanded).',
  },
  {
    name: 'onToggleExpanded',
    type: '() => void',
    note: 'Required. Wired to the built-in desktop-only expand trigger.',
  },
  {
    name: 'expandLabel? / collapseLabel?',
    type: 'string',
    note: "Tooltip and aria-labels of the expand trigger. Defaults 'Expand navigation' / 'Collapse navigation'.",
  },
  {
    name: 'pinBottom?',
    type: 'ReactNode',
    note: "Entry pinned to the rail's bottom via a flex spacer (e.g. a color-scheme toggle). Pinning stretches the rail to 100dvh, assuming RailShell's full-height navbar.",
  },
];

// Rows transcribed from src/ui/core/rail-shell/RailEntry.tsx (RailEntryProps).
const RAIL_ENTRY_ROWS = [
  {
    name: 'icon',
    type: 'IconName',
    note: "Required. The entry's icon, from the kit's icon registry.",
  },
  {
    name: 'label',
    type: 'string',
    note: 'Required. Tooltip while slim, slide-in text once expanded, and the accessible name in both states.',
  },
  {
    name: 'expanded',
    type: 'boolean',
    note: 'Required. Same effectiveExpanded as the parent Rail.',
  },
  {
    name: 'active?',
    type: 'boolean',
    note: 'Highlights the entry (filled icon, aria-current="page").',
  },
  {
    name: 'disabled?',
    type: 'boolean',
    note: "Renders the icon dimmed and suppresses onClick; a linked entry's own navigation is not intercepted.",
  },
  {
    name: 'component? / href?',
    type: 'polymorphic',
    note: 'Router-agnostic linking via Mantine\'s polymorphic component prop (component={Link} href="/docs"). Typed routers: wrap through createLink() (AGENTS.md section 10).',
  },
];

// Rows transcribed from src/ui/core/rail-shell/useRailState.ts.
const USE_RAIL_STATE_ROWS = [
  {
    name: 'defaultExpanded?',
    type: 'boolean',
    note: 'Option: start with the desktop rail expanded. Default false.',
  },
  {
    name: 'opened',
    type: 'boolean',
    note: 'Returned: mobile-open state (the header toggle / overlay dismissal pair).',
  },
  {
    name: 'expanded',
    type: 'boolean',
    note: 'Returned: the desktop expand-toggle state, untouched by mobile opens.',
  },
  {
    name: 'effectiveExpanded',
    type: 'boolean',
    note: "Returned: what the rail should actually render -- expanded, or forced true while mobile-open (the expand-then-open rule). Pass to RailShell's railExpanded and Rail/RailEntry's expanded.",
  },
  {
    name: 'toggleOpened / close / toggleExpanded',
    type: '() => void',
    note: 'Returned: the state transitions. Neither state persists across visits.',
  },
];

/** A Rail + RailEntrys in a plain width-animating box standing in for the
 * shell's navbar slot, so the expand/collapse interaction is tryable
 * inline. */
function RailDemo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <Box
      w={expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH}
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        overflow: 'hidden',
        transition: 'width 200ms ease',
      }}
    >
      <Rail
        label="Demo rail"
        expanded={expanded}
        onToggleExpanded={() => setExpanded(current => !current)}
      >
        <RailEntry
          icon="package"
          label="Inventory"
          expanded={expanded}
          active
        />
        <RailEntry icon="users" label="Borrow requests" expanded={expanded} />
        <RailEntry
          icon="wrench"
          label="Maintenance"
          expanded={expanded}
          disabled
        />
      </Rail>
    </Box>
  );
}

export function RailShellPage() {
  return (
    <ComponentDoc
      title="RailShell"
      lead="The mini icon rail app chrome, as a compound family: RailShell (a SiteShell in its alt layout whose navbar is the rail), Rail (the nav container with the desktop expand trigger), RailEntry (one icon entry), and useRailState (the open/expand wiring). They only exist together."
      demoIntro={
        <>
          A live Rail of RailEntrys, with the expand trigger animating between
          the slim ({RAIL_WIDTH}px) and labeled ({RAIL_WIDTH_EXPANDED}px)
          widths. In a real app RailShell owns the widths and the mobile
          behavior -- the chrome around these docs is the full thing running
          live.
        </>
      }
      demo={<RailDemo />}
      usage={USAGE}
      usageMinHeight={760}
      propsTables={[
        { title: 'RailShell props', rows: RAIL_SHELL_ROWS },
        { title: 'Rail props', rows: RAIL_ROWS },
        {
          title: 'RailEntry props',
          intro:
            'Extends UnstyledButtonProps; plain-button by default, linked via the polymorphic component prop.',
          rows: RAIL_ENTRY_ROWS,
        },
        { title: 'useRailState', rows: USE_RAIL_STATE_ROWS },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Host a PageShell in children for the double-nav geometry (rail and
          page sidebar collapse independently). It needs no topOffset: this
          shell publishes its headerHeight on context and a hosted PageShell
          defaults to it, so the two cannot drift apart. On mobile the rail collapses behind a header
          toggle and opens already expanded over a click-to-close overlay --
          useRailState&apos;s expand-then-open rule. The z-index contract (rail
          5, PageShell root 10, header 100, overlay 999, mobile-open chrome
          1000) is kept internal to RailShell.
        </Text>
        <Text size="sm" c="dimmed">
          The{' '}
          <Anchor
            component={Link}
            href={docsPath('app-chrome')}
            size="sm"
            fw={500}
          >
            App chrome guide
          </Anchor>{' '}
          walks the full recipe including the layering table and mobile
          behavior, and the{' '}
          <Anchor
            component={Link}
            href={PAGE_SHELL_DEMO_PATH}
            size="sm"
            fw={500}
          >
            full-screen demo
          </Anchor>{' '}
          shows the finished geometry taking over the viewport.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
