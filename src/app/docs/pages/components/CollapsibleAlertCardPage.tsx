import { useState } from 'react';

import { CollapsibleAlertCard, SegmentedControl, Stack, Text } from '@ui/core';
import type { MantineColor } from '@ui/core';
import { Icon } from '@ui/icons';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { CollapsibleAlertCard } from '@ui/core';",
  '',
  '<CollapsibleAlertCard',
  '  title="Maintenance backlog"',
  '  subtitle="3 items are overdue for service"',
  '  color="orange"',
  '  icon={<Icon name="warning" size={22} />}',
  '>',
  '  <Text size="sm">',
  '    light_panel_a, tripod_a, and projector_2 have passed their service',
  '    dates. Schedule maintenance before the next checkout window.',
  '  </Text>',
  '</CollapsibleAlertCard>;',
].join('\n');

// Rows transcribed from
// src/ui/core/collapsible-alert-card/CollapsibleAlertCard.tsx
// (CollapsibleAlertCardProps).
const PROPS_ROWS = [
  {
    name: 'title',
    type: 'ReactNode',
    note: 'Required. The always-visible headline in the tinted header.',
  },
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. The collapsible body, hidden until the card opens.',
  },
  {
    name: 'subtitle?',
    type: 'ReactNode',
    note: 'Dimmed summary line under the title -- the "closed" pitch for opening the card.',
  },
  {
    name: 'icon',
    type: 'ReactNode',
    note: 'Required. Leading icon, tinted with the accent color.',
  },
  {
    name: 'color?',
    type: 'MantineColor',
    note: "Accent for the border, header tint, and icon. Any Mantine color (via CSS custom properties, not a hardcoded palette). Default 'indigo'.",
  },
  {
    name: 'opened? / defaultOpened? / onChange?',
    type: 'boolean / boolean / (opened) => void',
    note: "Controlled/uncontrolled open state (Mantine's useUncontrolled bridge). defaultOpened defaults to false.",
  },
  {
    name: '...rest',
    type: 'CardProps',
    note: 'Passthrough to the wrapping Card; radius defaults to md, withBorder to true (the border doubles to 2px to carry the accent).',
  },
];

function CollapsibleAlertCardDemo() {
  const [color, setColor] = useState<MantineColor>('orange');

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={color}
        onChange={value => setColor(value as MantineColor)}
        data={['indigo', 'orange', 'red', 'teal']}
        w="fit-content"
      />
      <CollapsibleAlertCard
        title="Maintenance backlog"
        subtitle="3 items are overdue for service"
        color={color}
        icon={<Icon name="warning" size={22} />}
      >
        <Text size="sm">
          light_panel_a, tripod_a, and projector_2 have passed their service
          dates. Schedule maintenance before the next checkout window so they do
          not go out in a broken state.
        </Text>
      </CollapsibleAlertCard>
    </Stack>
  );
}

export function CollapsibleAlertCardPage() {
  return (
    <ComponentDoc
      title="CollapsibleAlertCard"
      lead="An alert-tinted card with a chevron-toggled collapsible body -- a colored callout that can hide most of its content behind a summary line until the reader opens it."
      demoIntro="Click anywhere on the tinted header (or the chevron) to toggle the body; the segmented control swaps the accent color live."
      demo={<CollapsibleAlertCardDemo />}
      usage={USAGE}
      usageMinHeight={310}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The whole header row is the click target (it forwards to the chevron
          button, so keyboard and screen-reader users get one real toggle
          control). The accent generalizes to any Mantine color through CSS
          custom properties -- the header tint uses the color&apos;s calm -light
          / -light-hover pair, the border its 3 shade. The body toggle is an
          instant mount/unmount rather than an animated height transition:
          snappier for a compact card, and deterministic under test.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
