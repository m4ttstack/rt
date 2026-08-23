import { useState } from 'react';

import { Badge, Box, Group, Slider, Stack, Text } from '@ui/core';
import { useHasOverflowX } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useHasOverflowX } from '@ui/hooks';",
  '',
  'const { ref, hasOverflow } = useHasOverflowX();',
  '',
  '<Box ref={ref} style={{ overflowX: "auto" }}>',
  '  <WideTable />',
  '</Box>;',
  '{hasOverflow && <Text size="xs">Scroll sideways for more</Text>}',
].join('\n');

// Rows transcribed from src/ui/hooks/useHasOverflowX.ts.
const API_ROWS = [
  {
    name: 'useHasOverflowX<T>()',
    type: '{ ref, hasOverflow }',
    note: 'Attach ref to the element to watch (T defaults to HTMLDivElement); hasOverflow is true while its scrollWidth exceeds its clientWidth.',
  },
];

function UseHasOverflowXDemo() {
  const [width, setWidth] = useState(360);
  const { ref, hasOverflow } = useHasOverflowX();

  return (
    <Stack gap="sm">
      <Slider
        value={width}
        onChange={setWidth}
        min={140}
        max={520}
        maw={320}
        label={value => `${value}px`}
        aria-label="Container width"
      />
      <Box
        ref={ref}
        w={width}
        px="sm"
        py={6}
        style={{
          overflowX: 'auto',
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-md)',
          whiteSpace: 'nowrap',
        }}
      >
        <Text size="sm" ff="monospace" span>
          field_camera_a podcast_mic_kit light_panel_a tripod_a slider_rig
        </Text>
      </Box>
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          hasOverflow:
        </Text>
        <Badge variant="light" color={hasOverflow ? 'orange' : 'green'}>
          {String(hasOverflow)}
        </Badge>
      </Group>
    </Stack>
  );
}

export function UseHasOverflowXPage() {
  return (
    <ComponentDoc
      title="useHasOverflowX"
      lead="Tracks whether an element's content overflows it horizontally: { ref, hasOverflow }, kept current by a ResizeObserver -- for showing scroll hints, fades, or compact modes only when a row actually clips."
      demoIntro="Drag the slider: once the box gets narrower than its one-line content, hasOverflow flips (and back again as you widen it)."
      demo={<UseHasOverflowXDemo />}
      usage={USAGE}
      usageMinHeight={190}
      propsTables={[{ title: 'API', rows: API_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The check compares scrollWidth against clientWidth, once on mount and
          again on every ResizeObserver tick for the element -- so both
          container resizes and content growth inside it are caught (the
          observer fires when the observed element&apos;s own box changes;
          content that changes the scrollWidth without changing the box, like
          swapped text at the same element size, re-checks on the next resize).
          The observer disconnects on unmount.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
