import { useState } from 'react';

import { Anchor, Box, Button, Group, Notch, Text } from '@ui/core';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { Notch, PageShell } from '@ui/core';",
  '',
  "// Notch's home: PageShell.Content's topNotch slot, which docks it under",
  '// the shell header and animates it away on dismissal.',
  '<PageShell.Content',
  '  topNotch={{',
  '    content: (',
  '      <Notch color="orange" onClose={() => setOpened(false)}>',
  '        <Text size="sm">Inventory audit runs Friday.</Text>',
  '      </Notch>',
  '    ),',
  '    opened,',
  '  }}',
  '>',
  '  {page}',
  '</PageShell.Content>',
].join('\n');

// Rows transcribed from src/ui/core/notch/Notch.tsx (NotchProps).
const PROPS_ROWS = [
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. The banner content, laid out in a Group row.',
  },
  {
    name: 'color?',
    type: 'MantineColor',
    note: "Tint for the background and border, via Mantine's generated -light CSS vars. Default 'indigo'.",
  },
  {
    name: 'onClose',
    type: '() => void',
    note: "Required. Receives the dismiss button's clicks.",
  },
  {
    name: 'withCloseButton?',
    type: 'boolean',
    note: 'Shows the dismiss button. Default true.',
  },
  {
    name: '...rest',
    type: 'PaperProps',
    note: 'Passthrough to the banner Paper, plus Group layout props (gap/justify/align/wrap). style merges over the docked-corner treatment.',
  },
];

function NotchDemo() {
  const [opened, setOpened] = useState(true);

  return (
    <Box
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
        overflow: 'hidden',
      }}
    >
      {opened && (
        <Group w="100%" justify="center">
          <Notch onClose={() => setOpened(false)}>
            <Text size="sm">
              Quarterly maintenance pass starts Monday. Check gear back in by
              Friday.
            </Text>
          </Notch>
        </Group>
      )}
      <Box p="md">
        {!opened && (
          <Button variant="light" size="sm" onClick={() => setOpened(true)}>
            Show banner
          </Button>
        )}
        <Text size="sm" c="dimmed" mt={opened ? 0 : 'sm'}>
          The frame&apos;s top edge stands in for the shell header: the
          Notch&apos;s squared top corners and missing top border read as
          hanging from it.
        </Text>
      </Box>
    </Box>
  );
}

export function NotchPage() {
  return (
    <ComponentDoc
      title="Notch"
      lead="A top-docked, dismissible banner strip, designed to hang from the top edge of PageShell's content area (its topNotch slot) just under the shell header."
      bareDemo
      demo={<NotchDemo />}
      usage={USAGE}
      usageMinHeight={330}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Notch owns its docked look -- top corners squared, top border omitted
          -- so the host&apos;s own edge completes the outline; it is not
          designed to float free-standing. It sizes itself relative to the
          content column (MAX_CONTENT_WIDTH * 1.25) so it reads as page-level
          chrome rather than a card. The topNotch slot on{' '}
          <Anchor
            component={Link}
            href={docsPath('components/page-shell')}
            size="sm"
            fw={500}
          >
            PageShell
          </Anchor>
          &apos;s Content keeps the banner mounted while closed and animates its
          height, so dismissal slides it away instead of popping it out of
          layout.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
