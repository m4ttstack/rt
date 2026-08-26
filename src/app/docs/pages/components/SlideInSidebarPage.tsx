import { useState } from 'react';

import { Box, Group, SlideInSidebar, Stack, Switch, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { SlideInSidebar } from '@ui/core';",
  '',
  '// An in-flow rail animating its width between `width` and 0,',
  '// keeping content mounted while closed.',
  '<SlideInSidebar opened={opened} width={220}>',
  '  {railContent}',
  '</SlideInSidebar>;',
  '',
  '// For an overlay panel that slides in OVER the page and closes on',
  "// outside-click/Escape, use Mantine's Drawer directly:",
  '<Drawer opened={opened} onClose={close} title="Details">',
  '  {panelContent}',
  '</Drawer>;',
].join('\n');

// Rows transcribed from src/ui/core/slide-in-sidebar/SlideInSidebar.tsx.
const ROWS = [
  {
    name: 'opened',
    type: 'boolean',
    note: 'Required. The rail animates its width between width and 0; content stays mounted while closed (faded out and pointer-inert) so reopening is instant.',
  },
  {
    name: 'width',
    type: 'string | number',
    note: "Required. The rail's open width -- the collapse animates against it.",
  },
  {
    name: 'trigger?',
    type: 'ReactNode',
    note: 'Floating control centered on the rail\'s inner edge, riding the edge as it slides. Positioned against the rail itself, so pass pos="relative" when using this slot.',
  },
  {
    name: 'side?',
    type: "'left' | 'right'",
    note: "Which layout edge the rail sits on; the hairline (and trigger) mirror with it. Default 'left'.",
  },
  {
    name: 'border?',
    type: 'boolean',
    note: "Whether the hairline is drawn on the rail's inner edge. Set false for a borderless rail. Default true.",
  },
  {
    name: '...rest',
    type: 'BoxProps',
    note: 'Passthrough to the rail Stack.',
  },
];

function SlideInSidebarDemo() {
  const [opened, setOpened] = useState(true);

  return (
    <Stack gap="md">
      <Switch
        label="Rail open"
        checked={opened}
        onChange={event => setOpened(event.currentTarget.checked)}
      />

      <Group
        gap={0}
        align="stretch"
        wrap="nowrap"
        h={160}
        style={{
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-md)',
          overflow: 'hidden',
        }}
      >
        <SlideInSidebar opened={opened} width={200} bg="var(--ui-bg-2)">
          <Stack gap={4} p="sm">
            <Text size="sm" fw={600}>
              Inline rail
            </Text>
            <Text size="xs" c="dimmed">
              In-flow, width animates to 0; content stays mounted while closed.
            </Text>
          </Stack>
        </SlideInSidebar>
        <Box p="sm" flex={1}>
          <Text size="sm" c="dimmed">
            Page content reclaims the space as the rail collapses.
          </Text>
        </Box>
      </Group>
    </Stack>
  );
}

export function SlideInSidebarPage() {
  return (
    <ComponentDoc
      title="SlideInSidebar"
      lead="An in-flow collapsible rail: animates its width between width and 0 instead of overlaying the page, keeping content mounted while closed, with an optional floating trigger riding its inner edge."
      demo={<SlideInSidebarDemo />}
      usage={USAGE}
      usageMinHeight={280}
      propsTables={[{ title: 'Props', rows: ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          This is deliberately not an overlay: a panel that slides in over the
          page and closes on outside-click/Escape is exactly what Mantine&apos;s
          Drawer already is, so the kit doesn&apos;t wrap it -- use Drawer
          directly for that. SlideInSidebar is the collapsible-sidebar half of
          PageShell.Sidebar (which itself falls back to a Drawer for the mobile
          overlay).
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
