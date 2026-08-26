import { useState } from 'react';

import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from '@ui/core';
import type { MantineColor } from '@ui/core';
import { ThemeOverrideWrapper } from '@ui/design-system';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { ThemeOverrideWrapper } from '@ui/design-system';",
  '',
  '// One section wants a different primary color and radius; the rest of',
  '// the app keeps the kit theme.',
  "<ThemeOverrideWrapper theme={{ primaryColor: 'teal', defaultRadius: 'xl' }}>",
  '  <PromoPanel />',
  '</ThemeOverrideWrapper>;',
].join('\n');

// Rows transcribed from src/ui/design-system/ThemeOverrideWrapper.tsx
// (ThemeOverrideWrapperProps).
const PROPS_ROWS = [
  {
    name: 'theme',
    type: 'MantineThemeOverride',
    note: "Required. Partial theme merged onto the ancestor provider's theme (via mergeThemeOverrides) for this subtree only -- primaryColor, defaultRadius, component defaults, anything createTheme accepts.",
  },
  {
    name: 'children',
    type: 'ReactNode',
    note: 'Required. The subtree that renders under the merged theme.',
  },
];

function DemoPanel({ label }: { label: string }) {
  return (
    <Paper withBorder p="md" flex={1} miw={220}>
      <Stack gap="xs" align="flex-start">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            {label}
          </Text>
          <Badge variant="light">primary</Badge>
        </Group>
        <Switch defaultChecked label="Notify on returns" />
        <Button size="xs">Check out gear</Button>
      </Stack>
    </Paper>
  );
}

function ThemeOverrideWrapperDemo() {
  const [primaryColor, setPrimaryColor] = useState<MantineColor>('teal');

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={primaryColor}
        onChange={value => setPrimaryColor(value as MantineColor)}
        data={['teal', 'grape', 'orange', 'red']}
        w="fit-content"
      />
      <Group align="stretch" gap="md">
        <DemoPanel label="Kit theme" />
        <ThemeOverrideWrapper theme={{ primaryColor, defaultRadius: 'xl' }}>
          <DemoPanel label="Scoped override" />
        </ThemeOverrideWrapper>
      </Group>
    </Stack>
  );
}

export function ThemeOverrideWrapperPage() {
  return (
    <ComponentDoc
      title="ThemeOverrideWrapper"
      lead="Layers a partial theme override on top of whatever MantineProvider is already in the tree -- one section gets a different primaryColor or component default without affecting the rest of the app."
      demoIntro="The same panel rendered twice: the left one on the kit theme, the right one inside a ThemeOverrideWrapper scoping a different primary color (pick one) and an xl radius. Everything else on this page stays on the kit theme."
      demo={<ThemeOverrideWrapperDemo />}
      usage={USAGE}
      usageMinHeight={190}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The merge is mergeThemeOverrides(parentTheme, theme): everything the
          override doesn&apos;t mention is inherited from the ancestor provider,
          so the wrapper composes with the kit theme (and with nested wrappers)
          rather than replacing it. It requires an ancestor MantineProvider --
          useMantineTheme() throws otherwise -- which is always true inside the
          app, since main.tsx wraps the whole tree in one. It ships from
          @ui/design-system, next to the kit theme it overrides.
        </Text>
        <Text size="sm" c="dimmed">
          For where each kind of theming belongs -- kit-wide defaults,
          per-subtree overrides like this, and per-call-site presets -- see{' '}
          <Anchor
            component={Link}
            href={docsPath('theming')}
            size="sm"
            fw={500}
          >
            the Theming guide
          </Anchor>
          .
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
